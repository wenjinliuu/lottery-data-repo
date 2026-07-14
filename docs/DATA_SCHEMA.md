# Public Data Schema

## Draw Record

Each draw record is stored in `latest.json`, `draws/{lottery_type}.json`, and `by-year/{lottery_type}/{year}.json`.

Important fields:

- `lottery_type`: internal key, such as `dlt`.
- `lottery_name`: display name.
- `caipiaoid`: Jisu API lottery id.
- `issue`: draw issue.
- `draw_date`: draw date, `YYYY-MM-DD`.
- `draw_time`: draw time when available.
- `deadline`: prize claim deadline from query API.
- `numbers`: structured numbers for machine reading.
- `number_raw`: original `number` string from query API.
- `refernumber_raw`: original `refernumber` string from query API.
- `prize_pool`: `totalmoney` or equivalent.
- `sales_amount`: `saleamount` or equivalent.
- `prize_details`: prize levels, winning count, single bonus, additional bonus, and raw prize row.
- `next_issue`: next issue from class API.
- `next_draw_date`: date part of `nextopentime`.
- `next_open_time`: full `nextopentime`.
- `next_buy_end_time`: full `nextbuyendtime`.
- `class_last_issue`: `lastissueno` from class API.
- `source`: sanitized source metadata.
- `raw_public_json`: sanitized raw API response data.
- `fetched_at`: update time.

## Raw API Preservation

The public data keeps:

```json
{
  "raw_public_json": {
    "query_response": {},
    "query_result": {},
    "class_info": {}
  }
}
```

This means future parsers can recover fields that were not normalized yet.

Sensitive values, especially API keys, must be replaced with `***`.

## Prize Requirement Normalization

`prize_details[].prize_amount` always keeps the amount returned for that draw.
The normalized `require` field may be corrected against the currently effective
official game rules when the upstream API returns an outdated or incomplete
condition. The untouched upstream row remains available in
`prize_details[].raw` and `raw_public_json` for auditing.

For example, the 2026 Super Lotto (`dlt`) rules merge 13 winning combinations
into seven prize levels, so third prize is normalized as:

```json
{
  "prize_name": "三等奖",
  "require": "中5+0/4+2",
  "prize_amount": "5000"
}
```

Temporary prizes are draw-specific. A client must only enable a temporary
prize, such as `福运奖`, when that prize is present in the draw's
`prize_details`.

## Long-Term Storage

`latest.json` should remain small forever.

`draws/{lottery_type}.json` keeps recent draws only. The retention count is configured by:

```json
{
  "export": {
    "keep_recent_per_lottery": 50
  }
}
```

Long-term history is stored in yearly files:

```text
public_data/by-year/dlt/2026.json
public_data/by-year/dlt/2027.json
```

This layout is intended to run for years without one huge JSON file.
