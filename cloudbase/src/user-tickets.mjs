import { createCloudBaseDatabase } from "./repository.mjs";
import { LOTTERY_TYPES } from "./api-contract.mjs";
import { evaluateRecord, lotteryTypeOf } from "./prize-rules.mjs";

export const SYNC_BATCH_LIMIT = 200;
export const PULL_PAGE_LIMIT = 500;

const TICKET_COLUMNS = [
  "id", "record", "client_updated_at", "deleted", "sync_seq",
  "settle_status", "settle_prize_name", "settle_amount", "settle_matched", "settled_at",
].join(",");
const DRAW_COLUMNS = "lottery_type,issue,numbers,prize_details";

function ensureSuccess(result, operation) {
  if (result?.error) {
    throw new Error(`${operation}: ${result.error.message ?? JSON.stringify(result.error)}`);
  }
  return result?.data ?? [];
}

export class ValidationError extends Error {}

function timestamp(value, field) {
  const time = Date.parse(String(value ?? ""));
  if (!Number.isFinite(time)) throw new ValidationError(`invalid_${field}`);
  return new Date(time).toISOString();
}

/** 校验并整理 App 传上来的一条票据。 */
export function normalizeIncoming(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new ValidationError("invalid_ticket");
  const id = String(item.id ?? "").trim();
  if (!id || id.length > 128) throw new ValidationError("invalid_id");
  const record = item.record;
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new ValidationError("invalid_record");
  }
  const lotteryType = lotteryTypeOf(record);
  if (!LOTTERY_TYPES.includes(lotteryType)) throw new ValidationError("unknown_lottery_type");
  return {
    id,
    batch_id: String(record.batchId ?? "").slice(0, 128),
    lottery_type: lotteryType,
    issue: String(record.targetExpect ?? record.expect ?? "").slice(0, 32),
    record,
    client_updated_at: timestamp(item.updated_at ?? record.updatedAt, "updated_at"),
    deleted: item.deleted === true,
  };
}

function settlementOf(row) {
  if (!row.settle_status) return null;
  return {
    status: row.settle_status,
    prize_name: row.settle_prize_name ?? "",
    amount: Number(row.settle_amount ?? 0),
    matched: row.settle_matched ?? {},
    settled_at: row.settled_at ?? null,
  };
}

function sameSettlement(row, result) {
  return row.settle_status === result.status
    && (row.settle_prize_name ?? "") === result.prizeName
    && Number(row.settle_amount ?? 0) === result.amount;
}

export class UserTicketStore {
  constructor(database = createCloudBaseDatabase()) {
    this.db = database;
  }

  /**
   * 写入一批票据。同一张票以 App 的修改时间为准，新的覆盖旧的（相同或更旧的跳过），
   * 所以重复上传是安全的。号码或期次变了，云端的核对结果作废重算。
   */
  async upsert(items) {
    if (!Array.isArray(items)) throw new ValidationError("invalid_tickets");
    if (items.length > SYNC_BATCH_LIMIT) throw new ValidationError("too_many_tickets");
    const byId = new Map();
    for (const item of items.map(normalizeIncoming)) {
      const previous = byId.get(item.id);
      if (!previous || item.client_updated_at > previous.client_updated_at) byId.set(item.id, item);
    }
    const incoming = [...byId.values()];
    if (!incoming.length) return { accepted: 0, skipped: 0, cursor: await this.cursor(), touched: [] };

    const existing = new Map(ensureSuccess(
      await this.db.from("user_tickets").select("id,client_updated_at")
        .in("id", incoming.map((item) => item.id)),
      "read existing tickets",
    ).map((row) => [row.id, new Date(row.client_updated_at).toISOString()]));
    const fresh = incoming.filter((item) => {
      const stored = existing.get(item.id);
      return !stored || item.client_updated_at > stored;
    });
    if (fresh.length) {
      ensureSuccess(
        await this.db.from("user_tickets").upsert(
          fresh.map((item) => ({
            ...item,
            settle_status: null,
            settle_prize_name: null,
            settle_amount: null,
            settle_matched: null,
            settled_at: null,
          })),
          { onConflict: "id" },
        ),
        "upsert tickets",
      );
    }
    const touched = [...new Map(fresh
      .filter((item) => !item.deleted && item.issue)
      .map((item) => [`${item.lottery_type}/${item.issue}`, {
        lotteryType: item.lottery_type, issue: item.issue,
      }])).values()];
    return {
      accepted: fresh.length,
      skipped: incoming.length - fresh.length,
      cursor: await this.cursor(),
      touched,
    };
  }

  async cursor() {
    const rows = ensureSuccess(
      await this.db.from("user_tickets").select("sync_seq")
        .order("sync_seq", { ascending: false }).limit(1),
      "read ticket cursor",
    );
    return Number(rows[0]?.sync_seq ?? 0);
  }

  /** 增量拉取：返回序号大于 since 的票据，按序号升序。 */
  async changesSince(since = 0, limit = PULL_PAGE_LIMIT) {
    const size = Math.max(1, Math.min(PULL_PAGE_LIMIT, limit));
    const rows = ensureSuccess(
      await this.db.from("user_tickets").select(TICKET_COLUMNS)
        .gt("sync_seq", since).order("sync_seq", { ascending: true }).limit(size + 1),
      "read ticket changes",
    );
    const page = rows.slice(0, size);
    return {
      tickets: page.map((row) => {
        const settlement = settlementOf(row);
        return {
          id: row.id,
          updated_at: new Date(row.client_updated_at).toISOString(),
          deleted: row.deleted === true,
          record: row.record,
          ...(settlement ? { settlement } : {}),
        };
      }),
      cursor: page.length ? Number(page[page.length - 1].sync_seq) : Number(since),
      has_more: rows.length > size,
    };
  }

  async registerDevice({ token, environment, bundle_id: bundleId }) {
    const normalized = String(token ?? "").trim().toLowerCase();
    if (!/^[0-9a-f]{64,200}$/.test(normalized)) throw new ValidationError("invalid_token");
    const env = environment === "sandbox" ? "sandbox" : "production";
    ensureSuccess(
      await this.db.from("user_push_devices").upsert({
        token: normalized,
        environment: env,
        bundle_id: String(bundleId ?? "").slice(0, 200),
        disabled: false,
        last_error: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "token" }),
      "register push device",
    );
    return { ok: true };
  }

  async activeDevices() {
    return ensureSuccess(
      await this.db.from("user_push_devices").select("token,environment,bundle_id").eq("disabled", false),
      "read push devices",
    );
  }

  async disableDevice(token, reason) {
    ensureSuccess(
      await this.db.from("user_push_devices")
        .update({ disabled: true, last_error: String(reason).slice(0, 200), updated_at: new Date().toISOString() })
        .eq("token", token),
      "disable push device",
    );
  }

  async drawRow(lotteryType, issue) {
    const rows = ensureSuccess(
      await this.db.from("lottery_draws").select(DRAW_COLUMNS)
        .eq("lottery_type", lotteryType).eq("issue", issue).limit(1),
      "read draw for settlement",
    );
    return rows[0] ?? null;
  }

  /**
   * 核对某一期的全部票据，只改结果有变化的行。
   * @returns 这一期的汇总；没有票或开奖号还没出来时 tickets 为 0。
   */
  async settleIssue(lotteryType, issue, drawRow = null) {
    const summary = { lottery_type: lotteryType, issue, tickets: 0, won: 0, floating: 0, amount: 0, prizes: {} };
    const draw = drawRow ?? await this.drawRow(lotteryType, issue);
    if (!draw) return summary;
    const rows = ensureSuccess(
      await this.db.from("user_tickets")
        .select("id,record,settle_status,settle_prize_name,settle_amount")
        .eq("lottery_type", lotteryType).eq("issue", issue).eq("deleted", false).limit(1000),
      "read tickets for settlement",
    );
    const now = new Date().toISOString();
    for (const row of rows) {
      const result = evaluateRecord(row.record, draw);
      if (!result) continue;
      summary.tickets += 1;
      if (result.status !== "lost") {
        summary.won += 1;
        summary.prizes[result.prizeName] = (summary.prizes[result.prizeName] ?? 0) + 1;
      }
      if (result.status === "prize_float") summary.floating += 1;
      summary.amount += result.amount;
      if (sameSettlement(row, result)) continue;
      ensureSuccess(
        await this.db.from("user_tickets").update({
          settle_status: result.status,
          settle_prize_name: result.prizeName,
          settle_amount: result.amount,
          settle_matched: result.matched,
          settled_at: now,
        }).eq("id", row.id),
        "write settlement",
      );
    }
    return summary;
  }

  /** 抢占某一期某个阶段的推送名额；已经推过返回 false。 */
  async claimNotification(lotteryType, issue, stage, summary) {
    const existing = ensureSuccess(
      await this.db.from("user_draw_notifications").select("stage")
        .eq("lottery_type", lotteryType).eq("issue", issue).eq("stage", stage).limit(1),
      "read draw notification",
    );
    if (existing.length) return false;
    const inserted = ensureSuccess(
      await this.db.from("user_draw_notifications").upsert(
        { lottery_type: lotteryType, issue, stage, summary },
        { onConflict: "lottery_type,issue,stage", ignoreDuplicates: true },
      ).select("stage"),
      "claim draw notification",
    );
    return inserted.length > 0;
  }

  async notificationSent(lotteryType, issue, stage) {
    const rows = ensureSuccess(
      await this.db.from("user_draw_notifications").select("stage")
        .eq("lottery_type", lotteryType).eq("issue", issue).eq("stage", stage).limit(1),
      "read draw notification",
    );
    return rows.length > 0;
  }
}
