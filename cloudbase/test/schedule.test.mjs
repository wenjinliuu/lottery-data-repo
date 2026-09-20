import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedLotteriesForSlot,
  automaticDailyLimit,
  targetDateForSlot,
} from "../src/schedule.mjs";

test("evening slot targets the current Beijing date", () => {
  assert.equal(targetDateForSlot("all_first", new Date("2026-09-18T13:44:00Z")), "2026-09-18");
});

test("after-midnight recovery targets the previous Beijing date", () => {
  assert.equal(targetDateForSlot("overnight_recovery", new Date("2026-09-18T16:34:00Z")), "2026-09-18");
  assert.equal(targetDateForSlot("cloudbase_final", new Date("2026-09-18T18:44:00Z")), "2026-09-18");
});

test("early slot only includes due welfare lotteries", () => {
  assert.deepEqual(
    allowedLotteriesForSlot("welfare_early", ["ssq", "fc3d", "pl3", "pl5", "kl8"]),
    ["ssq", "fc3d"],
  );
});

test("automatic API budget is capped at 60", () => {
  assert.equal(automaticDailyLimit(), 60);
});
