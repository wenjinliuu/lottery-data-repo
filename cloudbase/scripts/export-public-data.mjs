import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCloudBaseDatabase } from "../src/repository.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const root = path.resolve(packageRoot, "..");
const config = JSON.parse(await readFile(path.join(root, "config/lotteries.json"), "utf8"));
const outputDir = path.join(root, config.export.output_dir ?? "public_data/v2");
const pageSize = 500;
const recentLimit = Number(config.export.recent_per_lottery ?? 30);

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

function nextSaleableCalendar(calendarAsc, lotteryConfig, referenceLocal) {
  return calendarAsc.find((item) => {
    const nextDate = dateText(item.draw_date);
    const closeTime = timeText(item.sale_close_time, lotteryConfig.sale_close_time);
    return `${nextDate} ${closeTime}` > referenceLocal;
  });
}

export function resolveNextMetadata(latestRow, lotteryConfig, calendarAsc, referenceLocal) {
  const latestIssue = String(latestRow.issue);
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
  const schedule = {};
  const calendarByYear = new Map();
  const results = [];

  for (const [lotteryType, lotteryConfig] of Object.entries(config.lotteries)) {
    const [rows, calendar] = await Promise.all([
      selectAll(
        db,
        "lottery_draws",
        "issue,draw_date,draw_time,numbers,prize_pool,sales_amount,prize_details,source_fetched_at",
        lotteryType,
      ),
      selectAll(
        db,
        "lottery_calendar",
        "issue,draw_date,draw_time,sale_close_time",
        lotteryType,
      ),
    ]);
    const earliestYear = rows.length
      ? Number(dateText(rows.at(-1).draw_date).slice(0, 4))
      : null;
    const calendarAsc = [...calendar].sort((a, b) => (
      dateText(a.draw_date).localeCompare(dateText(b.draw_date))
      || String(a.issue).localeCompare(String(b.issue))
    ));
    if (!rows.length) throw new Error(`No CloudBase draws for ${lotteryType}`);

    const next = resolveNextMetadata(rows[0], lotteryConfig, calendarAsc, referenceLocal);
    latest[lotteryType] = materializeV2Draw(rows[0]);
    schedule[lotteryType] = compactObject({
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
    results.push({ lottery_type: lotteryType, issue: String(rows[0].issue), date: dateText(rows[0].draw_date) });

    await writeJson(path.join(outputDir, "draws", `${lotteryType}.json`), {
      schema: "duigehao.lottery.recent",
      version: 2,
      lottery_type: lotteryType,
      generated_at: updatedAt,
      limit: recentLimit,
      draws: rows.slice(0, recentLimit).map(materializeV2Draw),
    }, false);

    const byYear = new Map();
    for (const row of rows) {
      const year = dateText(row.draw_date).slice(0, 4);
      const yearRows = byYear.get(year) ?? [];
      yearRows.push(materializeV2Draw(row));
      byYear.set(year, yearRows);
    }
    for (const [year, yearDraws] of byYear) {
      await writeJson(path.join(outputDir, "by-year", lotteryType, `${year}.json`), {
        schema: "duigehao.lottery.year",
        version: 2,
        lottery_type: lotteryType,
        year: Number(year),
        earliest_year: earliestYear,
        generated_at: updatedAt,
        draws: yearDraws,
      }, false);
    }

    for (const item of calendarAsc) {
      const year = dateText(item.draw_date).slice(0, 4);
      const yearRows = calendarByYear.get(year) ?? [];
      yearRows.push(compactObject({
        lottery_type: lotteryType,
        issue: String(item.issue),
        date: dateText(item.draw_date),
        draw_time: timeText(item.draw_time, lotteryConfig.draw_time),
        sale_close_time: timeText(item.sale_close_time, lotteryConfig.sale_close_time),
      }));
      calendarByYear.set(year, yearRows);
    }
  }

  await writeJson(path.join(outputDir, "bootstrap.json"), {
    schema: "duigehao.lottery.bootstrap",
    version: 2,
    generated_at: updatedAt,
    timezone: config.timezone ?? "Asia/Shanghai",
    latest,
    schedule,
  }, false);
  await writeJson(path.join(outputDir, "index.json"), {
    schema: "duigehao.lottery.index",
    version: 2,
    generated_at: updatedAt,
    recent_limit: recentLimit,
    files: {
      bootstrap: "bootstrap.json",
      recent: "draws/{lottery_type}.json",
      by_year: "by-year/{lottery_type}/{year}.json",
      calendar: "calendar/{year}.json",
    },
    lotteries: Object.keys(config.lotteries),
  }, false);
  for (const [year, rows] of calendarByYear) {
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.lottery_type.localeCompare(b.lottery_type));
    await writeJson(path.join(outputDir, "calendar", `${year}.json`), {
      schema: "duigehao.lottery.calendar",
      version: 2,
      year: Number(year),
      generated_at: updatedAt,
      entries: rows,
    }, false);
  }

  console.log(JSON.stringify({ ok: true, generated_at: updatedAt, recent_limit: recentLimit, results }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
