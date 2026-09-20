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
    reserveClassCall: async () => null,
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
  assert.deepEqual(result.results, []);
  assert.equal(result.class_sync.status, "already_called_or_limit_reached");
});

test("class API runs in an aligned final slot and stores only confirmed rows", async () => {
  const saved = [];
  const repository = {
    allDueLotteryTypes: async () => [],
    dueTargets: async () => [],
    reserveClassCall: async (_date, _provider, _limit, classLimit, slot) => {
      assert.equal(classLimit, 2);
      assert.equal(slot, "cloudbase_final");
      return { class_call_count: 2 };
    },
    latestDraws: async () => ({
      ssq: { issue: "2026108", draw_date: "2026-09-20" },
    }),
    saveClassStatuses: async (rows) => saved.push(...rows),
    close: async () => {},
  };
  const client = {
    getClass: async () => ({
      result: [{
        caipiaoid: 11,
        lastissueno: "2026108",
        nextissueno: "2026109",
        nextopentime: "2026-09-22 21:15:00",
      }],
    }),
  };

  const result = await runIngest({
    slot: "cloudbase_final",
    now: new Date("2026-09-20T18:44:00Z"),
    repository,
    client,
  });

  assert.equal(result.class_sync.status, "checked");
  assert.equal(result.class_sync.confirmed_count, 1);
  assert.equal(saved[0].lottery_type, "ssq");
});
