# CloudBase migration

Status: preparation branch only. The existing `main` workflow and public JSON paths remain unchanged.

## Frozen baseline

- Repository: `wenjinliuu/lottery-data-repo`
- Baseline branch: `main`
- Baseline commit: `f062e1a8263864e37a55a306bad23312065d9f6e`
- Migration branch: `migration/cloudbase-v2`

## Source of truth and compatibility

CloudBase PostgreSQL becomes the only production source of truth. GitHub remains a delayed mirror and final fallback. During migration, the App continues to read the existing paths under `public_data/`.

Historical GitHub files are imported exactly once through an idempotent upsert keyed by `(lottery_type, issue)`. They are not re-fetched from the upstream API. The original record is retained in `compatibility_payload` so the compatibility exporter can reproduce the current App contract while the normalized columns support efficient queries.

## Confirmed schedule (Beijing time)

| Runner | Slot | Target date |
| --- | --- | --- |
| CloudBase | 21:34 welfare early | same day |
| CloudBase | 21:44 all due | same day |
| CloudBase | 21:54 pending only | same day |
| CloudBase | 22:14 pending only | same day |
| CloudBase | 22:34 pending only | same day |
| CloudBase | 00:34 recovery | previous day |
| CloudBase | 02:44 final recovery | previous day |
| GitHub | 08:14 final fallback | previous day |

The minutes intentionally avoid the assumed upstream `:00/:10/:20/:30/:40/:50` synchronization boundary. A returned old issue is not success. Success is tracked per lottery; later slots skip completed lotteries.

## API quota rules

- Provider plan: 100 calls/day.
- Automatic hard limit shared by CloudBase and GitHub: 50 calls per target date.
- Query calls are reserved atomically before contacting the provider.
- `class` may be called at most once per target date.
- Remaining quota is reserved for manual recovery and diagnostics.

## Deployment order

1. Apply `cloudbase/sql/001_initial.sql` to the existing CloudBase PostgreSQL instance.
2. Set `DATABASE_URL` locally or in a one-off private job and run `npm run import:history` from `cloudbase/`.
3. Compare imported row counts and semantic checksums with `public_data/by-year`.
4. Deploy the Node.js 20 function with `JISU_APPKEY` and `DATABASE_URL` as secrets.
5. Create seven CloudBase triggers using the slot names in `cloudbase/config/schedule.json`.
6. Shadow-run without changing the App or `main` GitHub workflow.
7. Add compatibility export, diff reports, and the 08:14 GitHub fallback before cutover.
