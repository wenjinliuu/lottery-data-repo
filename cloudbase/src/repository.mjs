import cloudbase from "@cloudbase/node-sdk";

function ensureSuccess(result, operation) {
  if (result?.error) {
    throw new Error(`${operation}: ${result.error.message ?? JSON.stringify(result.error)}`);
  }
  return result?.data ?? [];
}

function nowTimestamp() {
  return new Date().toISOString();
}

const CLASS_SLOT_COLUMNS = {
  overnight_recovery: "class_overnight_called",
  cloudbase_final: "class_final_called",
};

export function createCloudBaseDatabase(
  env = process.env.CLOUDBASE_ENV_ID,
  accessKey = process.env.CLOUDBASE_API_KEY,
) {
  const app = cloudbase.init({
    env: env || cloudbase.SYMBOL_CURRENT_ENV,
    ...(accessKey ? { accessKey } : {}),
  });
  return app.rdb({ database: "public" });
}

export class LotteryRepository {
  constructor(database = createCloudBaseDatabase()) {
    this.db = database;
  }

  async close() {}

  async dueTargets(targetDate, allowedLotteries) {
    if (!allowedLotteries.length) return [];
    const calendar = ensureSuccess(
      await this.db
        .from("lottery_calendar")
        .select("draw_date,lottery_type,issue")
        .eq("draw_date", targetDate)
        .in("lottery_type", allowedLotteries),
      "query due calendar",
    );
    if (calendar.length) {
      ensureSuccess(
        await this.db.from("lottery_fetch_targets").upsert(
          calendar.map((row) => ({
            target_date: targetDate,
            lottery_type: row.lottery_type,
            expected_issue: String(row.issue),
          })),
          { onConflict: "target_date,lottery_type", ignoreDuplicates: true },
        ),
        "create fetch targets",
      );
    }
    const pending = ensureSuccess(
      await this.db
        .from("lottery_fetch_targets")
        .select("target_date,lottery_type,expected_issue,status")
        .eq("target_date", targetDate)
        .in("lottery_type", allowedLotteries)
        .neq("status", "updated")
        .order("lottery_type"),
      "query pending targets",
    );
    return pending.map((row) => ({
      draw_date: String(row.target_date).slice(0, 10),
      lottery_type: row.lottery_type,
      issue: String(row.expected_issue),
    }));
  }

  async allDueLotteryTypes(targetDate) {
    const rows = ensureSuccess(
      await this.db
        .from("lottery_calendar")
        .select("lottery_type")
        .eq("draw_date", targetDate)
        .order("lottery_type"),
      "query due lottery types",
    );
    return rows.map((row) => row.lottery_type);
  }

  async initializeApiUsage(usageDate, provider) {
    ensureSuccess(
      await this.db.from("lottery_api_usage_daily").upsert(
        { usage_date: usageDate, provider },
        { onConflict: "usage_date,provider", ignoreDuplicates: true },
      ),
      "initialize API usage",
    );
  }

  async reserveApiCall(usageDate, provider, limit) {
    await this.initializeApiUsage(usageDate, provider);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const [usage] = ensureSuccess(
        await this.db
          .from("lottery_api_usage_daily")
          .select("call_count")
          .eq("usage_date", usageDate)
          .eq("provider", provider)
          .limit(1),
        "read API usage",
      );
      if (!usage || usage.call_count >= limit) return null;
      const updated = ensureSuccess(
        await this.db
          .from("lottery_api_usage_daily")
          .update({
            call_count: usage.call_count + 1,
            updated_at: nowTimestamp(),
          })
          .eq("usage_date", usageDate)
          .eq("provider", provider)
          .eq("call_count", usage.call_count)
          .lt("call_count", limit)
          .select("call_count,class_call_count"),
        "reserve API usage",
      );
      if (updated.length) return updated[0];
    }
    throw new Error("reserve API usage: concurrent update retry limit reached");
  }

  async reserveClassCall(usageDate, provider, limit, classLimit, slot) {
    const slotColumn = CLASS_SLOT_COLUMNS[slot];
    if (!slotColumn) throw new Error(`Class sync is not allowed for slot: ${slot}`);
    await this.initializeApiUsage(usageDate, provider);

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const [usage] = ensureSuccess(
        await this.db
          .from("lottery_api_usage_daily")
          .select(`call_count,class_call_count,${slotColumn}`)
          .eq("usage_date", usageDate)
          .eq("provider", provider)
          .limit(1),
        "read class API usage",
      );
      if (
        !usage
        || usage.call_count >= limit
        || usage.class_call_count >= classLimit
        || usage[slotColumn]
      ) return null;

      const updated = ensureSuccess(
        await this.db
          .from("lottery_api_usage_daily")
          .update({
            call_count: usage.call_count + 1,
            class_call_count: usage.class_call_count + 1,
            [slotColumn]: true,
            updated_at: nowTimestamp(),
          })
          .eq("usage_date", usageDate)
          .eq("provider", provider)
          .eq("call_count", usage.call_count)
          .eq("class_call_count", usage.class_call_count)
          .eq(slotColumn, false)
          .lt("call_count", limit)
          .lt("class_call_count", classLimit)
          .select(`call_count,class_call_count,${slotColumn}`),
        "reserve class API usage",
      );
      if (updated.length) return updated[0];
    }
    throw new Error("reserve class API usage: concurrent update retry limit reached");
  }

  async latestDraws(lotteryTypes) {
    const output = {};
    await Promise.all(lotteryTypes.map(async (lotteryType) => {
      const [row] = ensureSuccess(
        await this.db
          .from("lottery_draws")
          .select("lottery_type,issue,draw_date")
          .eq("lottery_type", lotteryType)
          .order("draw_date", { ascending: false })
          .order("issue", { ascending: false })
          .limit(1),
        `read latest draw/${lotteryType}`,
      );
      if (row) {
        output[lotteryType] = {
          ...row,
          issue: String(row.issue),
          draw_date: String(row.draw_date).slice(0, 10),
        };
      }
    }));
    return output;
  }

  async saveClassStatuses(rows) {
    if (!rows.length) return;
    ensureSuccess(
      await this.db.from("lottery_next_status").upsert(rows, { onConflict: "lottery_type" }),
      "upsert lottery next status",
    );
  }

  async recordFailure(targetDate, lotteryType, returnedIssue, error) {
    const [target] = ensureSuccess(
      await this.db
        .from("lottery_fetch_targets")
        .select("attempts,first_attempt_at")
        .eq("target_date", targetDate)
        .eq("lottery_type", lotteryType)
        .limit(1),
      "read failed target",
    );
    if (!target) return;
    const now = nowTimestamp();
    ensureSuccess(
      await this.db
        .from("lottery_fetch_targets")
        .update({
          attempts: target.attempts + 1,
          latest_returned_issue: returnedIssue || null,
          last_error: String(error).slice(0, 1000),
          first_attempt_at: target.first_attempt_at || now,
          last_attempt_at: now,
          updated_at: now,
        })
        .eq("target_date", targetDate)
        .eq("lottery_type", lotteryType),
      "record failed target",
    );
  }

  async saveDraw(target, draw) {
    ensureSuccess(
      await this.db.from("lottery_draws").upsert(
        {
          lottery_type: draw.lottery_type,
          issue: draw.issue,
          draw_date: draw.draw_date,
          draw_time: draw.draw_time || null,
          numbers: draw.numbers,
          prize_pool: draw.prize_pool,
          sales_amount: draw.sales_amount,
          prize_details: draw.prize_details,
          semantic_checksum: draw.semantic_checksum,
          compatibility_payload: draw,
          source_payload: draw.raw_public_json ?? null,
          source_fetched_at: draw.fetched_at,
          updated_at: nowTimestamp(),
        },
        { onConflict: "lottery_type,issue" },
      ),
      "upsert lottery draw",
    );

    const [current] = ensureSuccess(
      await this.db
        .from("lottery_fetch_targets")
        .select("attempts,first_attempt_at")
        .eq("target_date", target.draw_date)
        .eq("lottery_type", target.lottery_type)
        .limit(1),
      "read completed target",
    );
    const now = nowTimestamp();
    ensureSuccess(
      await this.db
        .from("lottery_fetch_targets")
        .update({
          status: "updated",
          attempts: (current?.attempts ?? 0) + 1,
          latest_returned_issue: draw.issue,
          last_error: null,
          first_attempt_at: current?.first_attempt_at || now,
          last_attempt_at: now,
          completed_at: now,
          updated_at: now,
        })
        .eq("target_date", target.draw_date)
        .eq("lottery_type", target.lottery_type),
      "complete fetch target",
    );
  }
}
