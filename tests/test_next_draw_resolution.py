from __future__ import annotations

import sys
import unittest
import json
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from update_public_data import BEIJING_TZ, infer_next_issue, resolve_next_draw  # noqa: E402


DLT = {
    "draw_weekdays": [1, 3, 6],
    "draw_time": "21:25",
    "sale_close_time": "21:00",
}


class NextDrawResolutionTests(unittest.TestCase):
    def test_accepts_current_future_class_data(self) -> None:
        result = resolve_next_draw(
            DLT,
            "26079",
            "2026-07-15",
            {
                "lastissueno": "26079",
                "nextissueno": "26080",
                "nextopentime": "2026-07-18 21:25:00",
                "nextbuyendtime": "2026-07-18 20:00:00",
            },
            datetime(2026, 7, 15, 23, 6, tzinfo=BEIJING_TZ),
        )
        self.assertEqual(result["next_status"], "confirmed")
        self.assertEqual(result["next_source"], "class_api")
        self.assertEqual(result["next_issue"], "26080")

    def test_replaces_stale_class_data_with_schedule_inference(self) -> None:
        result = resolve_next_draw(
            DLT,
            "26079",
            "2026-07-15",
            {
                "lastissueno": "26078",
                "nextissueno": "26079",
                "nextopentime": "2026-07-15 21:25:00",
                "nextbuyendtime": "2026-07-15 21:00:00",
            },
            datetime(2026, 7, 15, 23, 6, tzinfo=BEIJING_TZ),
        )
        self.assertEqual(result["next_status"], "inferred")
        self.assertEqual(result["next_issue"], "26080")
        self.assertEqual(result["next_open_time"], "2026-07-18 21:25:00")
        self.assertEqual(result["next_buy_end_time"], "2026-07-18 21:00:00")

    def test_rolls_over_missed_draws_until_a_saleable_issue(self) -> None:
        result = resolve_next_draw(
            DLT,
            "26078",
            "2026-07-13",
            {},
            datetime(2026, 7, 15, 23, 6, tzinfo=BEIJING_TZ),
        )
        self.assertEqual(result["next_status"], "inferred")
        self.assertEqual(result["next_issue"], "26080")
        self.assertEqual(result["next_open_time"], "2026-07-18 21:25:00")

    def test_rolls_from_closed_class_candidate_before_result_is_published(self) -> None:
        result = resolve_next_draw(
            DLT,
            "26080",
            "2026-07-18",
            {
                "lastissueno": "26080",
                "nextissueno": "26081",
                "nextopentime": "2026-07-20 21:25:00",
                "nextbuyendtime": "2026-07-20 21:00:00",
            },
            datetime(2026, 7, 20, 21, 1, tzinfo=BEIJING_TZ),
        )
        self.assertEqual(result["next_status"], "inferred")
        self.assertEqual(result["next_issue"], "26082")
        self.assertEqual(result["next_open_time"], "2026-07-22 21:25:00")
        self.assertEqual(result["next_buy_end_time"], "2026-07-22 21:00:00")
        self.assertEqual(result["next_resolution_reason"], "class_candidate_closed_schedule_rolled")

    def test_rolls_issue_prefix_at_new_year(self) -> None:
        self.assertEqual(infer_next_issue("26150", "2026-12-30", datetime(2027, 1, 2).date()), "27001")
        self.assertEqual(infer_next_issue("2026150", "2026-12-30", datetime(2027, 1, 2).date()), "2027001")

    def test_all_configured_lotteries_can_infer_a_future_draw(self) -> None:
        config = json.loads((ROOT / "config" / "lotteries.json").read_text(encoding="utf-8"))
        samples = {
            "ssq": ("2026080", "2026-07-14"),
            "fc3d": ("2026186", "2026-07-15"),
            "qlc": ("2026080", "2026-07-15"),
            "dlt": ("26079", "2026-07-15"),
            "qxc": ("26079", "2026-07-14"),
            "pl3": ("26186", "2026-07-15"),
            "pl5": ("26186", "2026-07-15"),
            "kl8": ("2026186", "2026-07-15"),
        }
        now = datetime(2026, 7, 15, 23, 6, tzinfo=BEIJING_TZ)
        for lottery_type, (issue, draw_date) in samples.items():
            with self.subTest(lottery_type=lottery_type):
                result = resolve_next_draw(config["lotteries"][lottery_type], issue, draw_date, {}, now)
                self.assertEqual(result["next_status"], "inferred")
                self.assertGreater(datetime.fromisoformat(result["next_open_time"]).replace(tzinfo=BEIJING_TZ), now)


if __name__ == "__main__":
    unittest.main()
