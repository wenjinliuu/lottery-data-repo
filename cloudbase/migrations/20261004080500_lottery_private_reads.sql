BEGIN;

-- All App reads now go through the key-protected API. Keep service_role grants
-- and policies intact so ingest, export and the HTTP API continue to work.
REVOKE ALL ON TABLE public.lottery_draws, public.lottery_calendar FROM anon, authenticated;
DROP POLICY IF EXISTS lottery_draws_public_read ON public.lottery_draws;
DROP POLICY IF EXISTS lottery_calendar_public_read ON public.lottery_calendar;

COMMIT;

-- Rollback (only if deliberately restoring public direct database access):
-- GRANT SELECT ON TABLE public.lottery_draws, public.lottery_calendar TO anon, authenticated;
-- CREATE POLICY lottery_draws_public_read ON public.lottery_draws FOR SELECT TO anon, authenticated USING (true);
-- CREATE POLICY lottery_calendar_public_read ON public.lottery_calendar FOR SELECT TO anon, authenticated USING (true);
