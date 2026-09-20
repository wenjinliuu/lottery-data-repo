import test from "node:test";
import assert from "node:assert/strict";
import { resolveIngestEvent, runIngest } from "../src/handler.mjs";

test("manual lottery filter limits a shadow run to one due lottery", async () => {
  const seen = [];
  const repository = {
    allDueLotteryTypes: async () => ["dlt", "fc3d", "kl8"],
    dueTargets: async (_targetDate, allowed) => {
      seen.push(...allowed);
      return [];
    },
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
});

test("one-time timer trigger maps to previous-day DLT shadow run", async () => {
  assert.deepEqual(resolveIngestEvent({ TriggerName: "shadow_dlt_once" }), {
    slot: "overnight_recovery",
    runner: "cloudbase",
    lotteryTypes: ["dlt"],
  });
});
