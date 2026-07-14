from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DATA = ROOT / "public_data"
LOTTERIES = ["ssq", "fc3d", "qlc", "dlt", "qxc", "pl3", "pl5", "kl8"]
EXPECTED_WEEKDAYS = {
    "ssq": [0, 2, 4],
    "qlc": [1, 3, 5],
    "dlt": [1, 3, 6],
    "qxc": [0, 2, 5],
}
DLT_EXPECTED_REQUIREMENTS = {
    "一等奖": "中5+2",
    "二等奖": "中5+1",
    "三等奖": "中5+0/4+2",
    "四等奖": "中4+1",
    "五等奖": "中4+0/3+2",
    "六等奖": "中3+1/2+2",
    "七等奖": "中3+0/2+1/1+2/0+2",
}


def assert_range(values: list, count: int, low: int, high: int, *, unique: bool = False) -> None:
    assert len(values) == count
    assert all(isinstance(value, int) and low <= value <= high for value in values)
    if unique:
        assert len(set(values)) == count


def validate_numbers(lottery_type: str, numbers: dict) -> None:
    if lottery_type == "ssq":
        assert_range(numbers.get("red", []), 6, 1, 33, unique=True)
        assert_range(numbers.get("blue", []), 1, 1, 16)
    elif lottery_type == "dlt":
        assert_range(numbers.get("front", []), 5, 1, 35, unique=True)
        assert_range(numbers.get("back", []), 2, 1, 12, unique=True)
    elif lottery_type == "qlc":
        assert_range(numbers.get("basic", []), 7, 1, 30, unique=True)
        assert_range([numbers.get("special")], 1, 1, 30)
    elif lottery_type == "qxc":
        digits = numbers.get("digits", [])
        assert_range(digits[:6], 6, 0, 9)
        assert_range(digits[6:], 1, 0, 14)
    elif lottery_type in {"fc3d", "pl3"}:
        assert_range(numbers.get("digits", []), 3, 0, 9)
    elif lottery_type == "pl5":
        assert_range(numbers.get("digits", []), 5, 0, 9)
    elif lottery_type == "kl8":
        assert_range(numbers.get("nums", []), 20, 1, 80, unique=True)


def load(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def main() -> None:
    latest = load(PUBLIC_DATA / "latest.json")
    calendar = load(PUBLIC_DATA / "calendar.json")
    health = load(PUBLIC_DATA / "health.json")
    assert latest["schema"] == "random_draw_agent_latest"
    assert calendar["schema"] == "random_draw_agent_calendar"
    assert health["schema"] == "random_draw_agent_public_data_health"
    assert isinstance(latest.get("draws"), dict)
    for lottery_type, weekdays in EXPECTED_WEEKDAYS.items():
        assert calendar["lotteries"][lottery_type]["draw_weekdays"] == weekdays
    dlt_prizes = {
        prize["prize_name"]: prize.get("require", "")
        for prize in latest["draws"]["dlt"].get("prize_details", [])
        if prize.get("prize_name") in DLT_EXPECTED_REQUIREMENTS
    }
    assert dlt_prizes == DLT_EXPECTED_REQUIREMENTS
    for prize in latest["draws"]["ssq"].get("prize_details", []):
        if prize.get("prize_name") == "福运奖":
            assert prize.get("require") == "中3+0"
    for lottery_type in LOTTERIES:
        path = PUBLIC_DATA / "draws" / f"{lottery_type}.json"
        if path.exists():
            payload = load(path)
            assert payload["lottery_type"] == lottery_type
            assert isinstance(payload.get("draws"), list)
            for draw in payload["draws"]:
                assert draw["lottery_type"] == lottery_type
                assert draw.get("issue")
                assert "numbers" in draw
                validate_numbers(lottery_type, draw["numbers"])
                assert "raw_public_json" in draw
            issues = [str(draw["issue"]) for draw in payload["draws"]]
            assert len(issues) == len(set(issues))
            assert str(latest["draws"][lottery_type]["issue"]) == issues[0]
    print("public data schema ok")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as exc:
        print(f"validation failed: {exc}", file=sys.stderr)
        raise
