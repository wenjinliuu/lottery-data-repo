import test from "node:test";
import assert from "node:assert/strict";
import { materializePublicDraw } from "../scripts/export-public-data.mjs";

test("materializes a CloudBase draw with the next calendar issue", () => {
  const draw = materializePublicDraw({
    issue: "26107",
    draw_date: "2026-09-19",
    draw_time: null,
    numbers: { front: [2, 5, 7, 14, 22], back: [4, 10] },
    prize_pool: "831053727.13",
    sales_amount: "313508185",
    prize_details: [],
    compatibility_payload: { deadline: "2026-11-17" },
    source_payload: { query_response: { status: 0 } },
    source_name: "jisuapi",
    source_fetched_at: "2026-09-20T11:12:04.046Z",
  }, "dlt", {
    name: "大乐透",
    caipiaoid: 14,
    draw_time: "21:25",
    sale_close_time: "21:00",
  }, {
    issue: "26108",
    draw_date: "2026-09-21",
    draw_time: "21:25:00",
    sale_close_time: "21:00:00",
  });

  assert.equal(draw.next_issue, "26108");
  assert.equal(draw.next_open_time, "2026-09-21 21:25:00");
  assert.equal(draw.next_source, "schedule_inference");
  assert.deepEqual(draw.raw_public_json.class_info, {});
  assert.match(draw.source.query_url, /appkey=\*\*\*/);
});

