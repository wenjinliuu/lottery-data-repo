from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone, timedelta
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def now_iso() -> str:
    return datetime.now(timezone(timedelta(hours=8))).replace(microsecond=0).isoformat()


def post_webhook(url: str, payload: dict) -> None:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(request, timeout=10) as response:
        response.read()


def main() -> None:
    parser = argparse.ArgumentParser(description="Send update notifications to an optional webhook.")
    parser.add_argument("--status", choices=["success", "failure", "info"], default="info")
    parser.add_argument("--title", default="Lottery data update")
    parser.add_argument("--message", default="")
    args = parser.parse_args()

    webhook_url = os.environ.get("LOTTERY_NOTIFY_WEBHOOK_URL", "").strip()
    if not webhook_url:
        print("LOTTERY_NOTIFY_WEBHOOK_URL is not set; skip notification.")
        return

    text = f"{args.title}\n状态：{args.status}\n时间：{now_iso()}"
    if args.message:
        text += f"\n详情：{args.message}"
    payload = {
        "text": text,
        "title": args.title,
        "status": args.status,
        "message": args.message,
        "created_at": now_iso(),
        "source": "lottery-data-repo",
    }
    post_webhook(webhook_url, payload)
    print("notification sent")


if __name__ == "__main__":
    try:
        main()
    except (HTTPError, URLError, TimeoutError, ValueError) as exc:
        print(f"notification failed: {exc}")
