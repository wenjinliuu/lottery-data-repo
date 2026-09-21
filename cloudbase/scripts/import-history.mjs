import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { semanticChecksum } from "../src/normalize.mjs";
import { createCloudBaseDatabase } from "../src/repository.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const root = existsSync(path.join(packageRoot, "public_data"))
  ? packageRoot
  : path.resolve(packageRoot, "..");
const BATCH_SIZE = 100;

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function assertSuccess(result, operation) {
  if (result?.error) {
    throw new Error(`${operation}: ${result.error.message ?? JSON.stringify(result.error)}`);
  }
}

async function upsertBatches(db, table, rows, onConflict) {
  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const batch = rows.slice(index, index + BATCH_SIZE);
    assertSuccess(
      await db.from(table).upsert(batch, { onConflict }),
      `import ${table} rows ${index + 1}-${index + batch.length}`,
    );
  }
}

async function importCalendars(db) {
  const directory = path.join(root, "public_data/v2/calendar");
  const files = (await readdir(directory)).filter((name) => /^\d{4}\.json$/.test(name));
  const rows = [];
  for (const file of files) {
    const payload = await readJson(path.join(directory, file));
    for (const item of payload.entries ?? []) {
      rows.push({
        lottery_type: item.lottery_type,
        issue: String(item.issue),
        draw_date: item.date,
        draw_time: item.draw_time || null,
        sale_close_time: item.sale_close_time || null,
        source: "github_v2_history",
        updated_at: new Date().toISOString(),
      });
    }
  }
  await upsertBatches(db, "lottery_calendar", rows, "lottery_type,issue");
  return rows.length;
}

async function importDraws(db) {
  const directory = path.join(root, "public_data/v2/by-year");
  const lotteryTypes = await readdir(directory);
  let count = 0;
  for (const lotteryType of lotteryTypes) {
    const gameDirectory = path.join(directory, lotteryType);
    const files = (await readdir(gameDirectory)).filter((name) => name.endsWith(".json"));
    for (const file of files) {
      const payload = await readJson(path.join(gameDirectory, file));
      const rows = (payload.draws ?? []).map((draw) => {
        const prizeDetails = (draw.prizes ?? []).map((item) => ({
          prize_name: item.name ?? "",
          require: item.match ?? "",
          winning_count: item.winners ?? "",
          prize_amount: item.amount ?? "",
          additional_count: item.extra_winners ?? "",
          additional_amount: item.extra_amount ?? "",
        }));
        const normalized = {
          lottery_type: lotteryType,
          issue: String(draw.issue),
          draw_date: draw.date,
          draw_time: draw.time || null,
          numbers: draw.numbers ?? {},
          prize_pool: draw.pool ?? "",
          sales_amount: draw.sales ?? "",
          prize_details: prizeDetails,
        };
        return {
          ...normalized,
          semantic_checksum: semanticChecksum(normalized),
          compatibility_payload: {},
          source_payload: null,
          source_fetched_at: draw.fetched_at || null,
          updated_at: new Date().toISOString(),
        };
      });
      await upsertBatches(db, "lottery_draws", rows, "lottery_type,issue");
      count += rows.length;
    }
  }
  return count;
}

export async function importHistory(db = createCloudBaseDatabase()) {
  const calendarRows = await importCalendars(db);
  const drawRows = await importDraws(db);
  return { ok: true, calendar_rows: calendarRows, draw_rows: drawRows };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await importHistory()));
}
