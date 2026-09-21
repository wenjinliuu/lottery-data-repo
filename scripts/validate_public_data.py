from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DATA = ROOT / "public_data" / "v2"
LOTTERIES = ["ssq", "fc3d", "qlc", "dlt", "qxc", "pl3", "pl5", "kl8"]
EXPECTED_WEEKDAYS = {
    "ssq": [0, 2, 4],
    "qlc": [1, 3, 5],
    "dlt": [1, 3, 6],
    "qxc": [0, 2, 5],
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
    index = load(PUBLIC_DATA / "index.json")
    bootstrap = load(PUBLIC_DATA / "bootstrap.json")
    current_year = datetime.now().year
    calendar = load(PUBLIC_DATA / "calendar" / f"{current_year}.json")
    assert index["schema"] == "duigehao.lottery.index"
    assert index["version"] == 2
    assert bootstrap["schema"] == "duigehao.lottery.bootstrap"
    assert bootstrap["version"] == 2
    assert calendar["schema"] == "duigehao.lottery.calendar"
    assert calendar["version"] == 2
    assert isinstance(bootstrap.get("latest"), dict)
    assert isinstance(bootstrap.get("schedule"), dict)
    for lottery_type, weekdays in EXPECTED_WEEKDAYS.items():
        assert bootstrap["schedule"][lottery_type]["weekdays"] == weekdays
    for lottery_type, entry in bootstrap["schedule"].items():
        next_draw = entry.get("next", {})
        status = next_draw.get("status")
        if status:
            assert status in {"inferred", "unavailable"}
            assert next_draw.get("source") in {"schedule_inference", "none"}
            assert isinstance(next_draw.get("confirmed"), bool)
            if status in {"confirmed", "inferred"}:
                assert next_draw.get("issue")
                assert next_draw.get("open_time")
                datetime.fromisoformat(str(next_draw["open_time"]).replace(" ", "T"))
            if status == "inferred":
                assert next_draw.get("confirmed") is False
    for lottery_type in LOTTERIES:
        path = PUBLIC_DATA / "draws" / f"{lottery_type}.json"
        if path.exists():
            payload = load(path)
            assert payload["lottery_type"] == lottery_type
            assert payload["schema"] == "duigehao.lottery.recent"
            assert payload["version"] == 2
            assert payload["limit"] == 30
            assert isinstance(payload.get("draws"), list)
            for draw in payload["draws"]:
                assert draw.get("issue")
                assert draw.get("date")
                assert "numbers" in draw
                validate_numbers(lottery_type, draw["numbers"])
                assert "raw_public_json" not in draw
                assert "compatibility_payload" not in draw
            issues = [str(draw["issue"]) for draw in payload["draws"]]
            assert len(issues) == len(set(issues))
            assert str(bootstrap["latest"][lottery_type]["issue"]) == issues[0]
            year_path = PUBLIC_DATA / "by-year" / lottery_type / f"{current_year}.json"
            year_payload = load(year_path)
            assert year_payload["schema"] == "duigehao.lottery.year"
            assert isinstance(year_payload["year"], int)
            assert isinstance(year_payload["earliest_year"], int)
    assert all("lottery_type" in item and "date" in item for item in calendar["entries"])
    print("V2 public data schema ok")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as exc:
        print(f"validation failed: {exc}", file=sys.stderr)
        raise
