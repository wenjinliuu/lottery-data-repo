import test from "node:test";
import assert from "node:assert/strict";
import { UserTicketStore, ValidationError } from "../src/user-tickets.mjs";
import { handleHttp } from "../src/api-handler.mjs";
import { createUserAccess, USER_KEY_HEADER } from "../src/user-access.mjs";
import { settleAndNotify, notificationText } from "../src/settle.mjs";
import { createFakeDb } from "./fake-db.mjs";
import { testAccess } from "./access-fixture.mjs";

const USER_KEY = "unit-test-only-user-key-not-for-production";
const checkAccess = createUserAccess({ userKey: USER_KEY });

const ticket = (id, updatedAt, numbers = { red: [1, 2, 3, 4, 7, 8], blue: [11] }, extra = {}) => ({
  id,
  updated_at: updatedAt,
  record: { id, batchId: "b1", gameKey: "ssq", targetExpect: "2026130", multiple: 1, numbers },
  ...extra,
});
const drawRow = {
  lottery_type: "ssq",
  issue: "2026130",
  numbers: { red: [5, 6, 10, 25, 27, 30], blue: [11] },
  prize_details: [{ prize_name: "六等奖", prize_amount: "5" }],
};

function call(db, { method = "GET", path, query = {}, body, key = USER_KEY }) {
  return handleHttp({
    httpMethod: method,
    path,
    queryStringParameters: query,
    headers: key ? { [USER_KEY_HEADER]: key } : {},
    body: body === undefined ? "" : JSON.stringify(body),
  }, null, testAccess, { store: new UserTicketStore(db), checkAccess });
}

test("个人接口必须带个人密钥；开奖读取密钥不能代替它", async () => {
  const db = createFakeDb();
  assert.equal((await call(db, { path: "/lottery/v2/me/tickets", key: null })).statusCode, 401);
  assert.equal((await call(db, { path: "/lottery/v2/me/tickets", key: "wrong" })).statusCode, 401);
  const ok = await call(db, { path: "/lottery/v2/me/tickets" });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers["cache-control"], "no-store");
  // 没配置密钥时一律拒绝
  const closed = await handleHttp({ httpMethod: "GET", path: "/v2/me/tickets", headers: { [USER_KEY_HEADER]: USER_KEY } },
    null, testAccess, { store: new UserTicketStore(db), checkAccess: createUserAccess({ userKey: "" }) });
  assert.equal(closed.statusCode, 503);
});

test("上传后能按游标增量拉回；重复上传和旧版本被跳过", async () => {
  const db = createFakeDb();
  const first = JSON.parse((await call(db, {
    method: "POST", path: "/v2/me/tickets",
    body: { tickets: [ticket("a", "2026-11-10T10:00:00Z"), ticket("b", "2026-11-10T10:00:00Z")] },
  })).body);
  assert.deepEqual([first.accepted, first.skipped], [2, 0]);

  const pulled = JSON.parse((await call(db, { path: "/v2/me/tickets", query: { since: "0" } })).body);
  assert.deepEqual(pulled.tickets.map((item) => item.id), ["a", "b"]);
  assert.equal(pulled.cursor, first.cursor);
  assert.equal(pulled.has_more, false);

  const again = JSON.parse((await call(db, {
    method: "POST", path: "/v2/me/tickets",
    body: { tickets: [ticket("a", "2026-11-10T10:00:00Z"), ticket("b", "2026-11-10T09:00:00Z")] },
  })).body);
  assert.deepEqual([again.accepted, again.skipped], [0, 2]);
  assert.equal(again.cursor, first.cursor);

  // 只改了 a：增量里只有 a，而且带着删除标记
  await call(db, { method: "POST", path: "/v2/me/tickets", body: { tickets: [ticket("a", "2026-11-10T11:00:00Z", undefined, { deleted: true })] } });
  const delta = JSON.parse((await call(db, { path: "/v2/me/tickets", query: { since: String(first.cursor) } })).body);
  assert.deepEqual(delta.tickets.map((item) => [item.id, item.deleted]), [["a", true]]);
});

test("分页：limit 不够时 has_more 为真，接着游标能拉完", async () => {
  const db = createFakeDb();
  await call(db, { method: "POST", path: "/v2/me/tickets", body: { tickets: ["a", "b", "c"].map((id) => ticket(id, "2026-11-10T10:00:00Z")) } });
  const page1 = JSON.parse((await call(db, { path: "/v2/me/tickets", query: { limit: "2" } })).body);
  assert.equal(page1.has_more, true);
  const page2 = JSON.parse((await call(db, { path: "/v2/me/tickets", query: { since: String(page1.cursor), limit: "2" } })).body);
  assert.deepEqual([...page1.tickets, ...page2.tickets].map((item) => item.id), ["a", "b", "c"]);
  assert.equal(page2.has_more, false);
});

test("坏请求返回 400，不写库", async () => {
  const db = createFakeDb();
  const bad = async (body) => (await call(db, { method: "POST", path: "/v2/me/tickets", body })).statusCode;
  assert.equal(await bad({ tickets: "nope" }), 400);
  assert.equal(await bad({ tickets: [{ id: "", updated_at: "2026-11-10T10:00:00Z", record: {} }] }), 400);
  assert.equal(await bad({ tickets: [{ id: "x", updated_at: "not a date", record: { gameKey: "ssq" } }] }), 400);
  assert.equal(await bad({ tickets: [{ id: "x", updated_at: "2026-11-10T10:00:00Z", record: { gameKey: "sports" } }] }), 400);
  assert.equal(await bad({ tickets: Array.from({ length: 201 }, (_, i) => ticket(`t${i}`, "2026-11-10T10:00:00Z")) }), 400);
  assert.equal((await call(db, { method: "DELETE", path: "/v2/me/tickets" })).statusCode, 405);
  assert.equal((await call(db, { path: "/v2/me/nope" })).statusCode, 404);
  assert.equal(db.tables.user_tickets?.length ?? 0, 0);
  await assert.rejects(new UserTicketStore(db).registerDevice({ token: "xyz" }), ValidationError);
});

test("开奖后才录的票，上传时当场核对；改了号码结果作废重算", async () => {
  const db = createFakeDb({ lottery_draws: [drawRow] });
  await call(db, { method: "POST", path: "/v2/me/tickets", body: { tickets: [ticket("a", "2026-11-10T10:00:00Z")] } });
  let [row] = JSON.parse((await call(db, { path: "/v2/me/tickets" })).body).tickets;
  assert.deepEqual([row.settlement.status, row.settlement.prize_name, row.settlement.amount], ["won", "六等奖", 5]);

  await call(db, { method: "POST", path: "/v2/me/tickets", body: { tickets: [ticket("a", "2026-11-10T12:00:00Z", { red: [1, 2, 3, 4, 7, 8], blue: [9] })] } });
  [row] = JSON.parse((await call(db, { path: "/v2/me/tickets" })).body).tickets;
  assert.equal(row.settlement.status, "lost");
});

function fakeApns() {
  const sent = [];
  return { sent, send: async (devices, message) => { sent.push({ devices, message }); return devices.map((d) => ({ token: d.token, ok: !d.bad, gone: Boolean(d.bad), reason: d.bad ? "Unregistered" : "" })); } };
}

test("开奖推送：每期只推一次；没有票不推；失效的令牌被停用", async () => {
  const db = createFakeDb({
    lottery_draws: [drawRow],
    user_push_devices: [
      { token: "good", environment: "production", bundle_id: "", disabled: false },
      { token: "dead", environment: "production", bundle_id: "", disabled: false, bad: true },
    ],
  });
  const store = new UserTicketStore(db);
  const apns = fakeApns();
  const none = await settleAndNotify({ lotteryType: "ssq", issue: "2026130", store, apns });
  assert.equal(none.notified, null);
  assert.equal(apns.sent.length, 0);

  // 先清掉上传时的当场核对，模拟「开奖前录入」
  await store.upsert([ticket("a", "2026-11-10T10:00:00Z"), ticket("b", "2026-11-10T10:00:00Z", { red: [1, 2, 3, 4, 7, 8], blue: [9] })]);
  const first = await settleAndNotify({ lotteryType: "ssq", issue: "2026130", store, apns });
  assert.deepEqual([first.notified, first.tickets, first.won, first.amount, first.delivered], ["result", 2, 1, 5, 1]);
  assert.deepEqual(apns.sent[0].message.title, "双色球 2026130 期开奖了");
  assert.equal(apns.sent[0].message.body, "2 注中 1 注：六等奖 1 注，共 5 元");
  assert.equal(db.tables.user_push_devices.find((d) => d.token === "dead").disabled, true);

  const second = await settleAndNotify({ lotteryType: "ssq", issue: "2026130", store, apns });
  assert.equal(second.notified, null);
  assert.equal(apns.sent.length, 1);
});

test("奖金待公布时先推一次，落定后再推一次", async () => {
  const pendingDraw = { ...drawRow, prize_details: [] };
  const db = createFakeDb({ lottery_draws: [pendingDraw], user_push_devices: [{ token: "good", environment: "production", bundle_id: "", disabled: false }] });
  const store = new UserTicketStore(db);
  const apns = fakeApns();
  await store.upsert([ticket("a", "2026-11-10T10:00:00Z")]);
  assert.equal((await settleAndNotify({ lotteryType: "ssq", issue: "2026130", store, apns })).notified, "result");
  assert.equal(apns.sent[0].message.body, "1 注中 1 注：六等奖 1 注，奖金待公布");
  // 奖金还没出来，再跑一遍不推
  assert.equal((await settleAndNotify({ lotteryType: "ssq", issue: "2026130", store, apns })).notified, null);
  db.tables.lottery_draws[0].prize_details = drawRow.prize_details;
  assert.equal((await settleAndNotify({ lotteryType: "ssq", issue: "2026130", store, apns })).notified, "final");
  assert.equal(apns.sent[1].message.body, "六等奖 1 注，共 5 元");
  assert.equal((await settleAndNotify({ lotteryType: "ssq", issue: "2026130", store, apns })).notified, null);
  assert.equal(apns.sent.length, 2);
});

test("没配推送密钥：照常核对，只是不推", async () => {
  const db = createFakeDb({ lottery_draws: [drawRow] });
  const store = new UserTicketStore(db);
  await store.upsert([ticket("a", "2026-11-10T10:00:00Z")]);
  const result = await settleAndNotify({ lotteryType: "ssq", issue: "2026130", store, apns: null });
  assert.equal(result.push, "not_configured");
  assert.equal(db.tables.user_tickets[0].settle_status, "won");
});

test("全没中的文案", () => {
  assert.deepEqual(
    notificationText({ lottery_type: "dlt", issue: "26130", tickets: 3, won: 0, floating: 0, amount: 0, prizes: {} }, "result"),
    { title: "大乐透 26130 期开奖了", body: "3 注都没中" },
  );
});
