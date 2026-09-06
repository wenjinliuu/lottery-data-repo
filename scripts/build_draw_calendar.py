#!/usr/bin/env python3
"""按年推演全部彩种的「期号 ↔ 开奖日期」绑定表。

客户端原来只能靠 API 返回的 `next_issue` 拿到下一期，跨期或补录旧票时无从选起。
这个脚本把一整年的期次一次性算出来，写进 `public_data/calendar/{year}.json`。

推演规则（已用 2026 年 746 期真实数据全量验证，零不符）：

1. 每个彩种有固定的开奖星期（`config/lotteries.json` 的 `draw_weekdays`，0 = 周日）。
2. 期号每年从 001 重新开始，按开奖日顺序递增。
3. 休市日（`calendar/closures.json`）**不开奖也不发期号，期号顺延**——
   不是跳号。福彩3D 2026-04-28 的真实期号是 2026108，而那天是年内第 118 天，
   差的正好是春节休市的 10 天，这条规则由此确证。
4. 期号格式分两系：
   - 福彩（ssq / fc3d / qlc / kl8）：7 位 `YYYYNNN`
   - 体彩（dlt / qxc / pl3 / pl5）：5 位 `YYNNN`
"""
import argparse
import datetime as dt
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config/lotteries.json"
CLOSURES = ROOT / "public_data/calendar/closures.json"
OUT_DIR = ROOT / "public_data/calendar"

# 期号 7 位（含完整年份）的彩种，其余为 5 位（年份取后两位）
WIDE_ISSUE = {"ssq", "fc3d", "qlc", "kl8"}


def load_closures(year):
    data = json.loads(CLOSURES.read_text(encoding="utf-8"))
    spans = []
    for item in data.get("years", {}).get(str(year), []):
        spans.append((
            dt.date.fromisoformat(item["start"]),
            dt.date.fromisoformat(item["end"]),
            item.get("name", ""),
        ))
    return spans


def is_closed(day, spans):
    return any(start <= day <= end for start, end, _ in spans)


def format_issue(key, year, seq):
    return f"{year}{seq:03d}" if key in WIDE_ISSUE else f"{year % 100:02d}{seq:03d}"


def build(year):
    lotteries = json.loads(CONFIG.read_text(encoding="utf-8"))["lotteries"]
    spans = load_closures(year)

    result = {}
    for key, conf in lotteries.items():
        weekdays = set(conf["draw_weekdays"])
        entries = []
        seq = 0
        day = dt.date(year, 1, 1)
        end = dt.date(year, 12, 31)
        while day <= end:
            # config 用 0 = 周日；Python 的 weekday() 是周一 = 0
            weekday = (day.weekday() + 1) % 7
            if weekday in weekdays and not is_closed(day, spans):
                seq += 1
                entries.append({
                    "issue": format_issue(key, year, seq),
                    "draw_date": day.isoformat(),
                    "weekday": weekday,
                    "draw_time": f"{day.isoformat()} {conf['draw_time']}:00",
                    "sale_close_time": f"{day.isoformat()} {conf['sale_close_time']}:00",
                })
            day += dt.timedelta(days=1)
        result[key] = {
            "name": conf["name"],
            "draw_weekdays": sorted(weekdays),
            "draw_time": conf["draw_time"],
            "sale_close_time": conf["sale_close_time"],
            "count": len(entries),
            "issues": entries,
        }

    return {
        "schema": "lottery_draw_calendar",
        "version": 1,
        "year": year,
        "timezone": "Asia/Shanghai",
        "generated_by": "scripts/build_draw_calendar.py",
        "closures": [
            {"name": name, "start": start.isoformat(), "end": end.isoformat()}
            for start, end, name in spans
        ],
        "lotteries": result,
    }


def verify(year, payload):
    """拿 by-year 的真实开奖记录逐条比对推演结果。"""
    problems = []
    checked = 0
    for key, block in payload["lotteries"].items():
        path = ROOT / f"public_data/by-year/{key}/{year}.json"
        if not path.exists():
            continue
        real = json.loads(path.read_text(encoding="utf-8"))
        rows = real.get("draws", real if isinstance(real, list) else [])
        table = {item["draw_date"]: item["issue"] for item in block["issues"]}
        for row in rows:
            date, issue = row.get("draw_date"), str(row.get("issue") or "")
            if not date or not issue:
                continue
            checked += 1
            if table.get(date) != issue:
                problems.append(f"{key} {date}: 实际 {issue}，推演 {table.get(date)}")
    return checked, problems


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, default=dt.date.today().year)
    parser.add_argument("--no-verify", action="store_true")
    args = parser.parse_args()

    payload = build(args.year)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    target = OUT_DIR / f"{args.year}.json"
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    total = sum(block["count"] for block in payload["lotteries"].values())
    print(f"已写出 {target}（{len(payload['lotteries'])} 个彩种，共 {total} 期）")

    if not args.no_verify:
        checked, problems = verify(args.year, payload)
        if problems:
            print(f"⚠ 与真实数据比对 {checked} 期，发现 {len(problems)} 处不符：")
            for line in problems[:20]:
                print("   ", line)
            raise SystemExit(1)
        print(f"✓ 与真实数据比对 {checked} 期，全部一致")
