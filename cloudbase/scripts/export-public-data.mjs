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

function timeText(value, fallback) {
  const raw = String(value ?? "").trim() || fallback;
  return raw.length === 5 ? `${raw}:00` : raw;
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
    draw_date: String(row.draw_date).slice(0, 10),
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
    const nextDate = String(nextCalendar.draw_date).slice(0, 10);
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

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  const db = createCloudBaseDatabase();
  const updatedAt = beijingNow();
  const latest = {};
  const results = [];
  const keepRecent = Number(config.export.keep_recent_per_lottery ?? 50);

  for (const [lotteryType, lotteryConfig] of Object.entries(config.lotteries)) {
    const [rows, calendar] = await Promise.all([
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
    ]);
    const calendarAsc = [...calendar].sort((a, b) => String(a.draw_date).localeCompare(String(b.draw_date)));
    const draws = rows.map((row) => {
      const nextCalendar = calendarAsc.find((item) => String(item.draw_date) > String(row.draw_date));
      return materializePublicDraw(row, lotteryType, lotteryConfig, nextCalendar);
    });
    if (!draws.length) throw new Error(`No CloudBase draws for ${lotteryType}`);

    latest[lotteryType] = draws[0];
    results.push({ lottery_type: lotteryType, issue: draws[0].issue, draw_date: draws[0].draw_date });
    await writeJson(path.join(outputDir, "draws", `${lotteryType}.json`), {
      schema: "random_draw_agent_lottery_draws",
      version: 1,
      lottery_type: lotteryType,
      updated_at: updatedAt,
      draws: draws.slice(0, keepRecent),
    });

    const byYear = new Map();
    for (const draw of draws) {
      const year = String(draw.draw_date).slice(0, 4);
      const rows = byYear.get(year) ?? [];
      rows.push(draw);
      byYear.set(year, rows);
    }
    for (const [year, yearDraws] of byYear) {
      await writeJson(path.join(outputDir, "by-year", lotteryType, `${year}.json`), {
        schema: "random_draw_agent_year_draws",
        version: 1,
        lottery_type: lotteryType,
        year,
        updated_at: updatedAt,
        draws: yearDraws,
      });
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
  console.log(JSON.stringify({ ok: true, updated_at: updatedAt, results }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
