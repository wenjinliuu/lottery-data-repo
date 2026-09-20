import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCloudBaseDatabase } from "../src/repository.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const root = path.resolve(packageRoot, "..");
const config = JSON.parse(await readFile(path.join(root, "config/lotteries.json"), "utf8"));
const outputDir = path.join(root, config.export.output_dir ?? "public_data");
const pageSize = 500;
const v2RecentLimit = Number(config.export.v2_recent_per_lottery ?? 30);

function ensureSuccess(result, operation) {
  if (result?.error) {
    throw new Error(`${operation}: ${result.error.message ?? JSON.stringify(result.error)}`);
  }
  return result?.data ?? [];
}

function beijingNow() {
  const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().replace("Z", "+08:00");
}

function localDateTime(iso) {
  return String(iso).slice(0, 19).replace("T", " ");
}

function timeText(value, fallback) {
  const raw = String(value ?? "").trim() || fallback;
  return raw.length === 5 ? `${raw}:00` : raw;
}

function dateText(value) {
  return String(value ?? "").slice(0, 10);
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => (
      item !== null
      && item !== undefined
      && item !== ""
      && (!Array.isArray(item) || item.length > 0)
    )),
  );
}

export function materializePublicDraw(row, lotteryType, lotteryConfig, nextCalendar) {
  const stored = row.compatibility_payload && typeof row.compatibility_payload === "object"
    ? structuredClone(row.compatibility_payload)
    : {};
  const fetchedAt = row.source_fetched_at ?? stored.fetched_at ?? stored.source?.fetched_at ?? null;
  const rawPublic = row.source_payload && typeof row.source_payload === "object"
    ? structuredClone(row.source_payload)
    : (stored.raw_public_json ?? {});

  const draw = {
    ...stored,
    schema: stored.schema ?? "random_draw_agent_draw",
    version: stored.version ?? 1,
    lottery_type: lotteryType,
    lottery_name: stored.lottery_name ?? lotteryConfig.name,
    caipiaoid: stored.caipiaoid ?? lotteryConfig.caipiaoid,
    issue: String(row.issue),
    draw_date: dateText(row.draw_date),
    draw_time: row.draw_time ?? stored.draw_time ?? "",
    numbers: row.numbers ?? stored.numbers ?? {},
    prize_pool: row.prize_pool ?? stored.prize_pool ?? "",
    sales_amount: row.sales_amount ?? stored.sales_amount ?? "",
    prize_details: row.prize_details ?? stored.prize_details ?? [],
    source: {
      ...(stored.source ?? {}),
      name: row.source_name ?? stored.source?.name ?? "jisuapi",
      query_url: stored.source?.query_url
        ?? `https://api.jisuapi.com/caipiao/query?appkey=***&caipiaoid=${lotteryConfig.caipiaoid}`,
      class_url: stored.source?.class_url
        ?? "https://api.jisuapi.com/caipiao/class?appkey=***",
      fetched_at: fetchedAt,
    },
    raw_public_json: {
      ...rawPublic,
      class_info: rawPublic.class_info ?? {},
    },
    fetched_at: fetchedAt,
  };

  if (!draw.next_issue && nextCalendar) {
    const nextDate = dateText(nextCalendar.draw_date);
    const openTime = timeText(nextCalendar.draw_time, lotteryConfig.draw_time);
    const closeTime = timeText(nextCalendar.sale_close_time, lotteryConfig.sale_close_time);
    Object.assign(draw, {
      next_issue: String(nextCalendar.issue),
      next_draw_date: nextDate,
      next_open_time: `${nextDate} ${openTime}`,
      next_buy_end_time: `${nextDate} ${closeTime}`,
      next_status: "inferred",
      next_source: "schedule_inference",
      next_confirmed: false,
      next_basis_issue: String(row.issue),
      next_resolution_reason: "cloudbase_calendar_next_issue",
      class_last_issue: String(row.issue),
    });
  }

  return draw;
}

function nextSaleableCalendar(calendarAsc, lotteryConfig, referenceLocal) {
  return calendarAsc.find((item) => {
    const nextDate = dateText(item.draw_date);
    const closeTime = timeText(item.sale_close_time, lotteryConfig.sale_close_time);
    return `${nextDate} ${closeTime}` > referenceLocal;
  });
}

export function resolveNextMetadata(latestRow, lotteryConfig, calendarAsc, classStatus, referenceLocal) {
  const latestIssue = String(latestRow.issue);
  const classBuyEnd = String(classStatus?.next_buy_end_time ?? "");
  const classIsCurrent = Boolean(
    classStatus
    && String(classStatus.last_issue) === latestIssue
    && classStatus.next_issue
    && String(classStatus.next_issue) !== latestIssue
    && classStatus.next_open_time
    && classBuyEnd
    && classBuyEnd > referenceLocal
  );
  if (classIsCurrent) {
    return {
      next_issue: String(classStatus.next_issue),
      next_draw_date: dateText(classStatus.next_open_time),
      next_open_time: String(classStatus.next_open_time),
      next_buy_end_time: classBuyEnd,
      next_status: "confirmed",
      next_source: "class_api",
      next_confirmed: true,
      next_basis_issue: latestIssue,
      next_resolution_reason: "class_matches_latest_draw",
      class_last_issue: latestIssue,
    };
  }

  const nextCalendar = nextSaleableCalendar(calendarAsc, lotteryConfig, referenceLocal);
  if (nextCalendar) {
    const nextDate = dateText(nextCalendar.draw_date);
    return {
      next_issue: String(nextCalendar.issue),
      next_draw_date: nextDate,
      next_open_time: `${nextDate} ${timeText(nextCalendar.draw_time, lotteryConfig.draw_time)}`,
      next_buy_end_time: `${nextDate} ${timeText(
        nextCalendar.sale_close_time,
        lotteryConfig.sale_close_time,
      )}`,
      next_status: "inferred",
      next_source: "schedule_inference",
      next_confirmed: false,
      next_basis_issue: latestIssue,
      next_resolution_reason: "cloudbase_calendar_next_saleable_issue",
      class_last_issue: latestIssue,
    };
  }

  return {
    next_issue: "",
    next_draw_date: "",
    next_open_time: "",
    next_buy_end_time: "",
    next_status: "unavailable",
    next_source: "none",
    next_confirmed: false,
    next_basis_issue: latestIssue,
    next_resolution_reason: "no_future_calendar_issue",
    class_last_issue: latestIssue,
  };
}

export function materializeV2Draw(row) {
  const prizes = (Array.isArray(row.prize_details) ? row.prize_details : []).map((item) => compactObject({
    name: item.prize_name || item.prize_level,
    match: item.require,
    winners: item.winning_count,
    amount: item.prize_amount,
    extra_winners: item.additional_count,
    extra_amount: item.additional_amount,
  }));
  return compactObject({
    issue: String(row.issue),
    date: dateText(row.draw_date),
    time: String(row.draw_time ?? ""),
    numbers: row.numbers ?? {},
    pool: String(row.prize_pool ?? ""),
    sales: String(row.sales_amount ?? ""),
    prizes,
    fetched_at: row.source_fetched_at ?? null,
  });
}

async function selectAll(db, table, columns, lotteryType) {
  const output = [];
  for (let offset = 0; ; offset += pageSize) {
    const rows = ensureSuccess(
      await db
        .from(table)
        .select(columns)
        .eq("lottery_type", lotteryType)
        .order("draw_date", { ascending: false })
        .order("issue", { ascending: false })
        .range(offset, offset + pageSize - 1),
      `read ${table}/${lotteryType}`,
    );
    output.push(...rows);
    if (rows.length < pageSize) return output;
  }
}

async function selectNextStatus(db, lotteryType) {
  return ensureSuccess(
    await db
      .from("lottery_next_status")
      .select("lottery_type,last_issue,next_issue,next_open_time,next_buy_end_time,source_fetched_at")
      .eq("lottery_type", lotteryType)
      .limit(1),
    `read lottery_next_status/${lotteryType}`,
  )[0] ?? null;
}

async function writeJson(file, value, pretty = true) {
  await mkdir(path.dirname(file), { recursive: true });
  const body = pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  await writeFile(file, `${body}\n`, "utf8");
}

async function main() {
  const db = createCloudBaseDatabase();
  const updatedAt = beijingNow();
  const referenceLocal = localDateTime(updatedAt);
  const latest = {};
  const v2Latest = {};
  const v2Schedule = {};
  const v2CalendarByYear = new Map();
  const results = [];
  const keepRecent = Number(config.export.keep_recent_per_lottery ?? 50);

  for (const [lotteryType, lotteryConfig] of Object.entries(config.lotteries)) {
    const [rows, calendar, classStatus] = await Promise.all([
      selectAll(
        db,
        "lottery_draws",
        "issue,draw_date,draw_time,numbers,prize_pool,sales_amount,prize_details,compatibility_payload,source_payload,source_name,source_fetched_at",
        lotteryType,
      ),
      selectAll(
        db,
        "lottery_calendar",
        "issue,draw_date,draw_time,sale_close_time",
        lotteryType,
      ),
      selectNextStatus(db, lotteryType),
    ]);
    const calendarAsc = [...calendar].sort((a, b) => (
      dateText(a.draw_date).localeCompare(dateText(b.draw_date))
      || String(a.issue).localeCompare(String(b.issue))
    ));
    const draws = rows.map((row) => {
      const nextCalendar = calendarAsc.find((item) => dateText(item.draw_date) > dateText(row.draw_date));
      return materializePublicDraw(row, lotteryType, lotteryConfig, nextCalendar);
    });
    if (!draws.length) throw new Error(`No CloudBase draws for ${lotteryType}`);

    const next = resolveNextMetadata(rows[0], lotteryConfig, calendarAsc, classStatus, referenceLocal);
    Object.assign(draws[0], next);
    latest[lotteryType] = draws[0];
    v2Latest[lotteryType] = materializeV2Draw(rows[0]);
    v2Schedule[lotteryType] = compactObject({
      name: lotteryConfig.name,
      weekdays: lotteryConfig.draw_weekdays ?? [],
      draw_time: lotteryConfig.draw_time ?? "",
      sale_close_time: lotteryConfig.sale_close_time ?? "",
      next: compactObject({
        issue: next.next_issue,
        date: next.next_draw_date,
        open_time: next.next_open_time,
        buy_end_time: next.next_buy_end_time,
        status: next.next_status,
        source: next.next_source,
        confirmed: next.next_confirmed,
        basis_issue: next.next_basis_issue,
      }),
    });
    results.push({ lottery_type: lotteryType, issue: draws[0].issue, draw_date: draws[0].draw_date });

    await writeJson(path.join(outputDir, "draws", `${lotteryType}.json`), {
      schema: "random_draw_agent_lottery_draws",
      version: 1,
      lottery_type: lotteryType,
      updated_at: updatedAt,
      draws: draws.slice(0, keepRecent),
    });

    await writeJson(path.join(outputDir, "v2", "draws", `${lotteryType}.json`), {
      schema: "duigehao.lottery.recent",
      version: 2,
      lottery_type: lotteryType,
      generated_at: updatedAt,
      limit: v2RecentLimit,
      draws: rows.slice(0, v2RecentLimit).map(materializeV2Draw),
    }, false);

    const byYear = new Map();
    for (const [index, draw] of draws.entries()) {
      const year = String(draw.draw_date).slice(0, 4);
      const yearRows = byYear.get(year) ?? [];
      yearRows.push({ v1: draw, v2: materializeV2Draw(rows[index]) });
      byYear.set(year, yearRows);
    }
    for (const [year, yearDraws] of byYear) {
      await writeJson(path.join(outputDir, "by-year", lotteryType, `${year}.json`), {
        schema: "random_draw_agent_year_draws",
        version: 1,
        lottery_type: lotteryType,
        year,
        updated_at: updatedAt,
        draws: yearDraws.map((item) => item.v1),
      });
      await writeJson(path.join(outputDir, "v2", "by-year", lotteryType, `${year}.json`), {
        schema: "duigehao.lottery.year",
        version: 2,
        lottery_type: lotteryType,
        year,
        generated_at: updatedAt,
        draws: yearDraws.map((item) => item.v2),
      }, false);
    }

    for (const item of calendarAsc) {
      const year = dateText(item.draw_date).slice(0, 4);
      const yearRows = v2CalendarByYear.get(year) ?? [];
      yearRows.push(compactObject({
        lottery_type: lotteryType,
        issue: String(item.issue),
        date: dateText(item.draw_date),
        draw_time: timeText(item.draw_time, lotteryConfig.draw_time),
        sale_close_time: timeText(item.sale_close_time, lotteryConfig.sale_close_time),
      }));
      v2CalendarByYear.set(year, yearRows);
    }
  }

  await writeJson(path.join(outputDir, "latest.json"), {
    schema: "random_draw_agent_latest",
    version: 1,
    updated_at: updatedAt,
    timezone: config.timezone ?? "Asia/Shanghai",
    draws: latest,
  });
  await writeJson(path.join(outputDir, "calendar.json"), {
    schema: "random_draw_agent_calendar",
    version: 1,
    updated_at: updatedAt,
    timezone: config.timezone ?? "Asia/Shanghai",
    lotteries: Object.fromEntries(Object.entries(config.lotteries).map(([lotteryType, item]) => {
      const draw = latest[lotteryType];
      return [lotteryType, {
        name: item.name,
        caipiaoid: item.caipiaoid,
        draw_weekdays: item.draw_weekdays ?? [],
        draw_time: item.draw_time ?? "",
        expected_publish_time: item.expected_publish_time ?? "",
        sale_close_time: item.sale_close_time ?? "",
        last_issue: draw.issue,
        class_last_issue: draw.class_last_issue ?? draw.issue,
        next_issue: draw.next_issue ?? "",
        next_draw_date: draw.next_draw_date ?? "",
        next_open_time: draw.next_open_time ?? "",
        next_buy_end_time: draw.next_buy_end_time ?? "",
        next_status: draw.next_status ?? "unavailable",
        next_source: draw.next_source ?? "none",
        next_confirmed: Boolean(draw.next_confirmed),
        next_basis_issue: draw.next_basis_issue ?? draw.issue,
        next_resolution_reason: draw.next_resolution_reason ?? "no_future_calendar_issue",
        raw_class_info: draw.raw_public_json?.class_info ?? {},
      }];
    })),
  });
  await writeJson(path.join(outputDir, "index.json"), {
    schema: "random_draw_agent_public_data_index",
    version: 1,
    updated_at: updatedAt,
    timezone: config.timezone ?? "Asia/Shanghai",
    files: {
      latest: "latest.json",
      calendar: "calendar.json",
      health: "health.json",
      draws: "draws/{lottery_type}.json",
      by_year: "by-year/{lottery_type}/{year}.json",
    },
    lotteries: Object.keys(config.lotteries),
  });
  await writeJson(path.join(outputDir, "health.json"), {
    schema: "random_draw_agent_public_data_health",
    version: 1,
    ok: true,
    updated_at: updatedAt,
    message: "exported_from_cloudbase",
    results,
  });

  await writeJson(path.join(outputDir, "v2", "bootstrap.json"), {
    schema: "duigehao.lottery.bootstrap",
    version: 2,
    generated_at: updatedAt,
    timezone: config.timezone ?? "Asia/Shanghai",
    latest: v2Latest,
    schedule: v2Schedule,
  }, false);
  await writeJson(path.join(outputDir, "v2", "index.json"), {
    schema: "duigehao.lottery.index",
    version: 2,
    generated_at: updatedAt,
    recent_limit: v2RecentLimit,
    files: {
      bootstrap: "bootstrap.json",
      recent: "draws/{lottery_type}.json",
      by_year: "by-year/{lottery_type}/{year}.json",
      calendar: "calendar/{year}.json",
    },
    lotteries: Object.keys(config.lotteries),
  }, false);
  for (const [year, rows] of v2CalendarByYear) {
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.lottery_type.localeCompare(b.lottery_type));
    await writeJson(path.join(outputDir, "v2", "calendar", `${year}.json`), {
      schema: "duigehao.lottery.calendar",
      version: 2,
      year,
      generated_at: updatedAt,
      entries: rows,
    }, false);
  }

  console.log(JSON.stringify({ ok: true, updated_at: updatedAt, v2_recent_limit: v2RecentLimit, results }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
