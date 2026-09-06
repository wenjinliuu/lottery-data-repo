"""整年开奖日历推演的回归测试。

核心断言是「推演出来的期号必须和真实开奖记录逐条吻合」——
这条一旦破了，说明期号规则变了（比如某年休市安排没更新），
生成的日历就会把用户的票绑到错误的期次上。
"""
import datetime as dt
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from build_draw_calendar import build, format_issue, load_closures, verify  # noqa: E402


class DrawCalendarTests(unittest.TestCase):
    year = 2026

    @classmethod
    def setUpClass(cls):
        cls.payload = build(cls.year)

    def test_matches_real_draws(self):
        """推演结果必须和 by-year 里的真实开奖记录完全一致。"""
        checked, problems = verify(self.year, self.payload)
        self.assertGreater(checked, 0, "没有可比对的真实数据")
        self.assertEqual(problems, [], f"{len(problems)} 处推演与真实数据不符")

    def test_issue_format(self):
        """福彩系 7 位含完整年份，体彩系 5 位只留后两位。"""
        self.assertEqual(format_issue("ssq", 2026, 7), "2026007")
        self.assertEqual(format_issue("kl8", 2026, 238), "2026238")
        self.assertEqual(format_issue("dlt", 2026, 7), "26007")
        self.assertEqual(format_issue("pl5", 2026, 238), "26238")

    def test_closures_emit_no_issue(self):
        """休市日不能出现在任何彩种的期次表里。"""
        spans = load_closures(self.year)
        self.assertTrue(spans, "2026 应该配置了休市日")
        closed = set()
        for start, end, _ in spans:
            day = start
            while day <= end:
                closed.add(day.isoformat())
                day += dt.timedelta(days=1)

        for key, block in self.payload["lotteries"].items():
            dates = {item["draw_date"] for item in block["issues"]}
            overlap = dates & closed
            self.assertEqual(overlap, set(), f"{key} 在休市日仍排了开奖：{sorted(overlap)[:5]}")

    def test_sequence_is_continuous(self):
        """期号必须连续递增、不跳号 —— 休市是顺延不是跳过。"""
        for key, block in self.payload["lotteries"].items():
            issues = [item["issue"] for item in block["issues"]]
            tail = [int(value[-3:]) for value in issues]
            self.assertEqual(tail, list(range(1, len(issues) + 1)),
                             f"{key} 的期号不连续")

    def test_daily_games_cover_every_open_day(self):
        """天天开奖的彩种：全年天数减去休市天数就是期数。"""
        spans = load_closures(self.year)
        closed_days = sum((end - start).days + 1 for start, end, _ in spans)
        days_in_year = (dt.date(self.year, 12, 31) - dt.date(self.year, 1, 1)).days + 1
        for key in ("fc3d", "pl3", "pl5", "kl8"):
            self.assertEqual(self.payload["lotteries"][key]["count"],
                             days_in_year - closed_days,
                             f"{key} 的期数和「全年天数 - 休市天数」对不上")

    def test_written_file_is_current(self):
        """仓库里已经写出的日历文件必须和当前规则生成的一致。"""
        path = ROOT / f"public_data/calendar/{self.year}.json"
        self.assertTrue(path.exists(), "缺少已生成的日历文件")
        saved = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(saved["lotteries"], self.payload["lotteries"],
                         "日历文件已过期，请重新跑 scripts/build_draw_calendar.py")


if __name__ == "__main__":
    unittest.main()
