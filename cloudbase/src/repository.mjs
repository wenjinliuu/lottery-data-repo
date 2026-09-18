import pg from "pg";

const { Pool } = pg;

export class LotteryRepository {
  constructor(connectionString = process.env.DATABASE_URL) {
    if (!connectionString) throw new Error("Missing DATABASE_URL");
    this.pool = new Pool({ connectionString, max: 4 });
  }

  async close() {
    await this.pool.end();
  }

  async dueTargets(targetDate, allowedLotteries) {
    if (!allowedLotteries.length) return [];
    await this.pool.query(
      `INSERT INTO lottery_fetch_targets (target_date, lottery_type, expected_issue)
       SELECT draw_date, lottery_type, issue
       FROM lottery_calendar
       WHERE draw_date = $1 AND lottery_type = ANY($2::text[])
       ON CONFLICT (target_date, lottery_type) DO NOTHING`,
      [targetDate, allowedLotteries],
    );
    const result = await this.pool.query(
      `SELECT target_date::text AS draw_date, lottery_type, expected_issue AS issue
       FROM lottery_fetch_targets
       WHERE target_date = $1
         AND lottery_type = ANY($2::text[])
         AND status <> 'updated'
       ORDER BY lottery_type`,
      [targetDate, allowedLotteries],
    );
    return result.rows;
  }

  async allDueLotteryTypes(targetDate) {
    const result = await this.pool.query(
      `SELECT lottery_type FROM lottery_calendar WHERE draw_date = $1 ORDER BY lottery_type`,
      [targetDate],
    );
    return result.rows.map((row) => row.lottery_type);
  }

  async reserveApiCall(usageDate, provider, limit, classCall = false) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO lottery_api_usage_daily (usage_date, provider)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [usageDate, provider],
      );
      const result = await client.query(
        `UPDATE lottery_api_usage_daily
         SET call_count = call_count + 1,
             class_call_count = class_call_count + $4,
             updated_at = NOW()
         WHERE usage_date = $1 AND provider = $2
           AND call_count < $3
           AND ($4 = 0 OR class_call_count = 0)
         RETURNING call_count, class_call_count`,
        [usageDate, provider, limit, classCall ? 1 : 0],
      );
      await client.query("COMMIT");
      return result.rows[0] ?? null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordFailure(targetDate, lotteryType, returnedIssue, error) {
    await this.pool.query(
      `UPDATE lottery_fetch_targets
       SET attempts = attempts + 1,
           latest_returned_issue = $3,
           last_error = $4,
           first_attempt_at = COALESCE(first_attempt_at, NOW()),
           last_attempt_at = NOW(), updated_at = NOW()
       WHERE target_date = $1 AND lottery_type = $2`,
      [targetDate, lotteryType, returnedIssue || null, String(error).slice(0, 1000)],
    );
  }

  async saveDraw(target, draw) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO lottery_draws (
           lottery_type, issue, draw_date, draw_time, numbers, prize_pool,
           sales_amount, prize_details, semantic_checksum, compatibility_payload,
           source_payload, source_fetched_at
         ) VALUES ($1,$2,$3,NULLIF($4,'')::time,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (lottery_type, issue) DO UPDATE SET
           draw_date = EXCLUDED.draw_date, draw_time = EXCLUDED.draw_time,
           numbers = EXCLUDED.numbers, prize_pool = EXCLUDED.prize_pool,
           sales_amount = EXCLUDED.sales_amount, prize_details = EXCLUDED.prize_details,
           semantic_checksum = EXCLUDED.semantic_checksum,
           compatibility_payload = EXCLUDED.compatibility_payload,
           source_payload = EXCLUDED.source_payload,
           source_fetched_at = EXCLUDED.source_fetched_at, updated_at = NOW()`,
        [
          draw.lottery_type, draw.issue, draw.draw_date, draw.draw_time,
          draw.numbers, draw.prize_pool, draw.sales_amount, draw.prize_details,
          draw.semantic_checksum, draw, draw.raw_public_json ?? null, draw.fetched_at,
        ],
      );
      await client.query(
        `UPDATE lottery_fetch_targets
         SET status = 'updated', attempts = attempts + 1,
             latest_returned_issue = $3, last_error = NULL,
             first_attempt_at = COALESCE(first_attempt_at, NOW()),
             last_attempt_at = NOW(), completed_at = NOW(), updated_at = NOW()
         WHERE target_date = $1 AND lottery_type = $2`,
        [target.draw_date, target.lottery_type, draw.issue],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
