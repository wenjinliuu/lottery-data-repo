import test from "node:test";
import assert from "node:assert/strict";
import { runIngest } from "../src/handler.mjs";

test("manual lottery filter limits a shadow run to one due lottery", async () => {
  const seen = [];
  const repository = {
    allDueLotteryTypes: async () => ["dlt", "fc3d", "kl8"],
    dueTargets: async (_targetDate, allowed) => {
      seen.push(...allowed);
      return [];
    },
    startRun: async () => 1,
    finishRun: async () => {},
    close: async () => {},
  };

  const result = await runIngest({
    slot: "overnight_recovery",
    now: new Date("2026-09-20T07:00:00Z"),
    lotteryTypes: ["dlt"],
    repository,
    client: {},
  });

  assert.deepEqual(seen, ["dlt"]);
  assert.equal(result.target_date, "2026-09-19");
  assert.equal(result.execution_status, "success");
  assert.deepEqual(result.results, []);
});

function ingestFixture({ complete }) {
  const saved = [];
  const runs = [];
  const repository = {
    allDueLotteryTypes: async () => ["pl3"],
    dueTargets: async () => [{
      lottery_type: "pl3",
      issue: "26253",
      draw_date: "2026-09-20",
      data_status: "waiting",
    }],
    startRun: async () => 1,
    finishRun: async (_id, run) => runs.push(run),
    reserveApiCall: async () => ({ call_count: 1 }),
    saveDraw: async (_target, draw, completeness) => {
      saved.push({ draw, completeness });
      return {
        ...completeness,
        data_status: completeness.complete ? "completed" : "numbers_ready",
      };
    },
    recordFailure: async () => assert.fail("valid draw must not be recorded as a failure"),
    close: async () => {},
  };
  const client = {
    query: async () => ({
      result: {
        caipiaoid: 16,
        issueno: "26253",
        opendate: "2026-09-20 20:30:00",
        number: "1 2 3",
        saleamount: complete ? "12345678" : 0,
        prize: complete ? [{ prizename: "直选", num: 0, singlebonus: 1040 }] : false,
      },
    }),
  };
  return { repository, client, saved, runs };
}

test("numbers-only response is saved and remains available for later slots", async () => {
  const fixture = ingestFixture({ complete: false });
  const result = await runIngest({
    slot: "all_first",
    targetDate: "2026-09-20",
    repository: fixture.repository,
    client: fixture.client,
  });
  assert.equal(result.target_date, "2026-09-20");
  assert.equal(result.results[0].execution_status, "success");
  assert.equal(result.results[0].data_status, "numbers_ready");
  assert.equal(result.results[0].completeness_reason, "prize_not_published");
  assert.equal(fixture.saved.length, 1);
  assert.equal(fixture.runs[0].status, "success");
});

test("published prize and sales response completes the fetch target", async () => {
  const fixture = ingestFixture({ complete: true });
  const result = await runIngest({
    slot: "all_first",
    targetDate: "2026-09-20",
    repository: fixture.repository,
    client: fixture.client,
  });
  assert.equal(result.results[0].execution_status, "success");
  assert.equal(result.results[0].data_status, "completed");
  assert.equal(result.results[0].completeness_reason, "complete");
});

test("manual target date rejects ambiguous formats", async () => {
  await assert.rejects(
    runIngest({ slot: "all_first", targetDate: "2026/09/20", repository: {}, client: {} }),
    /Invalid target date/,
  );
});
