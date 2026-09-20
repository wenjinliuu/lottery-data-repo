BEGIN;

ALTER TABLE public.lottery_api_usage_daily
    ADD COLUMN IF NOT EXISTS class_overnight_called BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS class_final_called BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.lottery_next_status (
    lottery_type VARCHAR(16) PRIMARY KEY,
    last_issue VARCHAR(32) NOT NULL,
    next_issue VARCHAR(32) NOT NULL,
    next_open_time TEXT NOT NULL,
    next_buy_end_time TEXT NOT NULL,
    source VARCHAR(32) NOT NULL DEFAULT 'jisuapi_class',
    source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_fetched_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.lottery_next_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lottery_next_status FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.lottery_next_status FROM anon, authenticated;
GRANT ALL ON TABLE public.lottery_next_status TO service_role;

DROP POLICY IF EXISTS lottery_next_status_service_all ON public.lottery_next_status;
CREATE POLICY lottery_next_status_service_all ON public.lottery_next_status
    FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
