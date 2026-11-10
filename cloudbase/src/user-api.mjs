import { userAccess, USER_KEY_HEADER } from "./user-access.mjs";
import { UserTicketStore, ValidationError, PULL_PAGE_LIMIT, SYNC_BATCH_LIMIT } from "./user-tickets.mjs";

const MAX_BODY_BYTES = 1024 * 1024;

function response(statusCode, payload) {
  return {
    statusCode,
    isBase64Encoded: false,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "vary": USER_KEY_HEADER,
      "x-content-type-options": "nosniff",
    },
    body: JSON.stringify(payload),
  };
}

function jsonBody(event) {
  let raw = event.body ?? "";
  if (typeof raw === "object" && raw !== null && !Buffer.isBuffer(raw)) return raw;
  if (event.isBase64Encoded) raw = Buffer.from(String(raw), "base64").toString("utf8");
  raw = String(raw);
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new ValidationError("body_too_large");
  try {
    const parsed = JSON.parse(raw || "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed;
  } catch {
    throw new ValidationError("invalid_json");
  }
}

export const isUserPath = (path) => path === "/v2/me" || path.startsWith("/v2/me/");

/**
 * 个人票据接口（都要带个人密钥，响应一律不缓存）：
 *   GET  /v2/me/tickets?since=<cursor>&limit=<n>   增量拉取
 *   POST /v2/me/tickets   {tickets:[{id, updated_at, deleted?, record}]}   批量上传
 *   POST /v2/me/devices   {token, environment, bundle_id}   登记推送令牌
 */
export async function handleUser({ event, method, path, query }, store = null, checkAccess = userAccess) {
  const accessError = checkAccess(event);
  if (accessError) return response(accessError.statusCode, { error: accessError.error });
  try {
    store ??= new UserTicketStore();
    if (path === "/v2/me/tickets" && method === "GET") {
      const since = Number(query.since ?? 0);
      const limit = Number(query.limit ?? PULL_PAGE_LIMIT);
      if (!Number.isSafeInteger(since) || since < 0) return response(400, { error: "invalid_since" });
      const page = await store.changesSince(since, Number.isInteger(limit) && limit > 0 ? limit : PULL_PAGE_LIMIT);
      return response(200, { schema: "duigehao.user.tickets", version: 1, ...page });
    }
    if (path === "/v2/me/tickets" && method === "POST") {
      const result = await store.upsert(jsonBody(event).tickets);
      // 开奖之后才录进来的票：这一期的号码已经在库里，顺手核对掉（不推送）。
      for (const target of result.touched) {
        try {
          await store.settleIssue(target.lotteryType, target.issue);
        } catch (error) {
          console.error("user-api settle after upload failed", String(error));
        }
      }
      return response(200, {
        schema: "duigehao.user.sync",
        version: 1,
        accepted: result.accepted,
        skipped: result.skipped,
        cursor: result.touched.length ? await store.cursor() : result.cursor,
        batch_limit: SYNC_BATCH_LIMIT,
      });
    }
    if (path === "/v2/me/devices" && method === "POST") {
      return response(200, await store.registerDevice(jsonBody(event)));
    }
    if (["/v2/me/tickets", "/v2/me/devices"].includes(path)) {
      return response(405, { error: "method_not_allowed" });
    }
    return response(404, { error: "not_found" });
  } catch (error) {
    if (error instanceof ValidationError) return response(400, { error: error.message });
    console.error("user-api", { path, error: String(error) });
    return response(500, { error: "internal_error" });
  }
}
