import lotteryConfig from "../../config/lotteries.json" with { type: "json" };
import { JisuClient } from "./jisu-client.mjs";
import { assertExpectedDraw, normalizeQueryPayload } from "./normalize.mjs";
import { LotteryRepository } from "./repository.mjs";
import {
  allowedLotteriesForSlot,
  automaticDailyLimit,
  targetDateForSlot,
} from "./schedule.mjs";

export async function runIngest({
  slot,
  now = new Date(),
  runner = "cloudbase",
  repository = new LotteryRepository(),
  client = new JisuClient(process.env.JISU_APPKEY),
} = {}) {
  if (!slot) throw new Error("Missing schedule slot");
  const targetDate = targetDateForSlot(slot, now);
  const usageDate = targetDate;
  const allDue = await repository.allDueLotteryTypes(targetDate);
  const allowed = allowedLotteriesForSlot(slot, allDue);
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
    return { ok: true, runner, slot, target_date: targetDate, results };
  } finally {
    await repository.close();
  }
}

export async function main(event = {}) {
  return runIngest({ slot: event.slot ?? process.env.SCHEDULE_SLOT, runner: event.runner ?? "cloudbase" });
}

export default main;
