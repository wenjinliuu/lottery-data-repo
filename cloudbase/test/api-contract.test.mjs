import test from "node:test";
import assert from "node:assert/strict";
import {
  materializeCalendarEntry,
  materializeV2Draw,
  nextMetadata,
} from "../src/api-contract.mjs";

test("v2 draw strips compatibility and raw source payloads", () => {
  const value = materializeV2Draw({
    issue: "2026109",
    draw_date: "2026-09-20",
    numbers: { red: [1, 2, 3, 4, 5, 6], blue: [7] },
    prize_details: [{ prize_name: "一等奖", winning_count: 1, prize_amount: "5000000" }],
    compatibility_payload: { secret: true },
    source_payload: { raw: true },
  });
  assert.equal(value.issue, "2026109");
  assert.equal(value.prizes[0].name, "一等奖");
  assert.equal("compatibility_payload" in value, false);
  assert.equal("source_payload" in value, false);
});

test("next metadata selects first still-saleable calendar issue", () => {
  const value = nextMetadata(
    { issue: "2026109" },
    [
      { issue: "2026110", draw_date: "2026-09-22", draw_time: "21:15:00", sale_close_time: "20:00:00" },
      { issue: "2026111", draw_date: "2026-09-24", draw_time: "21:15:00", sale_close_time: "20:00:00" },
    ],
    { draw_time: "21:15", sale_close_time: "20:00" },
    "2026-09-21 00:00:00",
  );
  assert.equal(value.issue, "2026110");
  assert.equal(value.status, "inferred");
  assert.equal(value.source, "schedule_inference");
});

test("calendar contract normalizes dates and times", () => {
  assert.deepEqual(materializeCalendarEntry({
    lottery_type: "dlt",
    issue: "26108",
    draw_date: "2026-09-21T00:00:00.000Z",
    draw_time: "21:25",
    sale_close_time: "21:00",
  }), {
    lottery_type: "dlt",
    issue: "26108",
    date: "2026-09-21",
    draw_time: "21:25:00",
    sale_close_time: "21:00:00",
  });
});
