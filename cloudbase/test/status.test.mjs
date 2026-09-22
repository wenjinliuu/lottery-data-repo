import assert from "node:assert/strict";
import test from "node:test";

import { handleHttp } from "../src/api-handler.mjs";
import { runIngest } from "../src/handler.mjs";
import {
  assessDrawCompleteness,
  drawDataStatus,
  normalizeQueryPayload,
} from "../src/normalize.mjs";

test("zero winners remain valid data", () => {
  const draw = normalizeQueryPayload("ssq", { name: "双色球", caipiaoid: 11 }, {
    result: {
      issueno: "2026110",
      opendate: "2026-09-22 21:15:00",
      number: "01 02 03 04 05 06",
      refernumber: "07",
      saleamount: "100",
      prize: [{ prizename: "一等奖", num: 0, singlebonus: 5000000 }],
    },
  });

  assert.equal(draw.prize_details[0].winning_count, 0);
  assert.deepEqual(assessDrawCompleteness(draw), { complete: true, reason: "complete" });
  assert.equal(drawDataStatus(draw), "completed");
});

test("completed targets are logged and skipped without an API call", async () => {
  const calls = [];
  const repository = {
    allDueLotteryTypes: async () => ["ssq"],
    dueTargets: async () => [{
      draw_date: "2026-09-22",
      lottery_type: "ssq",
      issue: "2026110",
      data_status: "completed",
    }],
    startRun: async (value) => { calls.push(["start", value]); return 1; },
    recordSkipped: async (...value) => calls.push(["skip", ...value]),
    finishRun: async (...value) => calls.push(["finish", ...value]),
    close: async () => calls.push(["close"]),
  };
  const client = { query: async () => { throw new Error("must not fetch"); } };

  const result = await runIngest({
    slot: "all_first",
    targetDate: "2026-09-22",
    repository,
    client,
  });

  assert.equal(result.execution_status, "success");
  assert.equal(result.results[0].action, "skipped");
  assert.equal(result.results[0].data_status, "completed");
  assert.equal(calls.find(([name]) => name === "finish")[2].skippedCount, 1);
});

test("status route is exposed for the app", async () => {
  const payload = { schema: "duigehao.lottery.status", version: 2 };
  const result = await handleHttp(
    { httpMethod: "GET", path: "/lottery/v2/status" },
    { status: async () => payload },
  );

  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body), payload);
});
