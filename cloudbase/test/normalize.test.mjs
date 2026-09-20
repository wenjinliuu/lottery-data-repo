import test from "node:test";
import assert from "node:assert/strict";
import { assertExpectedDraw, normalizeQueryPayload } from "../src/normalize.mjs";

const config = { name: "排列三", caipiaoid: 16 };
const payload = {
  result: {
    caipiaoid: 16,
    issueno: "26250",
    opendate: "2026-09-18 21:25:00",
    number: "1 2 3",
    prize: [],
  },
};

test("normalizes and validates the expected issue", () => {
  const draw = normalizeQueryPayload("pl3", config, payload, "2026-09-18T14:00:00Z");
  assert.deepEqual(draw.numbers, { digits: [1, 2, 3] });
  assert.equal(draw.semantic_checksum.length, 64);
  assert.doesNotThrow(() => assertExpectedDraw(draw, { issue: "26250", draw_date: "2026-09-18" }));
});

test("old upstream issue remains pending", () => {
  const draw = normalizeQueryPayload("pl3", config, payload);
  assert.throws(
    () => assertExpectedDraw(draw, { issue: "26251", draw_date: "2026-09-18" }),
    /stale_issue/,
  );
});

test("zero-value prize fields match the existing Python public-data contract", () => {
  const draw = normalizeQueryPayload("pl3", config, {
    result: {
      ...payload.result,
      prize: [{
        prizename: "一等奖",
        require: "命中",
        num: 0,
        singlebonus: 0,
        addnum: 0,
        addbonus: 0,
      }],
    },
  });

  assert.deepEqual(draw.prize_details[0], {
    prize_level: "一等奖",
    prize_name: "一等奖",
    require: "命中",
    winning_count: null,
    prize_amount: "",
    additional_count: null,
    additional_amount: "",
    raw: {
      prizename: "一等奖",
      require: "命中",
      num: 0,
      singlebonus: 0,
      addnum: 0,
      addbonus: 0,
    },
  });
});
