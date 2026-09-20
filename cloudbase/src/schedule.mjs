import schedule from "../config/schedule.json" with { type: "json" };

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

export function beijingDateParts(now = new Date()) {
  const shifted = new Date(now.getTime() + BEIJING_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function targetDateForSlot(slotName, now = new Date()) {
  const slot = schedule.slots[slotName];
  if (!slot) throw new Error(`Unknown schedule slot: ${slotName}`);
  const parts = beijingDateParts(now);
  const midnightUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  const target = new Date(midnightUtc + slot.target_day_offset * 86400000);
  return target.toISOString().slice(0, 10);
}

export function allowedLotteriesForSlot(slotName, allDue) {
  const slot = schedule.slots[slotName];
  if (!slot) throw new Error(`Unknown schedule slot: ${slotName}`);
  if (slot.lotteries === "all_due") return [...allDue];
  const due = new Set(allDue);
  return slot.lotteries.filter((lottery) => due.has(lottery));
}

export function automaticDailyLimit() {
  return schedule.automatic_daily_call_limit;
}

export { schedule };
