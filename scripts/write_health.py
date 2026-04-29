from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def now_iso() -> str:
    return datetime.now(timezone(timedelta(hours=8))).replace(microsecond=0).isoformat()


def main() -> None:
    parser = argparse.ArgumentParser(description="Write public_data/health.json status.")
    parser.add_argument("--ok", action="store_true")
    parser.add_argument("--fail", action="store_true")
    parser.add_argument("--message", default="")
    parser.add_argument("--stage", default="")
    args = parser.parse_args()
    ok = bool(args.ok and not args.fail)
    payload = {
        "schema": "random_draw_agent_public_data_health",
        "version": 1,
        "ok": ok,
        "updated_at": now_iso(),
        "message": args.message or ("ok" if ok else "failed"),
        "stage": args.stage,
        "results": [],
    }
    path = ROOT / "public_data" / "health.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
