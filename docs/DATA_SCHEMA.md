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
- `next_issue`: normalized next issue from a confirmed class response or schedule inference.
- `next_draw_date`: normalized next draw date.
- `next_open_time`: normalized next draw date and time.
- `next_buy_end_time`: normalized sales cutoff date and time.
- `next_status`: `confirmed`, `inferred`, or `unavailable`.
- `next_source`: `class_api`, `schedule_inference`, or `none`.
- `next_confirmed`: whether the class API has confirmed the normalized next draw.
- `next_basis_issue`: latest query issue used to confirm or infer the next draw.
- `next_resolution_reason`: machine-readable reason for the selected next-draw state.
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

## Next Draw Resolution

The class response is accepted only when its `lastissueno` matches the latest
query issue, its next issue differs from that latest issue, and its sales cutoff
is still in the future. Otherwise the exporter advances across scheduled draws
until it finds the first issue whose sales cutoff has not passed. When possible,
the raw class candidate supplies the issue/date and cutoff anchor; this lets a
new future issue be inferred even while the current draw result is delayed. An
inferred value is replaced by class data on a later run only after the class
response passes the same consistency and current-time checks.
In `calendar.json`, `last_issue` is the latest confirmed query issue, while
`class_last_issue` preserves the class API's raw last issue for diagnostics.
The calendar also exposes the resolved `next_draw_date` alongside the full
`next_open_time` so clients do not need to parse a date-time string for labels.

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
