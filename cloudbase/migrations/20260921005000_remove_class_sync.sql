BEGIN;

DROP TABLE IF EXISTS public.lottery_next_status;

ALTER TABLE public.lottery_api_usage_daily
    DROP COLUMN IF EXISTS class_call_count,
    DROP COLUMN IF EXISTS class_overnight_called,
    DROP COLUMN IF EXISTS class_final_called;

COMMIT;
