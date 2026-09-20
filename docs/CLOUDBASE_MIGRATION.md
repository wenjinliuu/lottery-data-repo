# CloudBase migration

Status: production ingest, seven CloudBase timers, the GitHub final fallback, and the
CloudBase-to-`public_data` compatibility mirror are active. The App still reads the existing
`public_data/` paths, so no client cutover is required yet.

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

1. Apply `cloudbase/migrations/20260920143500_lottery_schema_baseline.sql`.
2. Import GitHub history with `npm run import:history` from `cloudbase/`.
3. Compare imported row counts and semantic checksums with `public_data/by-year`.
4. Deploy the Node.js 20 ingest function with `JISU_APPKEY`, `CLOUDBASE_API_KEY`, and
   `CLOUDBASE_ENV_ID` as secrets/environment variables.
5. Create seven CloudBase triggers using the slot names in `cloudbase/config/schedule.json`.
6. Shadow-run without changing the App or `main` GitHub workflow.
7. Add compatibility export, diff reports, and the 08:14 GitHub fallback before cutover.

All seven steps are complete.

## Live migration state (2026-09-20)

- Environment: `wenjin-cloudbase-d1empq882391ac1`, PostgreSQL, `ap-shanghai`.
- Migration `20260920143500_lottery_schema_baseline` is applied and recorded.
- `lottery_calendar`: 2,006 rows.
- `lottery_draws`: 830 rows. Per-lottery counts and semantic checksums match the current
  `main/public_data/by-year` files.
- Public clients have SELECT only on `lottery_calendar` and `lottery_draws`.
- Internal quota, target, and run tables are not exposed to `anon` or `authenticated`.
- `lottery-ingest` is active on Node.js 20.19 with seven Beijing-time timer triggers.
- GitHub Actions deploys function code and owns the 08:14 final fallback/export job.
- A live shadow fetch and a full GitHub fallback/export validation both succeeded. The five
  2026-09-19 draws retained the same semantic checksums as the pre-migration files.
- The first committed CloudBase mirror was exported at 2026-09-20 19:23 Beijing time and passed
  all Node/Python tests, the 830-draw calendar comparison, and public schema validation.
- Test usage for target date 2026-09-19 was 6 provider calls, below the 50-call automatic cap.
- The one-off `lottery-history-import` function remains inactive with no trigger.
