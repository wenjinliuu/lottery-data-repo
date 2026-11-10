import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRecord } from "../src/prize-rules.mjs";

const prize = (name, amount, extra) => ({ prize_name: name, prize_amount: amount, additional_amount: extra });
const ssqDraw = {
  numbers: { red: [5, 6, 10, 25, 27, 30], blue: [11] },
  prize_details: [prize("一等奖", "10000000"), prize("二等奖", "175266"), prize("三等奖", "3000"),
    prize("四等奖", "200"), prize("五等奖", "10"), prize("六等奖", "5")],
};
const ssq = (red, blue, multiple = 1) => ({ gameKey: "ssq", multiple, numbers: { red, blue: [blue] } });

test("双色球各奖级，奖金乘倍数", () => {
  assert.deepEqual(
    evaluateRecord(ssq([5, 6, 10, 25, 27, 30], 11), ssqDraw),
    { status: "won", prizeName: "一等奖", amount: 10000000, matched: { red: [true, true, true, true, true, true], blue: [true] } },
  );
  assert.equal(evaluateRecord(ssq([5, 6, 10, 25, 27, 31], 11), ssqDraw).prizeName, "三等奖");
  assert.equal(evaluateRecord(ssq([5, 6, 10, 25, 1, 2], 3), ssqDraw).prizeName, "五等奖");
  const sixth = evaluateRecord(ssq([1, 2, 3, 4, 7, 8], 11, 3), ssqDraw);
  assert.equal(sixth.prizeName, "六等奖");
  assert.equal(sixth.amount, 15);
  const lost = evaluateRecord(ssq([5, 6, 10, 1, 2, 3], 9), ssqDraw);
  assert.equal(lost.status, "lost");
  assert.deepEqual(lost.matched.red, [true, true, true, false, false, false]);
});

test("福运奖只在当期奖级表里有这一项时才算", () => {
  const record = ssq([5, 6, 10, 1, 2, 3], 9);
  assert.equal(evaluateRecord(record, ssqDraw).status, "lost");
  const withLuck = { ...ssqDraw, prize_details: [...ssqDraw.prize_details, prize("福运奖", "5")] };
  assert.deepEqual(
    { ...evaluateRecord(record, withLuck), matched: undefined },
    { status: "won", prizeName: "福运奖", amount: 5, matched: undefined },
  );
});

test("中了奖但奖金没公布：奖金待公布，不编金额", () => {
  const pending = { numbers: ssqDraw.numbers, prize_details: [] };
  assert.deepEqual(
    { ...evaluateRecord(ssq([1, 2, 3, 4, 7, 8], 11), pending), matched: undefined },
    { status: "prize_float", prizeName: "六等奖", amount: 0, matched: undefined },
  );
});

test("开奖号还没出来、号码缺失、彩种不认识都不下结论", () => {
  assert.equal(evaluateRecord(ssq([1, 2, 3, 4, 5, 6], 7), { numbers: {} }), null);
  assert.equal(evaluateRecord({ gameKey: "ssq" }, ssqDraw), null);
  assert.equal(evaluateRecord({ gameKey: "sports", numbers: { red: [1] } }, ssqDraw), null);
});

const dltDraw = {
  numbers: { front: [3, 13, 20, 25, 34], back: [9, 12] },
  prize_details: [prize("一等奖", "6603916"), prize("追加一等奖", "5283133"), prize("二等奖", "100000"),
    prize("七等奖", "5")],
};

test("大乐透：追加票要基本和追加两笔都有才算确定", () => {
  const numbers = { front: [3, 13, 20, 25, 34], back: [9, 12] };
  assert.equal(evaluateRecord({ gameKey: "dlt", numbers }, dltDraw).amount, 6603916);
  assert.equal(evaluateRecord({ gameKey: "dlt", numbers: { ...numbers, addOn: true } }, dltDraw).amount, 6603916 + 5283133);
  // 二等奖没有追加那一条 → 追加票的奖金还不能定
  const second = { gameKey: "dlt", numbers: { front: [3, 13, 20, 25, 34], back: [9, 1], addOn: true } };
  assert.equal(evaluateRecord(second, dltDraw).status, "prize_float");
  // 同一条里带 additional_amount 的写法也认
  const inline = { ...dltDraw, prize_details: [prize("二等奖", "100000", "80000")] };
  assert.equal(evaluateRecord(second, inline).amount, 180000);
  // 后区全中、前区全不中也是七等奖
  assert.equal(evaluateRecord({ gameKey: "dlt", numbers: { front: [1, 2, 4, 5, 6], back: [9, 12] } }, dltDraw).amount, 5);
});

test("快乐8：本地彩种键是 k8，奖级按选几中几查", () => {
  const draw = {
    numbers: { nums: [1, 7, 10, 13, 23, 25, 26, 28, 45, 46, 47, 49, 61, 63, 64, 72, 73, 77, 78, 79] },
    prize_details: [prize("选五中5", "1000"), prize("选五中4", "21"), prize("选五中3", "3"), prize("选十中0", "2")],
  };
  const record = { gameKey: "k8", multiple: 2, numbers: { nums: [1, 7, 10, 13, 2], playCount: 5 } };
  assert.deepEqual(
    { ...evaluateRecord(record, draw), matched: undefined },
    { status: "won", prizeName: "选五中4", amount: 42, matched: undefined },
  );
  assert.equal(evaluateRecord({ gameKey: "k8", numbers: { nums: [2, 3, 4, 5, 6], playCount: 5 } }, draw).status, "lost");
  // 没有 playCount 时从 playMode 取
  assert.equal(evaluateRecord({ gameKey: "k8", playMode: "5", numbers: { nums: [1, 7, 10, 2, 3] } }, draw).prizeName, "选五中3");
});

test("3D / 排列3：直选按位，组三组六不按位；奖级名写法不同也对得上", () => {
  const draw = { numbers: { digits: [1, 7, 0] }, prize_details: [prize("直选奖", "1040"), prize("组选3奖", "346"), prize("组选6奖", "173")] };
  const record = (nums3, playMode) => ({ gameKey: "pl3", numbers: { nums3, playMode } });
  assert.equal(evaluateRecord(record([1, 7, 0], "single"), draw).amount, 1040);
  assert.equal(evaluateRecord(record([7, 1, 0], "single"), draw).status, "lost");
  assert.equal(evaluateRecord(record([0, 1, 7], "group6"), draw).amount, 173);
  assert.equal(evaluateRecord(record([0, 1, 7], "group3"), draw).status, "lost");
  const group3Draw = { ...draw, numbers: { digits: [8, 8, 2] } };
  assert.equal(evaluateRecord({ gameKey: "fc3d", numbers: { nums3: [8, 2, 8], playMode: "group3" } }, group3Draw).amount, 346);
  assert.equal(evaluateRecord({ gameKey: "fc3d", numbers: { nums3: [8, 2, 8], playMode: "group6" } }, group3Draw).status, "lost");
});

test("排列5、七乐彩、七星彩", () => {
  const pl5 = { numbers: { digits: [1, 7, 0, 2, 9] }, prize_details: [prize("一等奖", "100000")] };
  assert.equal(evaluateRecord({ gameKey: "pl5", numbers: { nums5: [1, 7, 0, 2, 9] } }, pl5).amount, 100000);
  assert.equal(evaluateRecord({ gameKey: "pl5", numbers: { nums5: [1, 7, 0, 2, 8] } }, pl5).status, "lost");

  const qlc = { numbers: { basic: [7, 11, 15, 18, 25, 27, 30], special: 6 }, prize_details: [prize("二等奖", "7881"), prize("七等奖", "5")] };
  assert.equal(evaluateRecord({ gameKey: "qlc", numbers: { nums7: [7, 11, 15, 18, 25, 27, 6] } }, qlc).amount, 7881);
  assert.equal(evaluateRecord({ gameKey: "qlc", numbers: { nums7: [7, 11, 15, 18, 1, 2, 3] } }, qlc).amount, 5);

  const qxc = { numbers: { digits: [9, 3, 8, 6, 2, 5, 8] }, prize_details: [prize("二等奖", "27494"), prize("六等奖", "5")] };
  // 特别号在 App 里存成裸数字
  assert.equal(evaluateRecord({ gameKey: "qxc", numbers: { nums6: [9, 3, 8, 6, 2, 5], tail: 1 } }, qxc).amount, 27494);
  assert.equal(evaluateRecord({ gameKey: "qxc", numbers: { nums6: [0, 0, 0, 0, 0, 0], tail: 8 } }, qxc).amount, 5);
  assert.equal(evaluateRecord({ gameKey: "qxc", numbers: { nums6: [0, 0, 0, 0, 0, 0], tail: 7 } }, qxc).status, "lost");
});
