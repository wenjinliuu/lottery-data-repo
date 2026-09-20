export const LOTTERY_TYPES = ["ssq", "dlt", "kl8", "fc3d", "pl3", "qlc", "qxc", "pl5"];
export const RECENT_LIMIT = 30;

export function dateText(value) {
  return String(value ?? "").slice(0, 10);
}

export function timeText(value, fallback = "") {
  const raw = String(value ?? "").trim() || fallback;
  return raw.length === 5 ? `${raw}:00` : raw;
}

export function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => (
      item !== null
      && item !== undefined
      && item !== ""
      && (!Array.isArray(item) || item.length > 0)
    )),
  );
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

export function nextMetadata(latestRow, calendarRows, lotteryConfig, referenceLocal) {
  const next = calendarRows.find((row) => {
    const close = `${dateText(row.draw_date)} ${timeText(
      row.sale_close_time,
      lotteryConfig.sale_close_time,
    )}`;
    return close > referenceLocal;
  });
  const basisIssue = String(latestRow.issue);
  if (!next) {
    return {
      issue: "",
      date: "",
      open_time: "",
      buy_end_time: "",
      status: "unavailable",
      source: "none",
      confirmed: false,
      basis_issue: basisIssue,
    };
  }
  const date = dateText(next.draw_date);
  return {
    issue: String(next.issue),
    date,
    open_time: `${date} ${timeText(next.draw_time, lotteryConfig.draw_time)}`,
    buy_end_time: `${date} ${timeText(
      next.sale_close_time,
      lotteryConfig.sale_close_time,
    )}`,
    status: "inferred",
    source: "schedule_inference",
    confirmed: false,
    basis_issue: basisIssue,
  };
}

export function materializeV1Draw(row, lotteryType, lotteryConfig, next = null) {
  const stored = row.compatibility_payload && typeof row.compatibility_payload === "object"
    ? structuredClone(row.compatibility_payload)
    : {};
  const output = {
    ...stored,
    schema: stored.schema ?? "random_draw_agent_draw",
    version: stored.version ?? 1,
    lottery_type: lotteryType,
    lottery_name: stored.lottery_name ?? lotteryConfig.name,
    caipiaoid: stored.caipiaoid ?? lotteryConfig.caipiaoid,
    issue: String(row.issue),
    draw_date: dateText(row.draw_date),
    draw_time: row.draw_time ?? stored.draw_time ?? "",
    numbers: row.numbers ?? stored.numbers ?? {},
    prize_pool: row.prize_pool ?? stored.prize_pool ?? "",
    sales_amount: row.sales_amount ?? stored.sales_amount ?? "",
    prize_details: row.prize_details ?? stored.prize_details ?? [],
    fetched_at: row.source_fetched_at ?? stored.fetched_at ?? null,
  };
  if (next) {
    Object.assign(output, {
      next_issue: next.issue,
      next_draw_date: next.date,
      next_open_time: next.open_time,
      next_buy_end_time: next.buy_end_time,
      next_status: next.status,
      next_source: next.source,
      next_confirmed: next.confirmed,
      next_basis_issue: next.basis_issue,
      next_resolution_reason: next.status === "inferred"
        ? "cloudbase_calendar_next_saleable_issue"
        : "no_future_calendar_issue",
    });
  }
  return output;
}

export function materializeCalendarEntry(row) {
  return compactObject({
    lottery_type: row.lottery_type,
    issue: String(row.issue),
    date: dateText(row.draw_date),
    draw_time: timeText(row.draw_time),
    sale_close_time: timeText(row.sale_close_time),
  });
}
