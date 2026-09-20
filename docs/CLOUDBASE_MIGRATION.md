# CloudBase migration

Status: production ingest, seven CloudBase timers, the GitHub final fallback, and the
CloudBase-to-`public_data` compatibility mirror are active. The App still reads the existing
v1 paths. A slim v2 mirror is generated in parallel for the upcoming App cutover.

## Source of truth and compatibility

CloudBase PostgreSQL is the production source of truth. GitHub is the delayed mirror, independent
final fallback, and source repository. Existing files under `public_data/` remain v1-compatible.
New clients should use the slim files under `public_data/v2/`.

Historical upstream payloads stay in the database for audit and compatibility export. V2 never
publishes `source_payload`, `compatibility_payload`, raw API responses, duplicated prize objects,
or repeated next-draw metadata on historical rows.

## Confirmed schedule (Beijing time)

| Runner | Slot | Target date | Class API |
| --- | --- | --- | --- |
| CloudBase | 21:34 welfare early | same day | no |
| CloudBase | 21:44 all due | same day | no |
| CloudBase | 21:54 pending only | same day | no |
| CloudBase | 22:14 pending only | same day | no |
| CloudBase | 22:34 pending only | same day | no |
| CloudBase | 00:34 recovery | previous day | once |
| CloudBase | 02:44 final recovery | previous day | once |
| GitHub | 08:14 final fallback/export | previous day | no |

The two class calls are aligned with the final two CloudBase draw slots. Each slot can reserve its
call only once per target date, so a retry of the 00:34 function cannot consume the 02:44 slot.
Class data is accepted only when `lastissueno` equals the latest draw already stored in CloudBase,
the next issue differs, and the next date is valid. Stale class data never overwrites calendar
inference.

## API quota rules

- Provider plan: 100 calls/day.
- Automatic hard limit shared by CloudBase and GitHub: 60 calls per target date.
- Query and class calls both reserve from the same atomic counter.
- Class calls are additionally limited to two: 00:34 and 02:44.
- GitHub 08:14 retries only pending draws and does not make a third class call.

## Public data contracts

V1 remains unchanged for released App versions:

- `public_data/latest.json`
- `public_data/calendar.json`
- `public_data/draws/{lottery_type}.json` (50)
- `public_data/by-year/{lottery_type}/{year}.json`

Slim v2 is intended for lazy loading:

- `public_data/v2/bootstrap.json`: latest draw plus compact schedule/next information.
- `public_data/v2/draws/{lottery_type}.json`: recent 30 for one lottery.
- `public_data/v2/by-year/{lottery_type}/{year}.json`: one lottery and one year.
- `public_data/v2/calendar/{year}.json`: normalized annual draw calendar.

V2 files are minified and contain normalized App fields only.

## Live migration state

- Environment: `wenjin-cloudbase-d1empq882391ac1`, PostgreSQL, `ap-shanghai`.
- Baseline migration: `20260920143500_lottery_schema_baseline`.
- Class/v2 migration: `20260920233000_lottery_class_sync`.
- `lottery_calendar`: 2,006 baseline rows.
- `lottery_draws`: 830 baseline rows.
- `lottery-ingest`: Node.js 20.19, seven timer triggers.
- GitHub Actions deploys function code and owns the 08:14 final fallback/export.
- The trigger schedule itself is unchanged; class synchronization runs inside the existing
  `overnight_recovery` and `cloudbase_final` invocations.
