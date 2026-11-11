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

  /** 登记或更新一台设备。lotteries 传空数组就是退订。 */
  async registerDevice({ token, environment, bundle_id: bundleId, lotteries }) {
    const normalized = String(token ?? "").trim().toLowerCase();
    if (!/^[0-9a-f]{64,200}$/.test(normalized)) throw new ValidationError("invalid_token");
    if (!Array.isArray(lotteries) || lotteries.some((item) => !LOTTERY_TYPES.includes(item))) {
      throw new ValidationError("invalid_lotteries");
    }
    ensureSuccess(
      await this.db.from("push_devices").upsert({
        token: normalized,
        environment: environment === "sandbox" ? "sandbox" : "production",
        bundle_id: String(bundleId ?? "").slice(0, 200),
        lotteries: [...new Set(lotteries)].sort(),
        disabled: false,
        last_error: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "token" }),
      "register push device",
    );
    return { ok: true };
  }

  async devicesFor(lotteryType) {
    const rows = ensureSuccess(
      await this.db.from("push_devices").select("token,environment,bundle_id,lotteries")
        .eq("disabled", false).limit(1000),
      "read push devices",
    );
    return rows.filter((row) => Array.isArray(row.lotteries) && row.lotteries.includes(lotteryType));
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

  /** 抢这一期的推送名额；已经推过返回 false。 */
  async claim(lotteryType, issue) {
    const existing = ensureSuccess(
      await this.db.from("draw_push_log").select("issue")
        .eq("lottery_type", lotteryType).eq("issue", issue).limit(1),
      "read draw push log",
    );
    if (existing.length) return false;
    const inserted = ensureSuccess(
      await this.db.from("draw_push_log").upsert(
        { lottery_type: lotteryType, issue },
        { onConflict: "lottery_type,issue", ignoreDuplicates: true },
      ).select("issue"),
      "claim draw push",
    );
    return inserted.length > 0;
  }

  async recordDelivery(lotteryType, issue, delivered) {
    ensureSuccess(
      await this.db.from("draw_push_log").update({ delivered })
        .eq("lottery_type", lotteryType).eq("issue", issue),
      "record draw push delivery",
    );
  }
}

/**
 * 开奖号码落库后调用：给订了这个彩种的设备各推一条，每期只推一次。
 * 通知同时带 content-available：App 在后台被唤醒，用本机的票核对完，
 * 再用同一个标识符（collapse id）发一条本地通知把它换成中奖情况。
 * App 没被唤醒（比如被手动划掉了）时，用户看到的就是开奖号码本身。
 * 任何失败都不该影响抓取本身，调用方要自己兜住异常。
 */
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
  const devices = await store.devicesFor(lotteryType);
  // 没人订就不占名额：之后有设备订阅了，下一期照常推。
  if (!devices.length) return { push: "no_devices" };
  if (!(await store.claim(lotteryType, issue))) return { push: "already_sent" };

  const name = lotteryNames[lotteryType] ?? lotteryType;
  const results = await apns.send(devices, {
    title: `${name} ${issue} 期开奖`,
    body: numbersText(lotteryType, draw.numbers),
    threadId: `draw-${lotteryType}`,
    mutableContent: true,
    contentAvailable: true,
    collapseId: `draw-${lotteryType}-${issue}`,
    data: drawPayload(lotteryType, draw),
  });
  for (const result of results.filter((item) => item.gone)) {
    await store.disableDevice(result.token, result.reason || `http_${result.status}`);
  }
  const delivered = results.filter((item) => item.ok).length;
  await store.recordDelivery(lotteryType, issue, delivered);
  const errors = results.filter((item) => !item.ok).map((item) => item.reason || `http_${item.status}`);
  return { push: "sent", devices: devices.length, delivered, ...(errors.length ? { push_errors: errors } : {}) };
}
