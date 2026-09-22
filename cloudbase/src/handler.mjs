import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JisuClient } from "./jisu-client.mjs";
import { assertExpectedDraw, assessDrawCompleteness, normalizeQueryPayload } from "./normalize.mjs";
import { LotteryRepository } from "./repository.mjs";
import {
  allowedLotteriesForSlot,
  automaticDailyLimit,
  targetDateForSlot,
} from "./schedule.mjs";

const configUrl = [
  new URL("../config/lotteries.json", import.meta.url),
  new URL("../../config/lotteries.json", import.meta.url),
].find((candidate) => existsSync(fileURLToPath(candidate)));

if (!configUrl) throw new Error("Missing config/lotteries.json");
const lotteryConfig = JSON.parse(readFileSync(configUrl, "utf8"));

export async function runIngest({
  slot,
  now = new Date(),
  targetDate: targetDateOverride,
  runner = "cloudbase",
  lotteryTypes,
  repository = new LotteryRepository(),
  client = new JisuClient(process.env.JISU_APPKEY),
} = {}) {
  if (!slot) throw new Error("Missing schedule slot");
  if (targetDateOverride && !/^\d{4}-\d{2}-\d{2}$/.test(targetDateOverride)) {
    throw new Error("Invalid target date; expected YYYY-MM-DD");
  }
  const targetDate = targetDateOverride ?? targetDateForSlot(slot, now);
  const usageDate = targetDate;
  const allDue = await repository.allDueLotteryTypes(targetDate);
  const scheduled = allowedLotteriesForSlot(slot, allDue);
  const requested = Array.isArray(lotteryTypes) ? new Set(lotteryTypes) : null;
  const allowed = requested
    ? scheduled.filter((lotteryType) => requested.has(lotteryType))
    : scheduled;
  const targets = await repository.dueTargets(targetDate, allowed);
  const results = [];
  let runId = null;

  try {
    runId = await repository.startRun({
      runner,
      slot,
      targetDate,
      requestedCount: targets.length,
    });
    for (const target of targets) {
      if (target.data_status === "completed") {
        await repository.recordSkipped(targetDate, target.lottery_type);
        results.push({
          lottery_type: target.lottery_type,
          issue: target.issue,
          execution_status: "success",
          action: "skipped",
          data_status: "completed",
        });
        continue;
      }
      const reservation = await repository.reserveApiCall(
        usageDate,
        "jisuapi",
        automaticDailyLimit(),
      );
      if (!reservation) {
        await repository.recordFailure(
          targetDate,
          target.lottery_type,
          "",
          "daily_limit_reached",
          { countAttempt: false },
        );
        results.push({
          lottery_type: target.lottery_type,
          issue: target.issue,
          execution_status: "failed",
          action: "skipped",
          data_status: target.data_status,
          error: "daily_limit_reached",
        });
        break;
      }
      const config = lotteryConfig.lotteries[target.lottery_type];
      try {
        const payload = await client.query(config.caipiaoid);
        const draw = normalizeQueryPayload(target.lottery_type, config, payload);
        assertExpectedDraw(draw, target);
        const completeness = assessDrawCompleteness(draw);
        const saved = await repository.saveDraw(target, draw, completeness);
        results.push({
          lottery_type: target.lottery_type,
          issue: draw.issue,
          execution_status: "success",
          action: "fetched",
          data_status: saved.data_status,
          completeness_reason: saved.reason,
        });
      } catch (error) {
        const returnedIssue = /stale_issue:([^;]+)/.exec(String(error))?.[1] ?? "";
        await repository.recordFailure(targetDate, target.lottery_type, returnedIssue, error);
        results.push({
          lottery_type: target.lottery_type,
          issue: target.issue,
          execution_status: "failed",
          action: "fetched",
          data_status: target.data_status,
          error: String(error),
        });
      }
    }
    const executionStatus = results.some((item) => item.execution_status === "failed")
      ? "failed"
      : "success";
    const skippedCount = results.filter((item) => item.action === "skipped").length;
    const updatedCount = results.filter((item) => item.action === "fetched"
      && item.execution_status === "success").length;
    await repository.finishRun(runId, {
      status: executionStatus,
      updatedCount,
      skippedCount,
      details: { results },
    });
    return {
      ok: executionStatus === "success",
      runner,
      slot,
      target_date: targetDate,
      execution_status: executionStatus,
      results,
    };
  } catch (error) {
    if (runId !== null) {
      await repository.finishRun(runId, {
        status: "failed",
        updatedCount: results.filter((item) => item.action === "fetched"
          && item.execution_status === "success").length,
        skippedCount: results.filter((item) => item.action === "skipped").length,
        details: { results, error: String(error).slice(0, 1000) },
      });
    }
    throw error;
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
    targetDate: event.target_date ?? event.targetDate,
  };
}

export async function main(event = {}) {
  const invocation = resolveIngestEvent(event);
  return runIngest({
    ...invocation,
  });
}

export default main;
