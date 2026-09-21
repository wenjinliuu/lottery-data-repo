# Lottery read-only API

The API is the primary read path for the Duigehao iOS App. CloudBase PostgreSQL remains the
source of truth; the GitHub `public_data` tree remains the delayed mirror and client fallback.

## Base URL

```text
https://wenjin-cloudbase-d1empq882391ac1-1311287495.ap-shanghai.app.tcloudbase.com/lottery
```

Only `GET`, `HEAD`, and CORS preflight `OPTIONS` are accepted. The function never exposes
database credentials or upstream lottery-provider credentials.

## V2 routes

| Route | Purpose | Cache |
| --- | --- | --- |
| `GET /v2` | API index and supported lotteries | 1 hour |
| `GET /v2/bootstrap` | Latest draw for all lotteries plus schedule/next issue | 1 minute |
| `GET /v2/draws/{lottery_type}` | Recent draws; default and maximum 30 | 1 minute |
| `GET /v2/by-year/{lottery_type}/{year}` | One lottery and one calendar year | 1 hour |
| `GET /v2/calendar/{year}` | Normalized annual draw calendar | 1 day |
| `GET /v2/health` | Read-path health and latest issue summary | 30 seconds |

Supported lottery types are `ssq`, `dlt`, `kl8`, `fc3d`, `pl3`, `qlc`, `qxc`, and
`pl5`. The iOS App continues to map its local `k8` key to remote `kl8`.

## V1 compatibility routes

These routes preserve the current iOS decoders while the App migrates to lazy V2 loading:

- `GET /v1/latest.json`
- `GET /v1/calendar.json`
- `GET /v1/health.json`
- `GET /v1/draws/{lottery_type}.json`
- `GET /v1/by-year/{lottery_type}/{year}.json`
- `GET /v1/calendar/{year}.json`

## Intended App loading order

1. Cold start: request only `/v2/bootstrap`.
2. When the user opens one lottery's history: request `/v2/draws/{lottery_type}`.
3. When the user asks for all history: request the current year through
   `/v2/by-year/{lottery_type}/{year}`; request earlier years only when needed.
4. Cache `/v2/calendar/{year}` locally. Near New Year, also request the following year.
5. If a CloudBase request fails, retry the matching GitHub `public_data/v2` path, then use the
   most recent local disk cache. This fallback applies to bootstrap, recent draws, by-year data,
   and annual calendars. It does not apply to `/v2/health`: health reports CloudBase itself, so
   there is intentionally no `public_data/v2/health.json`.

## V2 response contract details

- Recent-draw responses use `schema: "duigehao.lottery.recent"`.
- By-year responses use `schema: "duigehao.lottery.year"`.
- `year` and `earliest_year` are JSON integers. `earliest_year` is the earliest year currently
  available for that lottery, even when the requested year's `draws` array is empty. Clients
  should use it instead of treating one empty intermediate year as the end of all history.
- A draw's `time` is optional and is omitted when the source draw row has no exact time. For the
  normal advertised draw time, use `bootstrap.schedule.{lottery_type}.draw_time`.
- Calendar `entries` are a flat array. Each entry has `date` plus time-only `draw_time` and
  `sale_close_time` fields; combine the date and time in the `Asia/Shanghai` timezone before
  comparing instants. Calendar entries intentionally do not include `weekday`; derive it from
  `date` when needed.
- `/v2/health` returns `schema: "duigehao.lottery.health"`, `version: 2`, Boolean `ok`,
  `generated_at`, `source: "cloudbase_postgresql"`, and a per-lottery `latest` summary.
  It has no GitHub mirror and should not block App startup.

The App must not embed `CLOUDBASE_API_KEY` or `JISU_APPKEY`.
