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

## Prize Requirements

`prize_details[].require` and `prize_details[].prize_amount` preserve the values
returned by the upstream API for that draw. The data repository does not rewrite
winning conditions. Client applications are responsible for applying their own
versioned game rules when evaluating a ticket.

The untouched upstream row also remains available in `prize_details[].raw` and
`raw_public_json` for auditing. Temporary prizes are draw-specific; a client
should only enable a temporary prize when that prize is present in the draw's
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
