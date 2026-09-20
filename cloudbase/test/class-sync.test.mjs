import test from "node:test";
import assert from "node:assert/strict";
import { normalizeClassPayload } from "../src/class-sync.mjs";

const configs = {
  ssq: { caipiaoid: 11, sale_close_time: "20:00" },
  dlt: { caipiaoid: 14, sale_close_time: "21:00" },
};

test("class response is accepted only when it matches the latest draw", () => {
  const result = normalizeClassPayload({
    result: [
      {
        caipiaoid: 11,
        lastissueno: "2026108",
        nextissueno: "2026109",
        nextopentime: "2026-09-22 21:15:00",
      },
      {
        caipiaoid: 14,
        lastissueno: "2026107",
        nextissueno: "2026108",
        nextopentime: "2026-09-21 21:25:00",
      },
    ],
  }, configs, {
    ssq: { issue: "2026108", draw_date: "2026-09-20" },
    dlt: { issue: "2026108", draw_date: "2026-09-19" },
  }, "2026-09-21T00:34:00.000Z");

  assert.equal(result.confirmed.length, 1);
  assert.equal(result.confirmed[0].lottery_type, "ssq");
  assert.equal(result.confirmed[0].next_buy_end_time, "2026-09-22 20:00:00");
  assert.deepEqual(result.rejected[0], {
    lottery_type: "dlt",
    latest_issue: "2026108",
    class_last_issue: "2026107",
    class_next_issue: "2026108",
    reason: "class_last_issue_stale",
  });
});
