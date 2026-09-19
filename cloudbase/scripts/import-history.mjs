import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

function checksum(draw) {
  return createHash("sha256").update(JSON.stringify({
    lottery_type: draw.lottery_type,
    issue: String(draw.issue),
    draw_date: draw.draw_date,
    numbers: draw.numbers,
    prize_pool: draw.prize_pool ?? "",
    sales_amount: draw.sales_amount ?? "",
    prize_details: draw.prize_details ?? [],
  })).digest("hex");
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function importCalendars(pool) {
  const directory = path.join(root, "public_data/calendar");
  const files = (await readdir(directory)).filter((name) => /^\d{4}\.json$/.test(name));
  let count = 0;
  for (const file of files) {
    const payload = await readJson(path.join(directory, file));
    for (const [lotteryType, game] of Object.entries(payload.lotteries ?? {})) {
      for (const item of game.issues ?? []) {
        await pool.query(
          `INSERT INTO lottery_calendar
             (lottery_type, issue, draw_date, draw_time, sale_close_time, source)
           VALUES ($1,$2,$3,NULLIF($4,'')::time,NULLIF($5,'')::time,'github_history')
           ON CONFLICT (lottery_type, issue) DO UPDATE SET
             draw_date=EXCLUDED.draw_date, draw_time=EXCLUDED.draw_time,
             sale_close_time=EXCLUDED.sale_close_time, updated_at=NOW()`,
          [lotteryType, String(item.issue), item.draw_date, item.draw_time?.slice(-8) ?? "", item.sale_close_time?.slice(-8) ?? ""],
        );
        count += 1;
      }
    }
  }
  return count;
}

async function importDraws(pool) {
  const directory = path.join(root, "public_data/by-year");
  const lotteryTypes = await readdir(directory);
  let count = 0;
  for (const lotteryType of lotteryTypes) {
    const gameDirectory = path.join(directory, lotteryType);
    const files = (await readdir(gameDirectory)).filter((name) => name.endsWith(".json"));
    for (const file of files) {
      const payload = await readJson(path.join(gameDirectory, file));
      for (const draw of payload.draws ?? []) {
        await pool.query(
          `INSERT INTO lottery_draws (
             lottery_type, issue, draw_date, draw_time, numbers, prize_pool,
             sales_amount, prize_details, semantic_checksum, compatibility_payload,
             source_payload, source_fetched_at
           ) VALUES ($1,$2,$3,NULLIF($4,'')::time,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (lottery_type, issue) DO UPDATE SET
             semantic_checksum=EXCLUDED.semantic_checksum,
             compatibility_payload=EXCLUDED.compatibility_payload,
             source_payload=EXCLUDED.source_payload, updated_at=NOW()`,
          [
            lotteryType, String(draw.issue), draw.draw_date, draw.draw_time ?? "",
            draw.numbers ?? {}, draw.prize_pool ?? "", draw.sales_amount ?? "",
            draw.prize_details ?? [], checksum(draw), draw,
            draw.raw_public_json ?? null, draw.fetched_at || null,
          ],
        );
        count += 1;
      }
    }
  }
  return count;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try {
    const calendarRows = await importCalendars(pool);
    const drawRows = await importDraws(pool);
    console.log(JSON.stringify({ ok: true, calendar_rows: calendarRows, draw_rows: drawRows }));
  } finally {
    await pool.end();
  }
}

await main();
