import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { semanticChecksum } from "../src/normalize.mjs";

const lotteryType = process.argv[2];
const afterDate = process.argv[3] ?? "0000-01-01";
const checksumOnly = process.argv.includes("--checksum-only");
const checksumJson = process.argv.includes("--checksum-json");
if (!lotteryType) throw new Error("Usage: node generate-upsert-sql.mjs LOTTERY_TYPE [AFTER_DATE]");

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(here, `../../public_data/v2/by-year/${lotteryType}/2026.json`);
const payload = JSON.parse(await readFile(file, "utf8"));
const rows = (payload.draws ?? [])
  .filter((draw) => String(draw.date) > afterDate)
  .map((draw) => {
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
    };
  });

const json = JSON.stringify(rows);
if (json.includes("$lottery_payload$")) throw new Error("Unexpected SQL delimiter in payload");

if (checksumJson) {
  process.stdout.write(JSON.stringify(Object.fromEntries(
    rows.map(({ issue, semantic_checksum }) => [issue, semantic_checksum]),
  )));
  process.exit(0);
}

if (checksumOnly) {
  const checksums = JSON.stringify(rows.map(({ issue, semantic_checksum }) => ({
    issue,
    semantic_checksum,
  })));
  process.stdout.write(`
WITH payload AS (
  SELECT *
  FROM jsonb_to_recordset($lottery_payload$${checksums}$lottery_payload$::jsonb)
    AS item(issue text, semantic_checksum text)
)
UPDATE public.lottery_draws AS draw
SET semantic_checksum = payload.semantic_checksum,
    updated_at = NOW()
FROM payload
WHERE draw.lottery_type = '${lotteryType}'
  AND draw.issue = payload.issue;
`);
  process.exit(0);
}

process.stdout.write(`
WITH payload AS (
  SELECT *
  FROM jsonb_to_recordset($lottery_payload$${json}$lottery_payload$::jsonb) AS item(
    lottery_type text,
    issue text,
    draw_date text,
    draw_time text,
    numbers jsonb,
    prize_pool text,
    sales_amount text,
    prize_details jsonb,
    semantic_checksum text,
    compatibility_payload jsonb,
    source_payload jsonb,
    source_fetched_at text
  )
)
INSERT INTO public.lottery_draws (
  lottery_type, issue, draw_date, draw_time, numbers, prize_pool,
  sales_amount, prize_details, semantic_checksum, compatibility_payload,
  source_payload, source_name, source_fetched_at, updated_at
)
SELECT
  lottery_type, issue, draw_date::date, NULLIF(draw_time, '')::time, numbers,
  prize_pool, sales_amount, prize_details, semantic_checksum,
  compatibility_payload, source_payload, 'github_v2_history',
  NULLIF(source_fetched_at, '')::timestamptz, NOW()
FROM payload
ON CONFLICT (lottery_type, issue) DO UPDATE SET
  draw_date = EXCLUDED.draw_date,
  draw_time = EXCLUDED.draw_time,
  numbers = EXCLUDED.numbers,
  prize_pool = EXCLUDED.prize_pool,
  sales_amount = EXCLUDED.sales_amount,
  prize_details = EXCLUDED.prize_details,
  semantic_checksum = EXCLUDED.semantic_checksum,
  compatibility_payload = EXCLUDED.compatibility_payload,
  source_payload = EXCLUDED.source_payload,
  source_name = EXCLUDED.source_name,
  source_fetched_at = EXCLUDED.source_fetched_at,
  updated_at = NOW();
`);
