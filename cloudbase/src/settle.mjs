import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { UserTicketStore } from "./user-tickets.mjs";
import { createApnsClient } from "./apns.mjs";

const configUrl = [
  new URL("../config/lotteries.json", import.meta.url),
  new URL("../../config/lotteries.json", import.meta.url),
].find((candidate) => existsSync(fileURLToPath(candidate)));
const lotteryNames = configUrl
  ? Object.fromEntries(Object.entries(JSON.parse(readFileSync(configUrl, "utf8")).lotteries)
    .map(([key, value]) => [key, value.name]))
  : {};

function money(amount) {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

/** 推送文案。stage: result = 号码刚出来；final = 之前待公布的奖金落定了。 */
export function notificationText(summary, stage) {
  const name = lotteryNames[summary.lottery_type] ?? summary.lottery_type;
  const prizes = Object.entries(summary.prizes).map(([prize, count]) => `${prize} ${count} 注`).join("、");
  if (stage === "final") {
    return {
      title: `${name} ${summary.issue} 期奖金公布`,
      body: `${prizes}，共 ${money(summary.amount)} 元`,
    };
  }
  const title = `${name} ${summary.issue} 期开奖了`;
  if (!summary.won) return { title, body: `${summary.tickets} 注都没中` };
  const amount = summary.floating
    ? (summary.amount > 0 ? `已确定 ${money(summary.amount)} 元，其余奖金待公布` : "奖金待公布")
    : `共 ${money(summary.amount)} 元`;
  return { title, body: `${summary.tickets} 注中 ${summary.won} 注：${prizes}，${amount}` };
}

/**
 * 开奖数据落库后调用：核对这一期的票并推送。
 * 每期最多推两次——号码出来推一次；当时有奖金待公布的，落定后再推一次。
 * 任何失败都不该影响抓取本身，调用方要自己兜住异常。
 */
export async function settleAndNotify({
  lotteryType,
  issue,
  drawRow,
  store = new UserTicketStore(),
  apns = createApnsClient(),
}) {
  const summary = await store.settleIssue(lotteryType, issue, drawRow);
  if (!summary.tickets) return { ...summary, notified: null };

  let stage = null;
  if (!(await store.notificationSent(lotteryType, issue, "result"))) stage = "result";
  else if (summary.won && !summary.floating && !(await store.notificationSent(lotteryType, issue, "final"))) {
    // 只有第一次推送时确实有奖金没定，才值得再推一次。
    stage = "final";
  }
  if (stage === "result" && summary.won && !summary.floating) {
    // 第一次就全部落定：把 final 也占掉，免得之后重复推同样的内容。
    await store.claimNotification(lotteryType, issue, "final", summary);
  }
  if (!stage || !(await store.claimNotification(lotteryType, issue, stage, summary))) {
    return { ...summary, notified: null };
  }
  if (!apns) return { ...summary, notified: stage, delivered: 0, push: "not_configured" };

  const devices = await store.activeDevices();
  if (!devices.length) return { ...summary, notified: stage, delivered: 0, push: "no_devices" };
  const results = await apns.send(devices, {
    ...notificationText(summary, stage),
    threadId: `draw-${lotteryType}`,
    data: { lottery_type: lotteryType, issue, stage },
  });
  for (const result of results.filter((item) => item.gone)) {
    await store.disableDevice(result.token, result.reason || `http_${result.status}`);
  }
  return {
    ...summary,
    notified: stage,
    delivered: results.filter((item) => item.ok).length,
    push_errors: results.filter((item) => !item.ok).map((item) => item.reason || `http_${item.status}`),
  };
}
