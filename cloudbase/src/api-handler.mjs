import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createCloudBaseDatabase } from "./repository.mjs";
import {
  LOTTERY_TYPES,
  RECENT_LIMIT,
  materializeCalendarEntry,
  materializeV2Draw,
  nextMetadata,
} from "./api-contract.mjs";

const configUrl = [
  new URL("../config/lotteries.json", import.meta.url),
  new URL("../../config/lotteries.json", import.meta.url),
].find((candidate) => existsSync(fileURLToPath(candidate)));
if (!configUrl) throw new Error("Missing config/lotteries.json");
const config = JSON.parse(readFileSync(configUrl, "utf8"));

const DRAW_COLUMNS = [
  "issue", "draw_date", "draw_time", "numbers", "prize_pool", "sales_amount",
  "prize_details", "source_fetched_at",
].join(",");
const CALENDAR_COLUMNS = "lottery_type,issue,draw_date,draw_time,sale_close_time";

function ensureSuccess(result, operation) {
  if (result?.error) {
    throw new Error(`${operation}: ${result.error.message ?? JSON.stringify(result.error)}`);
  }
  return result?.data ?? [];
}

function beijingClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type) => parts.find((item) => item.type === type)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const time = `${get("hour")}:${get("minute")}:${get("second")}`;
  return { date, local: `${date} ${time}`, iso: `${date}T${time}+08:00` };
}

function yearBounds(year) {
  return [`${year}-01-01`, `${year}-12-31`];
}

export class LotteryApiService {
  constructor(database = createCloudBaseDatabase(), now = () => new Date()) {
    this.db = database;
    this.now = now;
  }

  async drawRows(lotteryType, limit = RECENT_LIMIT, year = null) {
    let query = this.db
      .from("lottery_draws")
      .select(DRAW_COLUMNS)
      .eq("lottery_type", lotteryType)
      .order("draw_date", { ascending: false })
      .order("issue", { ascending: false });
    if (year !== null) {
      const [start, end] = yearBounds(year);
      query = query.gte("draw_date", start).lte("draw_date", end);
    }
    return ensureSuccess(await query.limit(limit), `read draws/${lotteryType}`);
  }

  async calendarRows(year, lotteryType = null) {
    const [start, end] = yearBounds(year);
    let query = this.db
      .from("lottery_calendar")
      .select(CALENDAR_COLUMNS)
      .gte("draw_date", start)
      .lte("draw_date", end);
    if (lotteryType) query = query.eq("lottery_type", lotteryType);
    return ensureSuccess(
      await query.order("draw_date", { ascending: true }).order("lottery_type").limit(3000),
      `read calendar/${year}`,
    );
  }

  async earliestYear(lotteryType) {
    const rows = ensureSuccess(
      await this.db
        .from("lottery_draws")
        .select("draw_date")
        .eq("lottery_type", lotteryType)
        .order("draw_date", { ascending: true })
        .limit(1),
      `read earliest year/${lotteryType}`,
    );
    if (!rows[0]) return null;
    const year = Number(String(rows[0].draw_date).slice(0, 4));
    return Number.isInteger(year) ? year : null;
  }

  async latestAndNext(lotteryType) {
    const clock = beijingClock(this.now());
    const lotteryConfig = config.lotteries[lotteryType];
    const [latestRows, calendarRows] = await Promise.all([
      this.drawRows(lotteryType, 1),
      ensureSuccess(
        await this.db
          .from("lottery_calendar")
          .select(CALENDAR_COLUMNS)
          .eq("lottery_type", lotteryType)
          .gte("draw_date", clock.date)
          .order("draw_date", { ascending: true })
          .limit(8),
        `read next calendar/${lotteryType}`,
      ),
    ]);
    if (!latestRows[0]) throw new Error(`No draw data for ${lotteryType}`);
    return {
      row: latestRows[0],
      next: nextMetadata(latestRows[0], calendarRows, lotteryConfig, clock.local),
    };
  }

  async bootstrap() {
    const generatedAt = beijingClock(this.now()).iso;
    const pairs = await Promise.all(
      LOTTERY_TYPES.map(async (lotteryType) => [lotteryType, await this.latestAndNext(lotteryType)]),
    );
    const latest = {};
    const schedule = {};
    for (const [lotteryType, { row, next }] of pairs) {
      const item = config.lotteries[lotteryType];
      latest[lotteryType] = materializeV2Draw(row);
      schedule[lotteryType] = {
        name: item.name,
        weekdays: item.draw_weekdays ?? [],
        draw_time: item.draw_time ?? "",
        sale_close_time: item.sale_close_time ?? "",
        next,
      };
    }
    return {
      schema: "duigehao.lottery.bootstrap",
      version: 2,
      generated_at: generatedAt,
      timezone: "Asia/Shanghai",
      latest,
      schedule,
    };
  }

  async recent(lotteryType, limit) {
    const rows = await this.drawRows(lotteryType, limit);
    return {
      schema: "duigehao.lottery.recent",
      version: 2,
      lottery_type: lotteryType,
      generated_at: beijingClock(this.now()).iso,
      limit,
      draws: rows.map(materializeV2Draw),
    };
  }

  async byYear(lotteryType, year) {
    const [rows, earliestYear] = await Promise.all([
      this.drawRows(lotteryType, 500, year),
      this.earliestYear(lotteryType),
    ]);
    return {
      schema: "duigehao.lottery.year",
      version: 2,
      lottery_type: lotteryType,
      year: Number(year),
      earliest_year: earliestYear,
      generated_at: beijingClock(this.now()).iso,
      draws: rows.map(materializeV2Draw),
    };
  }

  async calendar(year) {
    const rows = await this.calendarRows(year);
    return {
      schema: "duigehao.lottery.calendar",
      version: 2,
      year: Number(year),
      generated_at: beijingClock(this.now()).iso,
      entries: rows.map(materializeCalendarEntry),
    };
  }

  async health() {
    const pairs = await Promise.all(
      LOTTERY_TYPES.map(async (type) => [type, (await this.drawRows(type, 1))[0]]),
    );
    const latest = Object.fromEntries(pairs.map(([type, row]) => [
      type,
      row ? { issue: String(row.issue), date: String(row.draw_date).slice(0, 10) } : null,
    ]));
    return {
      schema: "duigehao.lottery.health",
      version: 2,
      ok: Object.values(latest).every(Boolean),
      generated_at: beijingClock(this.now()).iso,
      source: "cloudbase_postgresql",
      latest,
    };
  }

}

function methodOf(event) {
  return String(
    event.httpMethod
      ?? event.requestContext?.http?.method
      ?? event.requestContext?.httpMethod
      ?? "GET",
  ).toUpperCase();
}

function requestPath(event) {
  const raw = String(
    event.rawPath
      ?? event.path
      ?? event.requestContext?.http?.path
      ?? event.requestContext?.path
      ?? "/",
  );
  const withoutQuery = raw.split("?")[0].replace(/\/+$/, "") || "/";
  return withoutQuery
    .replace(/^\/lottery-api(?=\/|$)/, "")
    .replace(/^\/lottery(?=\/|$)/, "")
    || "/";
}

function queryOf(event) {
  return event.queryStringParameters ?? {};
}

function validLotteryType(value) {
  return LOTTERY_TYPES.includes(value);
}

function validYear(value) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : null;
}

function response(statusCode, payload, { head = false, cache = 60 } = {}) {
  return {
    statusCode,
    isBase64Encoded: false,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${cache}, stale-while-revalidate=${Math.max(cache, 300)}`,
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, HEAD, OPTIONS",
      "x-content-type-options": "nosniff",
    },
    body: head ? "" : JSON.stringify(payload),
  };
}

export async function handleHttp(event = {}, service = new LotteryApiService()) {
  const method = methodOf(event);
  const head = method === "HEAD";
  if (method === "OPTIONS") return response(204, {}, { head: true, cache: 86400 });
  if (method !== "GET" && !head) {
    return response(405, { error: "method_not_allowed" }, { cache: 0 });
  }

  const path = requestPath(event);
  const query = queryOf(event);
  try {
    if (path === "/" || path === "/v2" || path === "/v2/index") {
      return response(200, {
        schema: "duigehao.lottery.index",
        version: 2,
        source: "cloudbase_postgresql",
        routes: {
          bootstrap: "/v2/bootstrap",
          recent: "/v2/draws/{lottery_type}",
          by_year: "/v2/by-year/{lottery_type}/{year}",
          calendar: "/v2/calendar/{year}",
          health: "/v2/health",
        },
        lotteries: LOTTERY_TYPES,
        recent_limit: RECENT_LIMIT,
      }, { head, cache: 3600 });
    }
    if (path === "/v2/bootstrap") {
      return response(200, await service.bootstrap(), { head, cache: 60 });
    }
    if (path === "/v2/health") {
      return response(200, await service.health(), { head, cache: 30 });
    }
    let match = /^\/v2\/draws\/([a-z0-9]+)$/.exec(path);
    if (match) {
      if (!validLotteryType(match[1])) {
        return response(404, { error: "unknown_lottery_type" }, { cache: 300 });
      }
      const requested = Number(query.limit ?? RECENT_LIMIT);
      const limit = Number.isInteger(requested) && requested >= 1
        ? Math.min(requested, RECENT_LIMIT)
        : RECENT_LIMIT;
      return response(200, await service.recent(match[1], limit), { head, cache: 60 });
    }
    match = /^\/v2\/by-year\/([a-z0-9]+)\/(\d{4})$/.exec(path);
    if (match) {
      const year = validYear(match[2]);
      if (!validLotteryType(match[1]) || year === null) {
        return response(404, { error: "not_found" }, { cache: 300 });
      }
      return response(200, await service.byYear(match[1], year), { head, cache: 3600 });
    }
    match = /^\/v2\/calendar\/(\d{4})$/.exec(path);
    if (match) {
      const year = validYear(match[1]);
      if (year === null) return response(404, { error: "not_found" }, { cache: 300 });
      return response(200, await service.calendar(year), { head, cache: 86400 });
    }

    return response(404, { error: "not_found" }, { cache: 300 });
  } catch (error) {
    console.error("lottery-api", { path, error: String(error) });
    return response(500, { error: "internal_error" }, { cache: 0 });
  }
}

export async function main(event = {}) {
  return handleHttp(event);
}
