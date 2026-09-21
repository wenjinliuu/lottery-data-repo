import { createHash } from "node:crypto";

function text(value) {
  return value == null ? "" : String(value);
}

function integers(value) {
  return (text(value).match(/\d+/g) ?? []).map(Number);
}

function safeInteger(value) {
  if (value == null || value === "") return null;
  const parsed = Number.parseInt(text(value).replaceAll(",", "").replaceAll("，", ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstDefined(...values) {
  return values.find((value) => value !== null && value !== undefined && value !== "");
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function positiveNumber(value) {
  if (!hasValue(value)) return false;
  const parsed = Number(text(value).replaceAll(",", "").replaceAll("，", ""));
  return Number.isFinite(parsed) && parsed > 0;
}

export function parseNumbers(lotteryType, queryResult) {
  const main = integers(queryResult.number);
  const refer = integers(queryResult.refernumber);
  switch (lotteryType) {
    case "ssq": return { red: main.slice(0, 6), blue: refer.slice(0, 1).length ? refer.slice(0, 1) : main.slice(6, 7) };
    case "dlt": return { front: main.slice(0, 5), back: refer.slice(0, 2).length ? refer.slice(0, 2) : main.slice(5, 7) };
    case "qlc": return { basic: main.slice(0, 7), special: (refer[0] ?? main[7] ?? null) };
    case "qxc": return { digits: (main.length >= 7 ? main : [...main.slice(0, 6), ...refer.slice(0, 1)]).slice(0, 7) };
    case "fc3d":
    case "pl3": return { digits: [...main.join("")].slice(0, 3).map(Number) };
    case "pl5": return { digits: [...main.join("")].slice(0, 5).map(Number) };
    case "kl8": return { nums: main.slice(0, 20) };
    default: throw new Error(`Unsupported lottery type: ${lotteryType}`);
  }
}

function normalizePrizeDetails(value) {
  if (!Array.isArray(value)) return [];
  return value.map((raw, index) => {
    const item = raw && typeof raw === "object" ? raw : { value: raw };
    return {
      prize_level: text(item.prizename || item.level || item.name || index + 1),
      prize_name: text(item.prizename || item.name || ""),
      require: text(item.require),
      winning_count: safeInteger(firstDefined(item.num, item.winning_count)),
      prize_amount: text(firstDefined(item.singlebonus, item.bonus, item.prize)),
      additional_count: safeInteger(firstDefined(item.addnum, item.additional_count)),
      additional_amount: text(firstDefined(item.addbonus, item.additional_amount)),
      raw: item,
    };
  });
}

export function assessDrawCompleteness(draw) {
  const prizes = Array.isArray(draw?.prize_details) ? draw.prize_details : [];
  if (!prizes.length) {
    return { complete: false, reason: "prize_not_published" };
  }
  if (!prizes.every((item) => item.winning_count !== null && item.winning_count !== undefined)) {
    return { complete: false, reason: "winning_counts_missing" };
  }
  if (!prizes.some((item) => hasValue(item.prize_amount))) {
    return { complete: false, reason: "prize_amounts_missing" };
  }
  if (!positiveNumber(draw.sales_amount)) {
    return { complete: false, reason: "sales_amount_pending" };
  }
  if (draw.lottery_type === "kl8" && !prizes.some((item) => Number(item.winning_count) > 0)) {
    return { complete: false, reason: "kl8_winning_counts_pending" };
  }
  return { complete: true, reason: "complete" };
}

export function drawCompletenessScore(draw) {
  const prizes = Array.isArray(draw?.prize_details) ? draw.prize_details : [];
  const countFields = prizes.filter((item) => item.winning_count !== null && item.winning_count !== undefined).length;
  const amountFields = prizes.filter((item) => hasValue(item.prize_amount)).length;
  return (
    prizes.length * 10
    + countFields * 3
    + amountFields * 2
    + (positiveNumber(draw?.sales_amount) ? 1000 : 0)
    + (hasValue(draw?.prize_pool) ? 100 : 0)
    + (assessDrawCompleteness(draw).complete ? 10000 : 0)
  );
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function semanticChecksum(draw) {
  const semantic = stable({
    lottery_type: draw.lottery_type,
    issue: draw.issue,
    draw_date: draw.draw_date,
    numbers: draw.numbers,
    prize_pool: draw.prize_pool,
    sales_amount: draw.sales_amount,
    prize_details: draw.prize_details,
  });
  return createHash("sha256").update(JSON.stringify(semantic)).digest("hex");
}

export function normalizeQueryPayload(lotteryType, lotteryConfig, payload, fetchedAt = new Date().toISOString()) {
  const result = payload?.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error(`${lotteryType}: query API missing result`);
  }
  const issue = text(result.issueno ?? result.issue);
  const openDate = text(result.opendate ?? result.officialopendate);
  if (!issue || !/^\d{4}-\d{2}-\d{2}/.test(openDate)) {
    throw new Error(`${lotteryType}: query API missing issue or draw date`);
  }
  const draw = {
    schema: "duigehao.lottery.ingest",
    version: 2,
    lottery_type: lotteryType,
    lottery_name: lotteryConfig.name,
    caipiaoid: safeInteger(result.caipiaoid) ?? lotteryConfig.caipiaoid,
    issue,
    draw_date: openDate.slice(0, 10),
    draw_time: openDate.length >= 19 ? openDate.slice(11, 19) : "",
    deadline: text(result.deadline),
    numbers: parseNumbers(lotteryType, result),
    number_raw: text(result.number),
    refernumber_raw: text(result.refernumber),
    prize_pool: text(result.totalmoney ?? result.poolmoney),
    sales_amount: text(result.saleamount ?? result.sales),
    prize_details: normalizePrizeDetails(result.prize),
    source: { name: "jisuapi", fetched_at: fetchedAt },
    raw_public_json: { query_response: payload, query_result: result },
    fetched_at: fetchedAt,
  };
  return { ...draw, semantic_checksum: semanticChecksum(draw) };
}

export function assertExpectedDraw(draw, expected) {
  if (draw.issue !== expected.issue) {
    throw new Error(`stale_issue:${draw.issue};expected:${expected.issue}`);
  }
  if (draw.draw_date !== expected.draw_date) {
    throw new Error(`wrong_draw_date:${draw.draw_date};expected:${expected.draw_date}`);
  }
  const values = Object.values(draw.numbers).flat().filter((value) => value != null);
  if (!values.length || values.some((value) => !Number.isInteger(value))) {
    throw new Error("invalid_numbers");
  }
}
