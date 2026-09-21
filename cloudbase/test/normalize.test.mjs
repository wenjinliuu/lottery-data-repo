import test from "node:test";
import assert from "node:assert/strict";
import {
  assertExpectedDraw,
  assessDrawCompleteness,
  drawCompletenessScore,
  normalizeQueryPayload,
} from "../src/normalize.mjs";

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

test("explicit zero-value prize fields remain distinct from missing fields", () => {
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
    winning_count: 0,
    prize_amount: "0",
    additional_count: 0,
    additional_amount: "0",
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

test("numbers without a published prize table remain pending", () => {
  const draw = normalizeQueryPayload("pl3", config, payload);
  assert.deepEqual(assessDrawCompleteness(draw), {
    complete: false,
    reason: "prize_not_published",
  });
});

test("zero winners can be complete when the official sales data is published", () => {
  const draw = normalizeQueryPayload("fc3d", { name: "福彩3D", caipiaoid: 12 }, {
    result: {
      caipiaoid: 12,
      issueno: "2026252",
      opendate: "2026-09-19 21:15:00",
      number: "1 2 3",
      saleamount: "12345678",
      prize: [{ prizename: "单选", num: 0, singlebonus: 1040 }],
    },
  });
  assert.deepEqual(assessDrawCompleteness(draw), { complete: true, reason: "complete" });
});

test("KL8 fixed prize rules alone do not finish the fetch target", () => {
  const draw = normalizeQueryPayload("kl8", { name: "快乐8", caipiaoid: 89 }, {
    result: {
      caipiaoid: 89,
      issueno: "2026253",
      opendate: "2026-09-20 21:30:00",
      number: "01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20",
      prize: [{ prizename: "选九中9", num: 0, singlebonus: 250000 }],
    },
  });
  assert.deepEqual(assessDrawCompleteness(draw), {
    complete: false,
    reason: "sales_amount_pending",
  });
});

test("a complete response outranks a later degraded response", () => {
  const partial = normalizeQueryPayload("pl3", config, payload);
  const complete = normalizeQueryPayload("pl3", config, {
    result: {
      ...payload.result,
      saleamount: "12345678",
      prize: [{ prizename: "直选", num: 0, singlebonus: 1040 }],
    },
  });
  assert.ok(drawCompletenessScore(complete) > drawCompletenessScore(partial));
});
