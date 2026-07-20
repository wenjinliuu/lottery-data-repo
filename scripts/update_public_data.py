from __future__ import annotations

import argparse
import json
import os
import re
from datetime import date, datetime, time, timezone, timedelta
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config" / "lotteries.json"
BEIJING_TZ = timezone(timedelta(hours=8))

def now_iso() -> str:
    return datetime.now(BEIJING_TZ).replace(microsecond=0).isoformat()


def parse_api_datetime(value: Any) -> datetime | None:
    text = safe_text(value).strip()
    if not text:
        return None
    normalized = text.replace("T", " ")
    for pattern in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            parsed = datetime.strptime(normalized, pattern)
            return parsed.replace(tzinfo=BEIJING_TZ)
        except ValueError:
            continue
    return None


def parse_clock(value: Any, fallback: str) -> time:
    text = safe_text(value).strip() or fallback
    for pattern in ("%H:%M:%S", "%H:%M"):
        try:
            return datetime.strptime(text, pattern).time()
        except ValueError:
            continue
    return datetime.strptime(fallback, "%H:%M").time()


def next_scheduled_datetime(draw_date: str, weekdays: list[int], draw_time: str) -> datetime | None:
    try:
        current_date = date.fromisoformat(draw_date[:10])
    except (TypeError, ValueError):
        return None
    configured_days = {int(item) for item in weekdays if isinstance(item, int) or str(item).isdigit()}
    if not configured_days:
        return None
    clock = parse_clock(draw_time, "21:00")
    for offset in range(1, 15):
        candidate = current_date + timedelta(days=offset)
        # Repository weekdays follow JavaScript: Sunday=0 ... Saturday=6.
        js_weekday = (candidate.weekday() + 1) % 7
        if js_weekday in configured_days:
            return datetime.combine(candidate, clock, tzinfo=BEIJING_TZ)
    return None


def next_saleable_scheduled_draw(
    issue: str,
    draw_date: str,
    weekdays: list[int],
    draw_time: str,
    sale_close_time: str,
    reference_now: datetime,
) -> tuple[str, datetime, datetime] | None:
    """Return the first scheduled draw whose sales cutoff is still in the future.

    A query result can lag by one or more draws.  Advancing only once from the
    latest published draw leaves the calendar unavailable after that immediate
    draw has closed.  Walk every scheduled occurrence, advancing the issue at
    each step, until reaching the first draw that can still accept a record.
    """
    current_issue = safe_text(issue).strip()
    current_date = safe_text(draw_date).strip()
    if not current_issue or not current_date:
        return None
    close_clock = parse_clock(sale_close_time, "20:00")
    for _ in range(370):
        open_dt = next_scheduled_datetime(current_date, weekdays, draw_time)
        if not open_dt:
            return None
        next_issue = infer_next_issue(current_issue, current_date, open_dt.date())
        if not next_issue or next_issue == current_issue:
            return None
        buy_end_dt = datetime.combine(open_dt.date(), close_clock, tzinfo=BEIJING_TZ)
        if buy_end_dt > reference_now:
            return next_issue, open_dt, buy_end_dt
        current_issue = next_issue
        current_date = open_dt.date().isoformat()
    return None


def infer_next_issue(issue: str, draw_date: str, next_date: date) -> str:
    issue_text = safe_text(issue).strip()
    if not issue_text.isdigit():
        return ""
    try:
        draw_year = date.fromisoformat(draw_date[:10]).year
    except (TypeError, ValueError):
        return str(int(issue_text) + 1).zfill(len(issue_text))
    if next_date.year == draw_year:
        return str(int(issue_text) + 1).zfill(len(issue_text))

    full_year = str(draw_year)
    short_year = full_year[-2:]
    if issue_text.startswith(full_year) and len(issue_text) > 4:
        suffix_width = len(issue_text) - 4
        return f"{next_date.year}{1:0{suffix_width}d}"
    if issue_text.startswith(short_year) and len(issue_text) > 2:
        suffix_width = len(issue_text) - 2
        return f"{str(next_date.year)[-2:]}{1:0{suffix_width}d}"
    return str(int(issue_text) + 1).zfill(len(issue_text))


def resolve_next_draw(
    lottery_config: dict[str, Any],
    issue: str,
    draw_date: str,
    class_info: dict[str, Any],
    reference_now: datetime,
) -> dict[str, Any]:
    class_last_issue = safe_text(class_info.get("lastissueno"))
    class_next_issue = safe_text(class_info.get("nextissueno"))
    class_next_open_time = safe_text(class_info.get("nextopentime"))
    class_next_buy_end_time = safe_text(class_info.get("nextbuyendtime"))
    class_open_dt = parse_api_datetime(class_next_open_time)

    class_buy_end_dt = parse_api_datetime(class_next_buy_end_time)
    if class_open_dt and not class_buy_end_dt:
        sale_close = parse_clock(lottery_config.get("sale_close_time"), "20:00")
        class_buy_end_dt = datetime.combine(class_open_dt.date(), sale_close, tzinfo=BEIJING_TZ)

    class_is_current = bool(
        issue
        and class_last_issue == issue
        and class_next_issue
        and class_next_issue != issue
        and class_open_dt
        and class_buy_end_dt
        and class_buy_end_dt > reference_now
    )
    if class_is_current:
        normalized_buy_end_time = class_next_buy_end_time
        if not parse_api_datetime(normalized_buy_end_time):
            sale_close = parse_clock(lottery_config.get("sale_close_time"), "20:00")
            normalized_buy_end_time = datetime.combine(class_open_dt.date(), sale_close, tzinfo=BEIJING_TZ).strftime(
                "%Y-%m-%d %H:%M:%S"
            )
        return {
            "next_issue": class_next_issue,
            "next_draw_date": class_open_dt.date().isoformat(),
            "next_open_time": class_next_open_time,
            "next_buy_end_time": normalized_buy_end_time,
            "next_status": "confirmed",
            "next_source": "class_api",
            "next_confirmed": True,
            "next_basis_issue": issue,
            "next_resolution_reason": "class_matches_latest_draw",
        }

    # Prefer the API candidate as the inference anchor.  Even when its sales
    # cutoff has passed, its issue/date pair tells us exactly which occurrence
    # follows the latest published query result (for example DLT 26081 today).
    anchor_issue = issue
    anchor_date = draw_date
    sale_close_text = safe_text(lottery_config.get("sale_close_time")) or "20:00"
    if class_next_issue and class_open_dt and class_last_issue == issue:
        anchor_issue = class_next_issue
        anchor_date = class_open_dt.date().isoformat()
        if class_buy_end_dt:
            sale_close_text = class_buy_end_dt.strftime("%H:%M")

    inferred = next_saleable_scheduled_draw(
        anchor_issue,
        anchor_date,
        lottery_config.get("draw_weekdays", []),
        safe_text(lottery_config.get("draw_time")),
        sale_close_text,
        reference_now,
    )
    # Without a usable class candidate, the latest published draw itself is the
    # anchor and must also be advanced (possibly across several missed runs).
    if not inferred and anchor_issue != issue:
        inferred = next_saleable_scheduled_draw(
            issue,
            draw_date,
            lottery_config.get("draw_weekdays", []),
            safe_text(lottery_config.get("draw_time")),
            safe_text(lottery_config.get("sale_close_time")) or "20:00",
            reference_now,
        )
    if inferred:
        inferred_issue, inferred_open_dt, inferred_buy_end_dt = inferred
        return {
            "next_issue": inferred_issue,
            "next_draw_date": inferred_open_dt.date().isoformat(),
            "next_open_time": inferred_open_dt.strftime("%Y-%m-%d %H:%M:%S"),
            "next_buy_end_time": inferred_buy_end_dt.strftime("%Y-%m-%d %H:%M:%S"),
            "next_status": "inferred",
            "next_source": "schedule_inference",
            "next_confirmed": False,
            "next_basis_issue": issue,
            "next_resolution_reason": (
                "class_candidate_closed_schedule_rolled"
                if anchor_issue != issue
                else "class_stale_or_incomplete_schedule_rolled"
            ),
        }

    return {
        "next_issue": "",
        "next_draw_date": "",
        "next_open_time": "",
        "next_buy_end_time": "",
        "next_status": "unavailable",
        "next_source": "none",
        "next_confirmed": False,
        "next_basis_issue": issue,
        "next_resolution_reason": "no_future_confirmed_or_inferred_draw",
    }


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
    reference_now: datetime,
) -> dict[str, Any]:
    query_result = query_payload.get("result") if isinstance(query_payload, dict) else None
    if not isinstance(query_result, dict):
        raise ValueError(f"{lottery_type} query API missing result: {query_payload}")
    issue = safe_text(query_result.get("issueno") or query_result.get("issue"))
    if not issue:
        raise ValueError(f"{lottery_type} query API missing issue")
    open_date = safe_text(query_result.get("opendate") or query_result.get("officialopendate"))
    next_draw = resolve_next_draw(lottery_config, issue, open_date, class_info, reference_now)
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
        **next_draw,
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


def write_calendar(
    output_dir: Path,
    config: dict[str, Any],
    class_by_id: dict[int, dict[str, Any]],
    latest: dict[str, dict[str, Any]],
    updated_at: str,
) -> None:
    lotteries = {}
    for lottery_type, item in config["lotteries"].items():
        class_info = class_by_id.get(int(item["caipiaoid"]), {})
        resolved = latest.get(lottery_type, {})
        lotteries[lottery_type] = {
            "name": item["name"],
            "caipiaoid": item["caipiaoid"],
            "draw_weekdays": item.get("draw_weekdays", []),
            "draw_time": item.get("draw_time", ""),
            "expected_publish_time": item.get("expected_publish_time", ""),
            "sale_close_time": item.get("sale_close_time", ""),
            "last_issue": safe_text(resolved.get("issue")),
            "class_last_issue": safe_text(class_info.get("lastissueno")),
            "next_issue": safe_text(resolved.get("next_issue")),
            "next_draw_date": safe_text(resolved.get("next_draw_date")),
            "next_open_time": safe_text(resolved.get("next_open_time")),
            "next_buy_end_time": safe_text(resolved.get("next_buy_end_time")),
            "next_status": safe_text(resolved.get("next_status")),
            "next_source": safe_text(resolved.get("next_source")),
            "next_confirmed": bool(resolved.get("next_confirmed")),
            "next_basis_issue": safe_text(resolved.get("next_basis_issue")),
            "next_resolution_reason": safe_text(resolved.get("next_resolution_reason")),
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
    reference_now = datetime.now(BEIJING_TZ).replace(microsecond=0)
    fetched_at = reference_now.isoformat()
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
            reference_now,
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
    write_calendar(output_dir, config, class_by_id, latest, updated_at)
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
