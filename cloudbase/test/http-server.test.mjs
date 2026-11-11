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

test("registers a push device over a real socket and rejects oversized bodies", async () => {
  const { DrawPushStore } = await import("../src/draw-push.mjs");
  const { createFakeDb } = await import("./fake-db.mjs");
  const db = createFakeDb();
  const server = createLotteryHttpServer(service(), testAccess, new DrawPushStore(db));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { "X-Lottery-Api-Key": TEST_API_KEY, "content-type": "application/json" };
    const body = JSON.stringify({ token: "ab".repeat(32), environment: "production", bundle_id: "app", lotteries: ["ssq"] });
    const ok = await fetch(`${base}/lottery/v2/devices`, { method: "POST", headers, body });
    assert.equal(ok.status, 200);
    assert.equal(db.tables.push_devices.length, 1);
    const noKey = await fetch(`${base}/lottery/v2/devices`, { method: "POST", body });
    assert.equal(noKey.status, 401);
    const huge = await fetch(`${base}/lottery/v2/devices`, { method: "POST", headers, body: "x".repeat(20 * 1024) })
      .then((response) => response.status, () => "connection closed");
    assert.ok(huge === 500 || huge === "connection closed");
    assert.equal(db.tables.push_devices.length, 1);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
