import test from "node:test";
import assert from "node:assert/strict";
import { LotteryApiService, handleHttp } from "../src/api-handler.mjs";

function service() {
  return {
    bootstrap: async () => ({ schema: "bootstrap" }),
    health: async () => ({ ok: true, generated_at: "now", latest: {} }),
    recent: async (type, limit) => ({ type, limit }),
    byYear: async (type, year) => ({ type, year }),
    calendar: async (year) => ({ year }),
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

test("supports HEAD on V2 and rejects removed V1 paths", async () => {
  const head = await handleHttp({ httpMethod: "HEAD", path: "/lottery/v2/bootstrap" }, service());
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, "");
  assert.match(head.headers["cache-control"], /max-age=60/);
  const removed = await handleHttp({ httpMethod: "GET", path: "/lottery/v1/latest.json" }, service());
  assert.equal(removed.statusCode, 404);
});


test("V2 by-year exposes numeric year and the real earliest year", async () => {
  class ContractService extends LotteryApiService {
    constructor() {
      super({}, () => new Date("2026-09-21T00:00:00Z"));
    }

    async drawRows() {
      return [];
    }

    async earliestYear() {
      return 2026;
    }
  }

  const payload = await new ContractService().byYear("ssq", 2026);
  assert.equal(payload.schema, "duigehao.lottery.year");
  assert.equal(payload.year, 2026);
  assert.equal(typeof payload.year, "number");
  assert.equal(payload.earliest_year, 2026);
});

test("V2 calendar exposes a numeric year", async () => {
  class ContractService extends LotteryApiService {
    constructor() {
      super({}, () => new Date("2026-09-21T00:00:00Z"));
    }

    async calendarRows() {
      return [];
    }
  }

  const payload = await new ContractService().calendar(2026);
  assert.equal(payload.schema, "duigehao.lottery.calendar");
  assert.equal(payload.year, 2026);
  assert.equal(typeof payload.year, "number");
});

test("V2 health contract has one canonical schema", async () => {
  class ContractService extends LotteryApiService {
    constructor() {
      super({}, () => new Date("2026-09-21T00:00:00Z"));
    }

    async drawRows(type) {
      return [{ issue: `${type}-1`, draw_date: "2026-09-20" }];
    }
  }

  const payload = await new ContractService().health();
  assert.equal(payload.schema, "duigehao.lottery.health");
  assert.equal(payload.version, 2);
  assert.equal(payload.ok, true);
  assert.equal(payload.source, "cloudbase_postgresql");
});
