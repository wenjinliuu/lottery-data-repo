import test from "node:test";
import assert from "node:assert/strict";
import { materializeV2Draw, resolveNextMetadata } from "../scripts/export-public-data.mjs";

test("v2 draw removes compatibility and raw upstream fields", () => {
  const draw = materializeV2Draw({
    issue: "2026108",
    draw_date: "2026-09-20",
    numbers: { red: [1, 2, 3, 4, 5, 6], blue: [7] },
    prize_pool: "100",
    sales_amount: "200",
    prize_details: [{
      prize_name: "一等奖",
      require: "6+1",
      winning_count: 2,
      prize_amount: "5000000",
      raw: { duplicate: true },
    }],
    compatibility_payload: { huge: true },
    source_payload: { huge: true },
  });

  assert.equal(draw.issue, "2026108");
  assert.equal(draw.prizes[0].name, "一等奖");
  assert.equal("raw" in draw.prizes[0], false);
  assert.equal("compatibility_payload" in draw, false);
  assert.equal("source_payload" in draw, false);
});

test("confirmed class data wins only when it matches the latest issue", () => {
  const latest = { issue: "2026108", draw_date: "2026-09-20" };
  const lottery = { draw_time: "21:15", sale_close_time: "20:00" };
  const calendar = [{
    issue: "2026109",
    draw_date: "2026-09-22",
    draw_time: "21:15",
    sale_close_time: "20:00",
  }];
  const confirmed = resolveNextMetadata(latest, lottery, calendar, {
    last_issue: "2026108",
    next_issue: "2026109",
    next_open_time: "2026-09-22 21:15:00",
    next_buy_end_time: "2026-09-22 20:00:00",
  }, "2026-09-21 08:14:00");
  assert.equal(confirmed.next_status, "confirmed");

  const inferred = resolveNextMetadata(latest, lottery, calendar, {
    last_issue: "2026107",
    next_issue: "2026108",
    next_open_time: "2026-09-20 21:15:00",
    next_buy_end_time: "2026-09-20 20:00:00",
  }, "2026-09-21 08:14:00");
  assert.equal(inferred.next_status, "inferred");
  assert.equal(inferred.next_issue, "2026109");
});
