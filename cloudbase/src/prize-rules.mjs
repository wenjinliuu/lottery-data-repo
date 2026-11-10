// 奖级判定。逐条对照 lottery-ios 的 PrizeRules.swift（它又移植自 lottery-web 的
// rules.js），三端结论必须一致。输入是 App 备份格式的单条记录和 lottery_draws 的一行。

export const NO_PRIZE = "未中奖";

export function countMatches(ticket = [], draw = []) {
  const counts = new Map();
  for (const n of draw) counts.set(n, (counts.get(n) ?? 0) + 1);
  let total = 0;
  for (const n of ticket) {
    if (!counts.get(n)) continue;
    counts.set(n, counts.get(n) - 1);
    total += 1;
  }
  return total;
}

export function markMatches(ticket = [], draw = []) {
  const counts = new Map();
  for (const n of draw) counts.set(n, (counts.get(n) ?? 0) + 1);
  return ticket.map((n) => {
    if (!counts.get(n)) return false;
    counts.set(n, counts.get(n) - 1);
    return true;
  });
}

function multisetEqual(a, b) {
  if (a.length !== b.length) return false;
  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);
  return left.every((value, index) => value === right[index]);
}

function isGroup3(nums) {
  const counts = new Map();
  for (const n of nums) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts.values()].sort((x, y) => x - y).join(",") === "1,2";
}

const CHINESE = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
const chinese = (value) => CHINESE[Number(value)] ?? String(value);

export function canonicalPrizeName(value) {
  return String(value ?? "")
    .replace(/组选[3三]奖?/g, "组三")
    .replace(/组选[6六]奖?/g, "组六")
    .replace(/直选奖/g, "直选")
    .replace(/\s+/g, "");
}

export function parseMoney(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!text) return 0;
  const number = Number.parseFloat(text.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(number)) return 0;
  if (text.includes("亿")) return number * 100000000;
  if (text.includes("万")) return number * 10000;
  return number;
}

function intList(value) {
  if (Array.isArray(value)) return value.map(Number).filter(Number.isInteger);
  if (value === null || value === undefined || value === "") return [];
  const single = Number(value);
  return Number.isInteger(single) ? [single] : [];
}

/** lottery_draws.prize_details → 统一的奖级表。 */
export function prizeEntries(drawRow) {
  const list = Array.isArray(drawRow?.prize_details) ? drawRow.prize_details : [];
  return list.map((item) => ({
    name: String(item.prize_name || item.prize_level || item.require || ""),
    amount: parseMoney(item.prize_amount),
    extra: parseMoney(item.additional_amount),
  }));
}

/** App 记录里的彩种键 → 开奖库的彩种键（快乐8 本地是 k8）。 */
export function lotteryTypeOf(record) {
  const key = String(record?.gameKey ?? "");
  return key === "k8" ? "kl8" : key;
}

const floating = (prizeName, matched) => ({ prizeName, matched, win: true });
const none = (matched) => ({ prizeName: NO_PRIZE, matched, win: false });

function evaluateSSQ(numbers, draw, prizes) {
  const ticketRed = intList(numbers.red);
  const drawRed = intList(draw.red);
  const red = countMatches(ticketRed, drawRed);
  const ticketBlue = intList(numbers.blue)[0];
  const blue = ticketBlue !== undefined && ticketBlue === intList(draw.blue)[0];
  const matched = { red: markMatches(ticketRed, drawRed), blue: [blue] };
  if (red === 6 && blue) return floating("一等奖", matched);
  if (red === 6) return floating("二等奖", matched);
  if (red === 5 && blue) return floating("三等奖", matched);
  if (red === 5 || (red === 4 && blue)) return floating("四等奖", matched);
  if (red === 4 || (red === 3 && blue)) return floating("五等奖", matched);
  if (blue) return floating("六等奖", matched);
  if (red === 3 && prizes.some((p) => canonicalPrizeName(p.name) === "福运奖")) {
    return floating("福运奖", matched);
  }
  return none(matched);
}

function evaluateDLT(numbers, draw) {
  const tf = intList(numbers.front);
  const tb = intList(numbers.back);
  const df = intList(draw.front);
  const db = intList(draw.back);
  const front = countMatches(tf, df);
  const back = countMatches(tb, db);
  const matched = { front: markMatches(tf, df), back: markMatches(tb, db) };
  const key = `${front}+${back}`;
  if (key === "5+2") return floating("一等奖", matched);
  if (key === "5+1") return floating("二等奖", matched);
  if (["5+0", "4+2"].includes(key)) return floating("三等奖", matched);
  if (key === "4+1") return floating("四等奖", matched);
  if (["4+0", "3+2"].includes(key)) return floating("五等奖", matched);
  if (["3+1", "2+2"].includes(key)) return floating("六等奖", matched);
  if (["3+0", "2+1", "1+2", "0+2"].includes(key)) return floating("七等奖", matched);
  return none(matched);
}

function evaluateK8(numbers, draw, prizes, record) {
  const nums = intList(numbers.nums);
  const drawNums = intList(draw.nums);
  const hits = countMatches(nums, drawNums);
  const matched = { nums: markMatches(nums, drawNums) };
  const fromMode = Number.parseInt(numbers.playMode ?? record.playMode, 10);
  const playCount = Number.isInteger(numbers.playCount) ? numbers.playCount
    : Number.isInteger(fromMode) ? fromMode : nums.length;
  const entry = prizes.find((p) => (
    (p.name.includes(`选${playCount}`) || p.name.includes(`选${chinese(playCount)}`))
    && (p.name.includes(`中${hits}`) || p.name.includes(`中${chinese(hits)}`))
  ));
  return entry ? floating(entry.name, matched) : none(matched);
}

function positional(ticket, draw) {
  return ticket.map((value, index) => index < draw.length && value === draw[index]);
}

function evaluateDigit3(numbers, draw, record) {
  const nums = intList(numbers.nums3);
  const drawNums = intList(draw.digits);
  const playMode = String(numbers.playMode ?? record.playMode ?? "");
  if (playMode === "single") {
    const flags = positional(nums, drawNums);
    const matched = { nums3: flags };
    return flags.length === drawNums.length && flags.every(Boolean)
      ? floating("直选", matched) : none(matched);
  }
  const matched = { nums3: markMatches(nums, drawNums) };
  if (playMode === "group3") {
    return isGroup3(drawNums) && multisetEqual(nums, drawNums)
      ? floating("组三", matched) : none(matched);
  }
  return new Set(drawNums).size === 3 && multisetEqual(nums, drawNums)
    ? floating("组六", matched) : none(matched);
}

function evaluatePL5(numbers, draw) {
  const drawNums = intList(draw.digits);
  const flags = positional(intList(numbers.nums5), drawNums);
  const matched = { nums5: flags };
  return flags.length === drawNums.length && flags.every(Boolean)
    ? floating("一等奖", matched) : none(matched);
}

function evaluateQLC(numbers, draw) {
  const nums = intList(numbers.nums7);
  const basic = intList(draw.basic);
  const special = intList(draw.special)[0];
  const front = countMatches(nums, basic);
  const specialHit = special !== undefined && nums.includes(special);
  const matched = { nums7: markMatches(nums, special === undefined ? basic : [...basic, special]) };
  if (front === 7) return floating("一等奖", matched);
  if (front === 6) return floating(specialHit ? "二等奖" : "三等奖", matched);
  if (front === 5) return floating(specialHit ? "四等奖" : "五等奖", matched);
  if (front === 4) return floating(specialHit ? "六等奖" : "七等奖", matched);
  return none(matched);
}

function evaluateQXC(numbers, draw) {
  const digits = intList(draw.digits);
  const drawMain = digits.slice(0, 6);
  const drawTail = digits[6];
  const mainFlags = positional(intList(numbers.nums6), drawMain);
  const mainCount = mainFlags.filter(Boolean).length;
  const ticketTail = intList(numbers.tail)[0];
  const tailHit = ticketTail !== undefined && ticketTail === drawTail;
  const matched = { nums6: mainFlags, tail: [tailHit] };
  if (mainCount === 6 && tailHit) return floating("一等奖", matched);
  if (mainCount === 6) return floating("二等奖", matched);
  if (mainCount === 5 && tailHit) return floating("三等奖", matched);
  if (mainCount === 5 || (mainCount === 4 && tailHit)) return floating("四等奖", matched);
  if (mainCount === 4 || (mainCount === 3 && tailHit)) return floating("五等奖", matched);
  if (mainCount === 3 || tailHit) return floating("六等奖", matched);
  return none(matched);
}

function findPrizeAmount(prizes, prizeName, lotteryType) {
  const target = canonicalPrizeName(prizeName);
  const candidates = prizes.filter((p) => {
    const name = canonicalPrizeName(p.name);
    if (lotteryType === "kl8") return name === target;
    return name.includes(target) && (prizeName.includes("追加") || !p.name.includes("追加"));
  });
  return candidates.find((p) => p.amount > 0)?.amount ?? 0;
}

function resolveAmount(prizes, prizeName, lotteryType, numbers, record) {
  if (!prizes.length) return 0;
  const base = findPrizeAmount(prizes, prizeName, lotteryType);
  const addOn = numbers.addOn === true || record.addOn === true
    || numbers.playMode === "add" || record.playMode === "add";
  if (lotteryType !== "dlt" || !addOn || !["一等奖", "二等奖"].includes(prizeName)) return base;
  const extra = findPrizeAmount(prizes, `${prizeName}追加`, lotteryType)
    || findPrizeAmount(prizes, `追加${prizeName}`, lotteryType)
    || (prizes.find((p) => p.name.includes(prizeName) && p.extra > 0)?.extra ?? 0)
    || (prizes.find((p) => p.name.includes("追加") && p.name.includes(prizeName) && p.amount > 0)?.amount ?? 0);
  // 追加票要"基本 + 追加"都拿到才算确定，否则继续按奖金待公布处理。
  return extra > 0 ? base + extra : 0;
}

/**
 * 核对一条记录。
 * @returns {{status: "won"|"lost"|"prize_float", prizeName: string, amount: number, matched: object} | null}
 *   号码缺失、彩种不认识或开奖号还没出来时返回 null（不下结论）。
 */
export function evaluateRecord(record, drawRow) {
  const lotteryType = lotteryTypeOf(record);
  const numbers = record?.numbers;
  const draw = drawRow?.numbers;
  if (!numbers || typeof numbers !== "object" || !draw || typeof draw !== "object") return null;
  if (!Object.values(draw).flat().some((value) => Number.isInteger(value))) return null;
  const prizes = prizeEntries(drawRow);

  let result;
  if (lotteryType === "ssq") result = evaluateSSQ(numbers, draw, prizes);
  else if (lotteryType === "dlt") result = evaluateDLT(numbers, draw);
  else if (lotteryType === "kl8") result = evaluateK8(numbers, draw, prizes, record);
  else if (lotteryType === "fc3d" || lotteryType === "pl3") result = evaluateDigit3(numbers, draw, record);
  else if (lotteryType === "pl5") result = evaluatePL5(numbers, draw);
  else if (lotteryType === "qlc") result = evaluateQLC(numbers, draw);
  else if (lotteryType === "qxc") result = evaluateQXC(numbers, draw);
  else return null;

  if (!result.win) return { status: "lost", prizeName: NO_PRIZE, amount: 0, matched: result.matched };
  const parsedMultiple = Number.parseInt(record.multiple, 10);
  const multiple = Math.max(1, Math.min(99, Number.isInteger(parsedMultiple) ? parsedMultiple : 1));
  const single = resolveAmount(prizes, result.prizeName, lotteryType, numbers, record);
  return single > 0
    ? { status: "won", prizeName: result.prizeName, amount: single * multiple, matched: result.matched }
    : { status: "prize_float", prizeName: result.prizeName, amount: 0, matched: result.matched };
}
