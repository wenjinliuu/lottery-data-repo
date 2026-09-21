import test from "node:test";
import assert from "node:assert/strict";
import { createLotteryHttpServer } from "../src/http-server.mjs";

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
  const server = createLotteryHttpServer(service());
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
    const response = await fetch(`${base}/lottery/v2/draws/ssq?limit=100`);
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
