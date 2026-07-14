from __future__ import annotations

import argparse
import json
import os
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config" / "lotteries.json"

# 极速数据的大乐透 require 字段仍可能按旧奖级拆分返回。2026 年新规保留
# 13 种中奖条件并合并为 7 个奖级，因此由仓库在标准化层修正中奖条件；
# 当期具体奖金仍完全采用 API 返回值。
DLT_CANONICAL_REQUIREMENTS = {
    "一等奖": "中5+2",
    "二等奖": "中5+1",
    "三等奖": "中5+0/4+2",
    "四等奖": "中4+1",
    "五等奖": "中4+0/3+2",
    "六等奖": "中3+1/2+2",
    "七等奖": "中3+0/2+1/1+2/0+2",
}


def now_iso() -> str:
    return datetime.now(timezone(timedelta(hours=8))).replace(microsecond=0).isoformat()


def load_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def dump_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def fetch_json(url: str, timeout: int) -> dict[str, Any]:
    with urlopen(url, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def extract_numbers(value: Any) -> list[int]:
    return [int(item) for item in re.findall(r"\d+", str(value or ""))]


def parse_numbers(lottery_type: str, number_schema: str, query_result: dict[str, Any]) -> dict[str, Any]:
    main = extract_numbers(query_result.get("number"))
    refer = extract_numbers(query_result.get("refernumber"))
    if number_schema == "ssq":
        return {"red": main[:6], "blue": refer[:1] or main[6:7]}
    if number_schema == "dlt":
        return {"front": main[:5], "back": refer[:2] or main[5:7]}
    if number_schema == "qlc":
        return {"basic": main[:7], "special": (refer[:1] or main[7:8] or [None])[0]}
    if number_schema == "qxc":
        values = main[:7] if len(main) >= 7 else main[:6] + refer[:1]
        return {"digits": values[:7]}
    if number_schema == "digit3":
        digits = list("".join(str(item) for item in main))[:3]
        return {"digits": [int(item) for item in digits]}
    if number_schema == "digit5":
        digits = list("".join(str(item) for item in main))[:5]
        return {"digits": [int(item) for item in digits]}
    if number_schema == "kl8":
        return {"nums": main[:20]}
    return {"raw_numbers": main, "raw_refer_numbers": refer}


def safe_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(float(str(value).replace(",", "").replace("，", "")))
    except (TypeError, ValueError):
        return None


def safe_text(value: Any) -> str:
    return "" if value is None else str(value)


def normalize_prize_details(lottery_type: str, value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    details = []
    for index, item in enumerate(value, 1):
        if not isinstance(item, dict):
            item = {"value": item}
        prize_name = safe_text(item.get("prizename") or item.get("name") or "")
        require = safe_text(item.get("require"))
        if lottery_type == "dlt" and prize_name in DLT_CANONICAL_REQUIREMENTS:
            require = DLT_CANONICAL_REQUIREMENTS[prize_name]
        elif lottery_type == "ssq" and prize_name == "福运奖":
            # 官方规则为“任意 3 个红球”；3+1 已命中更高的五等奖，按最高奖级
            # 兑付后，福运奖实际需要补充识别的是 3+0。
            require = "中3+0"
        details.append(
            {
                "prize_level": safe_text(item.get("prizename") or item.get("level") or item.get("name") or index),
                "prize_name": prize_name,
                "require": require,
                "winning_count": safe_int(item.get("num") or item.get("winning_count")),
                "prize_amount": safe_text(item.get("singlebonus") or item.get("bonus") or item.get("prize")),
                "additional_count": safe_int(item.get("addnum") or item.get("additional_count")),
                "additional_amount": safe_text(item.get("addbonus") or item.get("additional_amount")),
                "raw": item,
            }
        )
    return details


def normalize_class_payload(payload: dict[str, Any]) -> dict[int, dict[str, Any]]:
    result = payload.get("result") if isinstance(payload, dict) else None
    if isinstance(result, list):
        items = result
    elif isinstance(result, dict):
        items = result.get("list") or result.get("data") or []
    else:
        items = []
    output: dict[int, dict[str, Any]] = {}
    for item in items:
        caipiaoid = safe_int(item.get("caipiaoid") if isinstance(item, dict) else None)
        if caipiaoid is not None:
            output[caipiaoid] = item
    return output


def build_public_draw(
    lottery_type: str,
    lottery_config: dict[str, Any],
    query_payload: dict[str, Any],
    class_info: dict[str, Any],
    query_url_public: str,
    fetched_at: str,
) -> dict[str, Any]:
    query_result = query_payload.get("result") if isinstance(query_payload, dict) else None
    if not isinstance(query_result, dict):
        raise ValueError(f"{lottery_type} query API missing result: {query_payload}")
    issue = safe_text(query_result.get("issueno") or query_result.get("issue"))
    if not issue:
        raise ValueError(f"{lottery_type} query API missing issue")
    open_date = safe_text(query_result.get("opendate") or query_result.get("officialopendate"))
    next_open_time = safe_text(class_info.get("nextopentime"))
    next_buy_end_time = safe_text(class_info.get("nextbuyendtime"))
    return {
        "schema": "random_draw_agent_draw",
        "version": 1,
        "lottery_type": lottery_type,
        "lottery_name": lottery_config["name"],
        "caipiaoid": safe_int(query_result.get("caipiaoid")) or lottery_config["caipiaoid"],
        "issue": issue,
        "draw_date": open_date[:10],
        "draw_time": open_date[11:19] if len(open_date) >= 19 else "",
        "deadline": safe_text(query_result.get("deadline")),
        "numbers": parse_numbers(lottery_type, lottery_config["number_schema"], query_result),
        "number_raw": safe_text(query_result.get("number")),
        "refernumber_raw": safe_text(query_result.get("refernumber")),
        "prize_pool": safe_text(query_result.get("totalmoney") or query_result.get("poolmoney")),
        "sales_amount": safe_text(query_result.get("saleamount") or query_result.get("sales")),
        "prize_details": normalize_prize_details(lottery_type, query_result.get("prize")),
        "next_issue": safe_text(class_info.get("nextissueno")),
        "next_draw_date": next_open_time[:10],
        "next_open_time": next_open_time,
        "next_buy_end_time": next_buy_end_time,
        "class_last_issue": safe_text(class_info.get("lastissueno")),
        "source": {
            "name": "jisuapi",
            "query_url": query_url_public,
            "class_url": "https://api.jisuapi.com/caipiao/class?appkey=***",
            "fetched_at": fetched_at,
        },
        "raw_public_json": {
            "query_response": query_payload,
            "query_result": query_result,
            "class_info": class_info,
        },
        "fetched_at": fetched_at,
    }


def sanitize_payload(value: Any, appkey: str) -> Any:
    if isinstance(value, dict):
        return {key: sanitize_payload(item, appkey) for key, item in value.items()}
    if isinstance(value, list):
        return [sanitize_payload(item, appkey) for item in value]
    if isinstance(value, str):
        return value.replace(appkey, "***") if appkey else value
    return value


def upsert_recent(output_dir: Path, lottery_type: str, draw: dict[str, Any], keep_recent: int) -> None:
    path = output_dir / "draws" / f"{lottery_type}.json"
    payload = load_json(
        path,
        {
            "schema": "random_draw_agent_lottery_draws",
            "version": 1,
            "lottery_type": lottery_type,
            "updated_at": "",
            "draws": [],
        },
    )
    draws = [item for item in payload.get("draws", []) if str(item.get("issue")) != str(draw["issue"])]
    draws.append(draw)
    draws.sort(key=lambda item: (str(item.get("draw_date", "")), str(item.get("issue", ""))), reverse=True)
    payload["updated_at"] = now_iso()
    payload["draws"] = draws[:keep_recent]
    dump_json(path, payload)


def upsert_year(output_dir: Path, lottery_type: str, draw: dict[str, Any]) -> None:
    year = str(draw.get("draw_date") or draw.get("issue") or "unknown")[:4]
    path = output_dir / "by-year" / lottery_type / f"{year}.json"
    payload = load_json(
        path,
        {
            "schema": "random_draw_agent_year_draws",
            "version": 1,
            "lottery_type": lottery_type,
            "year": year,
            "updated_at": "",
            "draws": [],
        },
    )
    draws = [item for item in payload.get("draws", []) if str(item.get("issue")) != str(draw["issue"])]
    draws.append(draw)
    draws.sort(key=lambda item: (str(item.get("draw_date", "")), str(item.get("issue", ""))), reverse=True)
    payload["updated_at"] = now_iso()
    payload["draws"] = draws
    dump_json(path, payload)


def write_calendar(output_dir: Path, config: dict[str, Any], class_by_id: dict[int, dict[str, Any]], updated_at: str) -> None:
    lotteries = {}
    for lottery_type, item in config["lotteries"].items():
        class_info = class_by_id.get(int(item["caipiaoid"]), {})
        lotteries[lottery_type] = {
            "name": item["name"],
            "caipiaoid": item["caipiaoid"],
            "draw_weekdays": item.get("draw_weekdays", []),
            "draw_time": item.get("draw_time", ""),
            "expected_publish_time": item.get("expected_publish_time", ""),
            "sale_close_time": item.get("sale_close_time", ""),
            "last_issue": safe_text(class_info.get("lastissueno")),
            "next_issue": safe_text(class_info.get("nextissueno")),
            "next_open_time": safe_text(class_info.get("nextopentime")),
            "next_buy_end_time": safe_text(class_info.get("nextbuyendtime")),
            "raw_class_info": class_info,
        }
    dump_json(
        output_dir / "calendar.json",
        {
            "schema": "random_draw_agent_calendar",
            "version": 1,
            "updated_at": updated_at,
            "timezone": config.get("timezone", "Asia/Shanghai"),
            "lotteries": lotteries,
        },
    )


def write_index(output_dir: Path, config: dict[str, Any], updated_at: str) -> None:
    dump_json(
        output_dir / "index.json",
        {
            "schema": "random_draw_agent_public_data_index",
            "version": 1,
            "updated_at": updated_at,
            "timezone": config.get("timezone", "Asia/Shanghai"),
            "files": {
                "latest": "latest.json",
                "calendar": "calendar.json",
                "health": "health.json",
                "draws": "draws/{lottery_type}.json",
                "by_year": "by-year/{lottery_type}/{year}.json",
            },
            "lotteries": list(config.get("lotteries", {}).keys()),
        },
    )


def write_health(output_dir: Path, ok: bool, message: str, updated_at: str, results: list[dict[str, Any]]) -> None:
    dump_json(
        output_dir / "health.json",
        {
            "schema": "random_draw_agent_public_data_health",
            "version": 1,
            "ok": ok,
            "updated_at": updated_at,
            "message": message,
            "results": results,
        },
    )


def update_public_data(config_path: Path = CONFIG_PATH, output_dir: Path | None = None) -> dict[str, Any]:
    config = load_json(config_path)
    api = config["api"]
    appkey = os.environ.get(api.get("appkey_env", "JISU_APPKEY"), "")
    if not appkey:
        raise RuntimeError(f"Missing environment variable {api.get('appkey_env', 'JISU_APPKEY')}")
    output_dir = output_dir or ROOT / config["export"].get("output_dir", "public_data")
    output_dir.mkdir(parents=True, exist_ok=True)

    timeout = int(api.get("timeout_seconds", 15))
    fetched_at = now_iso()
    class_url = f"{api['class_url']}?{urlencode({'appkey': appkey})}"
    class_payload = sanitize_payload(fetch_json(class_url, timeout), appkey)
    class_by_id = normalize_class_payload(class_payload)

    latest: dict[str, Any] = {}
    results: list[dict[str, Any]] = []
    for lottery_type, lottery_config in config["lotteries"].items():
        lottery_id = int(lottery_config["caipiaoid"])
        query_url = f"{api['query_url']}?{urlencode({'appkey': appkey, 'caipiaoid': lottery_id})}"
        query_payload = sanitize_payload(fetch_json(query_url, timeout), appkey)
        public_query_url = query_url.replace(appkey, "***")
        draw = build_public_draw(
            lottery_type,
            lottery_config,
            query_payload,
            class_by_id.get(lottery_id, {}),
            public_query_url,
            fetched_at,
        )
        latest[lottery_type] = draw
        upsert_recent(output_dir, lottery_type, draw, int(config["export"].get("keep_recent_per_lottery", 120)))
        if config["export"].get("write_by_year", True):
            upsert_year(output_dir, lottery_type, draw)
        results.append({"lottery_type": lottery_type, "issue": draw["issue"], "draw_date": draw["draw_date"]})

    updated_at = now_iso()
    dump_json(
        output_dir / "latest.json",
        {
            "schema": "random_draw_agent_latest",
            "version": 1,
            "updated_at": updated_at,
            "timezone": config.get("timezone", "Asia/Shanghai"),
            "draws": latest,
        },
    )
    write_calendar(output_dir, config, class_by_id, updated_at)
    write_index(output_dir, config, updated_at)
    write_health(output_dir, True, "updated", updated_at, results)
    return {"ok": True, "updated_at": updated_at, "results": results}


def main() -> None:
    parser = argparse.ArgumentParser(description="Update public lottery draw JSON files from Jisu API.")
    parser.add_argument("--config", type=Path, default=CONFIG_PATH)
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    output_dir = args.output_dir or ROOT / load_json(args.config)["export"].get("output_dir", "public_data")
    try:
        result = update_public_data(args.config, args.output_dir)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (HTTPError, URLError, TimeoutError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
        output_dir.mkdir(parents=True, exist_ok=True)
        write_health(output_dir, False, str(exc), now_iso(), [])
        raise


if __name__ == "__main__":
    main()
