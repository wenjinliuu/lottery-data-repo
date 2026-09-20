import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeClassPayload } from "./class-sync.mjs";
import { JisuClient } from "./jisu-client.mjs";
import { assertExpectedDraw, normalizeQueryPayload } from "./normalize.mjs";
import { LotteryRepository } from "./repository.mjs";
import {
  allowedLotteriesForSlot,
  automaticDailyLimit,
  classDailyLimit,
  shouldSyncClass,
  targetDateForSlot,
} from "./schedule.mjs";

const configUrl = [
  new URL("../config/lotteries.json", import.meta.url),
  new URL("../../config/lotteries.json", import.meta.url),
].find((candidate) => existsSync(fileURLToPath(candidate)));

if (!configUrl) throw new Error("Missing config/lotteries.json");
const lotteryConfig = JSON.parse(readFileSync(configUrl, "utf8"));

async function syncClass({ slot, usageDate, repository, client, now }) {
  if (!shouldSyncClass(slot)) return { status: "not_scheduled" };
  const reservation = await repository.reserveClassCall(
    usageDate,
    "jisuapi",
    automaticDailyLimit(),
    classDailyLimit(),
    slot,
  );
  if (!reservation) return { status: "already_called_or_limit_reached" };

  try {
    const fetchedAt = now.toISOString();
    const payload = await client.getClass();
    const latestDraws = await repository.latestDraws(Object.keys(lotteryConfig.lotteries));
    const normalized = normalizeClassPayload(
      payload,
      lotteryConfig.lotteries,
      latestDraws,
      fetchedAt,
    );
    await repository.saveClassStatuses(normalized.confirmed);
    return {
      status: "checked",
      confirmed_count: normalized.confirmed.length,
      rejected_count: normalized.rejected.length,
      confirmed: normalized.confirmed.map((item) => ({
        lottery_type: item.lottery_type,
        last_issue: item.last_issue,
        next_issue: item.next_issue,
      })),
      rejected: normalized.rejected,
    };
  } catch (error) {
    return { status: "failed", error: String(error).slice(0, 1000) };
  }
}

export async function runIngest({
  slot,
  now = new Date(),
  runner = "cloudbase",
  lotteryTypes,
  repository = new LotteryRepository(),
  client = new JisuClient(process.env.JISU_APPKEY),
} = {}) {
  if (!slot) throw new Error("Missing schedule slot");
  const targetDate = targetDateForSlot(slot, now);
  const usageDate = targetDate;
  const allDue = await repository.allDueLotteryTypes(targetDate);
  const scheduled = allowedLotteriesForSlot(slot, allDue);
  const requested = Array.isArray(lotteryTypes) ? new Set(lotteryTypes) : null;
  const allowed = requested
    ? scheduled.filter((lotteryType) => requested.has(lotteryType))
    : scheduled;
  const pending = await repository.dueTargets(targetDate, allowed);
  const results = [];

  try {
    for (const target of pending) {
      const reservation = await repository.reserveApiCall(
        usageDate,
        "jisuapi",
        automaticDailyLimit(),
      );
      if (!reservation) {
        results.push({ lottery_type: target.lottery_type, status: "daily_limit_reached" });
        break;
      }
      const config = lotteryConfig.lotteries[target.lottery_type];
      try {
        const payload = await client.query(config.caipiaoid);
        const draw = normalizeQueryPayload(target.lottery_type, config, payload);
        assertExpectedDraw(draw, target);
        await repository.saveDraw(target, draw);
        results.push({ lottery_type: target.lottery_type, issue: draw.issue, status: "updated" });
      } catch (error) {
        const returnedIssue = /stale_issue:([^;]+)/.exec(String(error))?.[1] ?? "";
        await repository.recordFailure(targetDate, target.lottery_type, returnedIssue, error);
        results.push({ lottery_type: target.lottery_type, status: "pending", error: String(error) });
      }
    }

    const classSync = await syncClass({
      slot,
      usageDate,
      repository,
      client,
      now,
    });
    return {
      ok: true,
      runner,
      slot,
      target_date: targetDate,
      results,
      class_sync: classSync,
    };
  } finally {
    await repository.close();
  }
}

export function resolveIngestEvent(event = {}) {
  const slot = event.slot
    ?? event.TriggerName
    ?? event.triggerName
    ?? process.env.SCHEDULE_SLOT;
  return {
    slot,
    runner: event.runner ?? "cloudbase",
    lotteryTypes: event.lottery_types ?? event.lotteryTypes,
  };
}

export async function main(event = {}) {
  const invocation = resolveIngestEvent(event);
  return runIngest({
    ...invocation,
  });
}

export default main;
