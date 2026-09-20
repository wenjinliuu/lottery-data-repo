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
   most recent local disk cache.

The App must not embed `CLOUDBASE_API_KEY` or `JISU_APPKEY`.
