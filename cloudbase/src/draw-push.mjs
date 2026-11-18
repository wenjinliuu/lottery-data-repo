import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createCloudBaseDatabase } from "./repository.mjs";
import { LOTTERY_TYPES, materializeV2Draw } from "./api-contract.mjs";
import { createApnsClient } from "./apns.mjs";

const configUrl = [
  new URL("../config/lotteries.json", import.meta.url),
  new URL("../../config/lotteries.json", import.meta.url),
].find((candidate) => existsSync(fileURLToPath(candidate)));
const lotteryNames = configUrl
  ? Object.fromEntries(Object.entries(JSON.parse(readFileSync(configUrl, "utf8")).lotteries)
    .map(([key, value]) => [key, value.name]))
  : {};

// APNs 整条通知上限 4096 字节，给 aps 和外壳留出余量。
const DRAW_PAYLOAD_LIMIT = 3400;
const DRAW_COLUMNS = [
  "issue", "draw_date", "draw_time", "numbers", "prize_pool", "sales_amount",
  "prize_details", "source_fetched_at", "data_status",
].join(",");

function ensureSuccess(result, operation) {
  if (result?.error) {
    throw new Error(`${operation}: ${result.error.message ?? JSON.stringify(result.error)}`);
  }
  return result?.data ?? [];
}

export class ValidationError extends Error {}

const pad = (value) => String(value).padStart(2, "0");

/** 通知正文里的开奖号码。手机本机核对失败时，用户看到的就是这一行。 */
export function numbersText(lotteryType, numbers = {}) {
  const list = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);
  if (lotteryType === "ssq") return `${list(numbers.red).map(pad).join(" ")} + ${list(numbers.blue).map(pad).join(" ")}`;
  if (lotteryType === "dlt") return `${list(numbers.front).map(pad).join(" ")} + ${list(numbers.back).map(pad).join(" ")}`;
  if (lotteryType === "qlc") return `${list(numbers.basic).map(pad).join(" ")} + ${list(numbers.special).map(pad).join(" ")}`;
  if (lotteryType === "kl8") return list(numbers.nums).map(pad).join(" ");
  if (lotteryType === "qxc") {
    const digits = list(numbers.digits);
    return `${digits.slice(0, 6).join(" ")} + ${digits.slice(6).join(" ")}`;
  }
  return list(numbers.digits).join(" ");
}

/**
 * 随通知带下去的开奖数据，和 /v2/draws 里的单条开奖同一个结构，App 用同一套解码。
 * 奖级只留名称和金额；还是放不下（快乐8 的奖级表最长）就整个不带 ——
 * 手机那边会把中奖的票显示成「奖金待公布」，打开 App 后照常补上。
 */
export function drawPayload(lotteryType, drawRow) {
  const full = materializeV2Draw(drawRow);
  const slim = {
    issue: full.issue,
    date: full.date,
    numbers: full.numbers,
    prizes: (full.prizes ?? [])
      .filter((item) => item.name && item.amount)
      .map((item) => ({
        name: item.name,
        amount: item.amount,
        ...(item.extra_amount ? { extra_amount: item.extra_amount } : {}),
      })),
  };
  if (!slim.prizes.length) delete slim.prizes;
  const fits = (value) => Buffer.byteLength(JSON.stringify(value)) <= DRAW_PAYLOAD_LIMIT;
  if (!fits(slim)) delete slim.prizes;
  return { lottery_type: lotteryType, draw: slim };
}

export class DrawPushStore {
  constructor(database = createCloudBaseDatabase()) {
    this.db = database;
  }

  /** 新版只发送开关。旧版列表仅用于判断是否订阅，不保留购买偏好。 */
  async registerDevice({ token, environment, bundle_id: bundleId, enabled, lotteries }) {
    const normalized = String(token ?? "").trim().toLowerCase();
    if (!/^[0-9a-f]{64,200}$/.test(normalized)) throw new ValidationError("invalid_token");
    if (enabled !== undefined && typeof enabled !== "boolean") throw new ValidationError("invalid_enabled");
    if (enabled === undefined &&
        (!Array.isArray(lotteries) || lotteries.some((item) => !LOTTERY_TYPES.includes(item)))) {
      throw new ValidationError("invalid_lotteries");
    }
    const subscribed = enabled ?? (lotteries.length > 0);
    ensureSuccess(
      await this.db.from("push_devices").upsert({
        token: normalized,
        environment: environment === "sandbox" ? "sandbox" : "production",
        bundle_id: String(bundleId ?? "").slice(0, 200),
        lotteries: subscribed ? [...LOTTERY_TYPES].sort() : [],
        disabled: false,
        last_error: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "token" }),
      "register push device",
    );
    return { ok: true };
  }

  async disableDevice(token, reason) {
    ensureSuccess(
      await this.db.from("push_devices")
        .update({ disabled: true, last_error: String(reason).slice(0, 200), updated_at: new Date().toISOString() })
        .eq("token", token),
      "disable push device",
    );
  }

  async drawRow(lotteryType, issue) {
    const rows = ensureSuccess(
      await this.db.from("lottery_draws").select(DRAW_COLUMNS)
        .eq("lottery_type", lotteryType).eq("issue", issue).limit(1),
      "read draw for push",
    );
    return rows[0] ?? null;
  }

  async claim(lotteryType, issue, claimId) {
    const rows = ensureSuccess(await this.db.rpc("claim_draw_push_deliveries", {
      p_lottery_type: lotteryType, p_issue: issue, p_claim_id: claimId,
    }), "claim draw push deliveries");
    return rows.map(({ device_token, environment }) => ({ token: device_token, environment }));
  }

  async recordDelivery(lotteryType, issue, claimId, result) {
    const error = result.gone ? "inactive_device" : (result.reason || `http_${result.status}`);
    ensureSuccess(
      await this.db.from("draw_push_deliveries")
        .update({
          accepted_at: result.ok ? new Date().toISOString() : null,
          // Leave failed claims on cooldown before the next scheduled attempt.
          ...(result.ok || result.gone ? { lease_until: null } : {}),
          last_error: result.ok ? null : error,
        })
        .eq("lottery_type", lotteryType).eq("issue", issue)
        .eq("device_token", result.token).eq("claim_id", claimId),
      "record draw push delivery",
    );
  }

}

/** Push an alert after the numbers are available. APNs acceptance is recorded per device. */
export async function pushDraw({
  lotteryType,
  issue,
  store = new DrawPushStore(),
  apns = createApnsClient(),
}) {
  if (!apns) return { push: "not_configured" };
  const draw = await store.drawRow(lotteryType, issue);
  const hasNumbers = Object.values(draw?.numbers ?? {}).flat().some((value) => Number.isInteger(value));
  if (!hasNumbers) return { push: "no_numbers" };

  const claimId = randomUUID();
  const devices = await store.claim(lotteryType, issue, claimId);
  if (!devices.length) return { push: "no_pending_devices" };

  const name = lotteryNames[lotteryType] ?? lotteryType;
  const results = await apns.send(devices, {
    title: `${name} ${issue} 期开奖`,
    body: numbersText(lotteryType, draw.numbers),
    threadId: `draw-${lotteryType}`,
    contentAvailable: true,
    collapseId: `draw-${lotteryType}-${issue}`,
    data: drawPayload(lotteryType, draw),
  });

  let recordFailures = 0;
  for (let offset = 0; offset < results.length; offset += 25) {
    const recorded = await Promise.allSettled(results.slice(offset, offset + 25).map(async (result) => {
      await store.recordDelivery(lotteryType, issue, claimId, result);
      if (result.gone) await store.disableDevice(result.token, result.reason || `http_${result.status}`);
    }));
    recordFailures += recorded.filter((item) => item.status === "rejected").length;
  }
  const accepted = results.filter((item) => item.ok).length;
  const errors = Object.create(null);
  for (const result of results.filter((item) => !item.ok)) {
    const reason = result.reason || `http_${result.status}`;
    errors[reason] = (errors[reason] ?? 0) + 1;
  }
  return {
    push: accepted === devices.length ? "accepted" : (accepted ? "partial_failure" : "failed"),
    devices: devices.length,
    accepted,
    ...(accepted < devices.length ? { push_errors: errors } : {}),
    ...(recordFailures ? { record_failures: recordFailures } : {}),
  };
}
