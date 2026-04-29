from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DATA = ROOT / "public_data"
LOTTERIES = ["ssq", "fc3d", "qlc", "dlt", "qxc", "pl3", "pl5", "kl8"]


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
                assert "raw_public_json" in draw
    print("public data schema ok")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as exc:
        print(f"validation failed: {exc}", file=sys.stderr)
        raise
