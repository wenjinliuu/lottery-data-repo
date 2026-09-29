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

/// 模拟 CloudBase PostgreSQL 接口：不管要多少，单次最多回 `cap` 行。
function cappedCalendarDatabase(rows, cap) {
  const calls = [];
  const builder = (filters = {}) => ({
    select: () => builder(filters),
    gte: (_, value) => builder({ ...filters, start: value }),
    lte: (_, value) => builder({ ...filters, end: value }),
    eq: (_, value) => builder({ ...filters, type: value }),
    order: () => builder(filters),
    range: async (from, to) => {
      calls.push([from, to]);
      const matched = rows.filter((row) =>
        row.draw_date >= filters.start && row.draw_date <= filters.end
        && (!filters.type || row.lottery_type === filters.type));
      return { data: matched.slice(from, Math.min(to + 1, from + cap)), error: null };
    },
  });
  return { calls, from: () => builder() };
}

function fullYearCalendar(total) {
  const types = ["ssq", "dlt", "fc3d", "pl3", "pl5", "kl8", "qlc", "qxc"];
  const start = Date.UTC(2026, 0, 1);
  return Array.from({ length: total }, (_, index) => ({
    lottery_type: types[index % types.length],
    issue: String(index),
    draw_date: new Date(start + Math.floor(index * 365 / total) * 86_400_000).toISOString().slice(0, 10),
    draw_time: "21:15:00",
    sale_close_time: "20:00:00",
  }));
}

for (const cap of [1000, 300]) {
  test(`calendar pages past the ${cap}-row response cap`, async () => {
    const rows = fullYearCalendar(2006);
    const database = cappedCalendarDatabase(rows, cap);
    const payload = await new LotteryApiService(database, () => new Date("2026-09-29T00:00:00Z")).calendar(2026);
    assert.equal(payload.entries.length, 2006);
    assert.equal(payload.entries.at(-1).date, "2026-12-31");
    assert.equal(new Set(payload.entries.map((entry) => entry.issue)).size, 2006);
  });
}

test("single-lottery calendar is one query", async () => {
  const database = cappedCalendarDatabase(fullYearCalendar(2006), 1000);
  const rows = await new LotteryApiService(database).calendarRows(2026, "ssq");
  assert.equal(rows.length, 251);
  assert.equal(database.calls.length, 1);
});
