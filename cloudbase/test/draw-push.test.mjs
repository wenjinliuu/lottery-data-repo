import test from "node:test";
import assert from "node:assert/strict";
import { DrawPushStore, drawPayload, numbersText, pushDraw } from "../src/draw-push.mjs";
import { handleHttp } from "../src/api-handler.mjs";
import { createFakeDb } from "./fake-db.mjs";
import { authenticatedEvent, testAccess } from "./access-fixture.mjs";

const TOKEN_A = "aa".repeat(32);
const TOKEN_B = "bb".repeat(32);
const ssqRow = {
  lottery_type: "ssq",
  issue: "2026130",
  draw_date: "2026-11-10",
  numbers: { red: [5, 6, 10, 25, 27, 30], blue: [11] },
  prize_details: [
    { prize_name: "一等奖", require: "中6+1", winning_count: 4, prize_amount: "10000000" },
    { prize_name: "六等奖", require: "中0+1", winning_count: 900000, prize_amount: "5" },
  ],
};

function fakeApns() {
  const sent = [];
  return {
    sent,
    send: async (devices, message) => {
      sent.push({ tokens: devices.map((d) => d.token), message });
      return devices.map((d) => ({ token: d.token, ok: d.token !== TOKEN_B, gone: d.token === TOKEN_B, reason: d.token === TOKEN_B ? "Unregistered" : "" }));
    },
  };
}

const register = (db, body, headers) => handleHttp(
  authenticatedEvent({ httpMethod: "POST", path: "/lottery/v2/devices", body: JSON.stringify(body), ...(headers ? { headers } : {}) }),
  null, testAccess, new DrawPushStore(db),
);

test("登记设备：要读取密钥，校验令牌和彩种，重复登记是覆盖", async () => {
  const db = createFakeDb();
  const noKey = await handleHttp({ httpMethod: "POST", path: "/v2/devices", body: "{}" }, null, testAccess, new DrawPushStore(db));
  assert.equal(noKey.statusCode, 401);
  assert.equal((await register(db, { token: "short", lotteries: [] })).statusCode, 400);
  assert.equal((await register(db, { token: TOKEN_A, lotteries: ["sports"] })).statusCode, 400);
  assert.equal((await register(db, { token: TOKEN_A })).statusCode, 400);
  assert.equal(db.tables.push_devices?.length ?? 0, 0);

  const ok = await register(db, { token: TOKEN_A.toUpperCase(), environment: "sandbox", bundle_id: "app", lotteries: ["ssq", "dlt", "ssq"] });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers["cache-control"], "no-store");
  assert.deepEqual(db.tables.push_devices.map((d) => [d.token, d.environment, d.lotteries]), [[TOKEN_A, "sandbox", ["dlt", "ssq"]]]);
  await register(db, { token: TOKEN_A, lotteries: [] });
  assert.deepEqual(db.tables.push_devices.map((d) => [d.environment, d.lotteries]), [["production", []]]);
  // 其它写方法仍然不允许
  const put = await handleHttp(authenticatedEvent({ httpMethod: "PUT", path: "/v2/devices" }), null, testAccess);
  assert.equal(put.statusCode, 405);
});

test("通知正文是开奖号码，各彩种的写法", () => {
  assert.equal(numbersText("ssq", ssqRow.numbers), "05 06 10 25 27 30 + 11");
  assert.equal(numbersText("dlt", { front: [3, 13, 20, 25, 34], back: [9, 12] }), "03 13 20 25 34 + 09 12");
  assert.equal(numbersText("qlc", { basic: [7, 11, 15, 18, 25, 27, 30], special: 6 }), "07 11 15 18 25 27 30 + 06");
  assert.equal(numbersText("qxc", { digits: [9, 3, 8, 6, 2, 5, 12] }), "9 3 8 6 2 5 + 12");
  assert.equal(numbersText("pl3", { digits: [1, 7, 0] }), "1 7 0");
  assert.equal(numbersText("kl8", { nums: [1, 7, 80] }), "01 07 80");
});

test("随通知下发的开奖数据：只留核对要用的字段，放不下就不带奖级", () => {
  assert.deepEqual(drawPayload("ssq", ssqRow), {
    lottery_type: "ssq",
    draw: {
      issue: "2026130",
      date: "2026-11-10",
      numbers: ssqRow.numbers,
      prizes: [{ name: "一等奖", amount: "10000000" }, { name: "六等奖", amount: "5" }],
    },
  });
  const noPrizes = drawPayload("ssq", { ...ssqRow, prize_details: [] });
  assert.equal("prizes" in noPrizes.draw, false);
  const huge = { ...ssqRow, prize_details: Array.from({ length: 300 }, (_, i) => ({ prize_name: `选十中${i}的很长的奖级名字`, prize_amount: "5" })) };
  const trimmed = drawPayload("kl8", huge);
  assert.equal("prizes" in trimmed.draw, false);
  assert.ok(Buffer.byteLength(JSON.stringify(trimmed)) < 3600);
});

test("开奖推送：只推给订了这个彩种的设备，每期一次，失效令牌停用", async () => {
  const db = createFakeDb({ lottery_draws: [ssqRow] });
  const store = new DrawPushStore(db);
  await store.registerDevice({ token: TOKEN_A, lotteries: ["ssq"] });
  await store.registerDevice({ token: TOKEN_B, lotteries: ["ssq", "dlt"] });
  await store.registerDevice({ token: "cc".repeat(32), lotteries: ["dlt"] });
  const apns = fakeApns();

  const first = await pushDraw({ lotteryType: "ssq", issue: "2026130", store, apns });
  assert.deepEqual(first, { push: "sent", devices: 2, delivered: 1, push_errors: ["Unregistered"] });
  assert.deepEqual(apns.sent[0].tokens, [TOKEN_A, TOKEN_B]);
  const { message } = apns.sent[0];
  assert.equal(message.title, "双色球 2026130 期开奖");
  assert.equal(message.body, "05 06 10 25 27 30 + 11");
  assert.equal(message.mutableContent, true);
  assert.equal(message.contentAvailable, true);
  assert.equal(message.collapseId, "draw-ssq-2026130");
  assert.equal(message.data.draw.issue, "2026130");
  assert.equal(db.tables.push_devices.find((d) => d.token === TOKEN_B).disabled, true);
  assert.equal(db.tables.draw_push_log[0].delivered, 1);

  assert.deepEqual(await pushDraw({ lotteryType: "ssq", issue: "2026130", store, apns }), { push: "already_sent" });
  assert.equal(apns.sent.length, 1);
});

test("不推的几种情况都不占这一期的名额", async () => {
  const db = createFakeDb({ lottery_draws: [ssqRow, { ...ssqRow, issue: "2026131", numbers: {} }] });
  const store = new DrawPushStore(db);
  const apns = fakeApns();
  assert.deepEqual(await pushDraw({ lotteryType: "ssq", issue: "2026130", store, apns: null }), { push: "not_configured" });
  assert.deepEqual(await pushDraw({ lotteryType: "ssq", issue: "2026130", store, apns }), { push: "no_devices" });
  assert.deepEqual(await pushDraw({ lotteryType: "ssq", issue: "2026131", store, apns }), { push: "no_numbers" });
  assert.deepEqual(await pushDraw({ lotteryType: "ssq", issue: "2099001", store, apns }), { push: "no_numbers" });
  assert.equal(db.tables.draw_push_log?.length ?? 0, 0);
  // 之后有设备订阅了，这一期还能推
  await store.registerDevice({ token: TOKEN_A, lotteries: ["ssq"] });
  assert.equal((await pushDraw({ lotteryType: "ssq", issue: "2026130", store, apns })).push, "sent");
});
