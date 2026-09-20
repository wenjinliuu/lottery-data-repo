import test from "node:test";
import assert from "node:assert/strict";
import { handleHttp } from "../src/api-handler.mjs";

function service() {
  return {
    bootstrap: async () => ({ schema: "bootstrap" }),
    health: async () => ({ ok: true, generated_at: "now", latest: {} }),
    recent: async (type, limit) => ({ type, limit }),
    byYear: async (type, year) => ({ type, year }),
    calendar: async (year) => ({ year }),
    v1Latest: async () => ({ schema: "latest" }),
    v1Calendar: async () => ({ schema: "calendar" }),
    v1YearCalendar: async (year) => ({ year }),
    v1Recent: async (type) => ({ type }),
    v1ByYear: async (type, year) => ({ type, year }),
  };
}

test("routes v2 recent and caps limit at 30", async () => {
  const result = await handleHttp({
    httpMethod: "GET",
    path: "/lottery/v2/draws/ssq",
    queryStringParameters: { limit: "100" },
  }, service());
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body), { type: "ssq", limit: 30 });
});

test("rejects writes and unknown lotteries", async () => {
  const write = await handleHttp({ httpMethod: "POST", path: "/v2/bootstrap" }, service());
  assert.equal(write.statusCode, 405);
  const unknown = await handleHttp({ httpMethod: "GET", path: "/v2/draws/nope" }, service());
  assert.equal(unknown.statusCode, 404);
});

test("supports HEAD and v1 compatibility paths", async () => {
  const head = await handleHttp({ httpMethod: "HEAD", path: "/lottery/v1/latest.json" }, service());
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, "");
  assert.match(head.headers["cache-control"], /max-age=60/);
  const year = await handleHttp({
    httpMethod: "GET",
    path: "/lottery/v1/calendar/2026.json",
  }, service());
  assert.deepEqual(JSON.parse(year.body), { year: 2026 });
});
