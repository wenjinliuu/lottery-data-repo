function text(value) {
  return value == null ? "" : String(value).trim();
}

function integer(value) {
  if (value == null || value === "") return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseClassItems(payload) {
  const result = payload?.result;
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object") {
    if (Array.isArray(result.list)) return result.list;
    if (Array.isArray(result.data)) return result.data;
  }
  throw new Error("class API missing result list");
}

function normalizeDateTime(value) {
  const raw = text(value).replace("T", " ");
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw} 00:00:00`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(raw)) return `${raw}:00`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return raw;
  return "";
}

function buyEndFallback(nextOpenTime, saleCloseTime) {
  if (!nextOpenTime) return "";
  const close = text(saleCloseTime) || "20:00";
  return `${nextOpenTime.slice(0, 10)} ${close.length === 5 ? `${close}:00` : close}`;
}

export function normalizeClassPayload(payload, configs, latestDraws, fetchedAt = new Date().toISOString()) {
  const typeById = new Map(
    Object.entries(configs).map(([lotteryType, config]) => [Number(config.caipiaoid), lotteryType]),
  );
  const seen = new Set();
  const confirmed = [];
  const rejected = [];

  for (const item of parseClassItems(payload)) {
    if (!item || typeof item !== "object") continue;
    const lotteryType = typeById.get(integer(item.caipiaoid));
    if (!lotteryType) continue;
    seen.add(lotteryType);

    const latest = latestDraws[lotteryType];
    const lastIssue = text(item.lastissueno);
    const nextIssue = text(item.nextissueno);
    const nextOpenTime = normalizeDateTime(item.nextopentime);
    const nextBuyEndTime = normalizeDateTime(item.nextbuyendtime)
      || buyEndFallback(nextOpenTime, configs[lotteryType].sale_close_time);

    let reason = "";
    if (!latest?.issue) reason = "latest_draw_missing";
    else if (lastIssue !== String(latest.issue)) reason = "class_last_issue_stale";
    else if (!nextIssue || nextIssue === lastIssue) reason = "class_next_issue_invalid";
    else if (!nextOpenTime) reason = "class_next_open_time_invalid";
    else if (nextOpenTime.slice(0, 10) <= String(latest.draw_date).slice(0, 10)) {
      reason = "class_next_date_not_after_latest";
    }

    if (reason) {
      rejected.push({
        lottery_type: lotteryType,
        latest_issue: String(latest?.issue ?? ""),
        class_last_issue: lastIssue,
        class_next_issue: nextIssue,
        reason,
      });
      continue;
    }

    confirmed.push({
      lottery_type: lotteryType,
      last_issue: lastIssue,
      next_issue: nextIssue,
      next_open_time: nextOpenTime,
      next_buy_end_time: nextBuyEndTime,
      source: "jisuapi_class",
      source_payload: item,
      source_fetched_at: fetchedAt,
      updated_at: fetchedAt,
    });
  }

  for (const lotteryType of Object.keys(configs)) {
    if (!seen.has(lotteryType)) {
      rejected.push({ lottery_type: lotteryType, reason: "class_item_missing" });
    }
  }

  return { confirmed, rejected };
}
