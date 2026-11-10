import test from "node:test";
import assert from "node:assert/strict";
import { createLotteryHttpServer } from "../src/http-server.mjs";

import { TEST_API_KEY, testAccess } from "./access-fixture.mjs";

function service() {
  return {
    bootstrap: async () => ({ schema: "bootstrap" }),
    health: async () => ({ ok: true, generated_at: "now", latest: {} }),
    recent: async (type, limit) => ({ type, limit }),
    byYear: async (type, year) => ({ type, year }),
    calendar: async (year) => ({ year }),
  };
}

async function withServer(run) {
  const server = createLotteryHttpServer(service(), testAccess);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("serves the API contract over a real HTTP socket", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/lottery/v2/draws/ssq?limit=100`, { headers: { "X-Lottery-Api-Key": TEST_API_KEY } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.deepEqual(await response.json(), { type: "ssq", limit: 30 });
  });
});

test("returns 405 for writes without reading the request body", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/lottery/v2/bootstrap`, { method: "POST" });
    assert.equal(response.status, 405);
    assert.deepEqual(await response.json(), { error: "method_not_allowed" });
  });
});

 test("rejects unauthenticated requests over the real HTTP entry point", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/lottery/v2/bootstrap`);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});

test("accepts a JSON body on the personal ticket route and rejects oversized ones", async () => {
  const { UserTicketStore } = await import("../src/user-tickets.mjs");
  const { createUserAccess } = await import("../src/user-access.mjs");
  const { createFakeDb } = await import("./fake-db.mjs");
  const userKey = "unit-test-only-user-key-not-for-production";
  const server = createLotteryHttpServer(service(), testAccess, {
    store: new UserTicketStore(createFakeDb()),
    checkAccess: createUserAccess({ userKey }),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { "X-Lottery-User-Key": userKey, "content-type": "application/json" };
    const ticket = {
      id: "a",
      updated_at: "2026-11-10T10:00:00Z",
      record: { gameKey: "ssq", targetExpect: "2026130", numbers: { red: [1, 2, 3, 4, 5, 6], blue: [7] } },
    };
    const posted = await fetch(`${base}/lottery/v2/me/tickets`, { method: "POST", headers, body: JSON.stringify({ tickets: [ticket] }) });
    assert.equal(posted.status, 200);
    assert.equal((await posted.json()).accepted, 1);
    const pulled = await fetch(`${base}/lottery/v2/me/tickets?since=0`, { headers });
    assert.deepEqual((await pulled.json()).tickets.map((item) => item.id), ["a"]);
    // 读取密钥换不来个人数据
    const wrongKey = await fetch(`${base}/lottery/v2/me/tickets`, { headers: { "X-Lottery-Api-Key": TEST_API_KEY } });
    assert.equal(wrongKey.status, 401);
    const huge = await fetch(`${base}/lottery/v2/me/tickets`, { method: "POST", headers, body: "x".repeat(1024 * 1024 + 10) })
      .then((response) => response.status, () => "connection closed");
    assert.ok(huge === 500 || huge === "connection closed");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
