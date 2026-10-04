import test from "node:test";
import assert from "node:assert/strict";
import { createApiAccess, API_KEY_HEADER } from "../src/api-access.mjs";
import { handleHttp } from "../src/api-handler.mjs";
import { TEST_API_KEY, authenticatedEvent, testAccess } from "./access-fixture.mjs";

test("rejects missing/wrong/query-string keys before any database service call", async () => {
  let calls = 0;
  const service = { bootstrap: async () => { calls += 1; return {}; } };
  for (const event of [
    { path: "/v2/bootstrap" },
    { path: "/v2/bootstrap", headers: { [API_KEY_HEADER]: "wrong" } },
    { path: "/v2/bootstrap", queryStringParameters: { api_key: TEST_API_KEY } },
  ]) {
    const result = await handleHttp(event, service, testAccess);
    assert.equal(result.statusCode, 401);
    assert.equal(result.headers["cache-control"], "no-store");
    assert.deepEqual(JSON.parse(result.body), { error: "unauthorized" });
  }
  assert.equal(calls, 0);
});

test("accepts case-insensitive header names and protects every read route", async () => {
  const check = createApiAccess({ apiKey: TEST_API_KEY });
  assert.equal(check({ headers: { "X-Lottery-Api-Key": TEST_API_KEY } }), null);
  for (const path of ["/", "/v2", "/v2/bootstrap", "/v2/status", "/v2/health", "/v2/draws/ssq", "/v2/by-year/ssq/2026", "/v2/calendar/2026"]) {
    const result = await handleHttp({ path }, null, check);
    assert.equal(result.statusCode, 401, path);
  }
});

test("missing or short server key fails closed, including the default service path", async () => {
  for (const apiKey of ["", "short"]) {
    const result = await handleHttp(authenticatedEvent({ path: "/v2/bootstrap" }), null, createApiAccess({ apiKey }));
    assert.equal(result.statusCode, 503);
  }
});

test("rejects duplicate and oversized key values", () => {
  for (const headers of [
    { [API_KEY_HEADER]: [TEST_API_KEY, TEST_API_KEY] },
    { [API_KEY_HEADER]: TEST_API_KEY, "X-Lottery-Api-Key": TEST_API_KEY },
    { [API_KEY_HEADER]: "a".repeat(257) },
  ]) assert.equal(testAccess({ headers }).statusCode, 401);
});

test("preflight needs no key, HEAD does, and authorized responses cannot enter shared caches", async () => {
  const preflight = await handleHttp({ httpMethod: "OPTIONS", path: "/v2/bootstrap" }, null, testAccess);
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers["access-control-allow-headers"], API_KEY_HEADER);
  const denied = await handleHttp({ httpMethod: "HEAD", path: "/v2/bootstrap" }, null, testAccess);
  assert.equal(denied.statusCode, 401);
  assert.equal(denied.body, "");
  const ok = await handleHttp(authenticatedEvent({ path: "/v2/bootstrap" }), { bootstrap: async () => ({ ok: true }) }, testAccess);
  assert.equal(ok.statusCode, 200);
  assert.match(ok.headers["cache-control"], /^private,/);
  assert.equal(ok.headers.vary, API_KEY_HEADER);
});
