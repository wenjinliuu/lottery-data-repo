ALTER TABLE public.lottery_draws
  ADD COLUMN IF NOT EXISTS data_status varchar(20);

UPDATE public.lottery_draws AS d
SET data_status = CASE
  WHEN jsonb_array_length(d.prize_details) > 0
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(d.prize_details) AS p(item)
      WHERE (
        (p.item->'winning_count') IS NULL
        OR p.item->'winning_count' = 'null'::jsonb
      )
      AND NOT (
        p.item->'raw' ? 'num'
        AND COALESCE(p.item->'raw'->>'num', '') ~ '^-?[0-9]+$'
      )
    )
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(d.prize_details) AS p(item)
      WHERE COALESCE(p.item->>'prize_amount', p.item->'raw'->>'singlebonus', '') <> ''
    )
    AND regexp_replace(COALESCE(d.sales_amount, ''), '[,，]', '', 'g')
      ~ '^[0-9]+([.][0-9]+)?$'
    AND regexp_replace(COALESCE(d.sales_amount, ''), '[,，]', '', 'g')::numeric > 0
    AND (
      d.lottery_type <> 'kl8'
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(d.prize_details) AS p(item)
        WHERE COALESCE(
          NULLIF(p.item->>'winning_count', '')::integer,
          NULLIF(p.item->'raw'->>'num', '')::integer,
          0
        ) > 0
      )
    )
  THEN 'completed'
  ELSE 'numbers_ready'
END;

ALTER TABLE public.lottery_draws
  ALTER COLUMN data_status SET DEFAULT 'completed',
  ALTER COLUMN data_status SET NOT NULL;

ALTER TABLE public.lottery_fetch_targets
  ADD COLUMN IF NOT EXISTS data_status varchar(20),
  ADD COLUMN IF NOT EXISTS last_execution_status varchar(20),
  ADD COLUMN IF NOT EXISTS last_action varchar(20),
  ADD COLUMN IF NOT EXISTS last_execution_at timestamptz;

UPDATE public.lottery_fetch_targets AS t
SET data_status = CASE
      WHEN d.data_status IS NOT NULL THEN d.data_status
      WHEN t.status = 'updated' THEN 'completed'
      ELSE 'waiting'
    END,
    last_execution_status = CASE
      WHEN t.last_attempt_at IS NOT NULL THEN
        CASE WHEN t.last_error IS NULL THEN 'success' ELSE 'failed' END
      ELSE NULL
    END,
    last_action = CASE WHEN t.last_attempt_at IS NOT NULL THEN 'fetched' ELSE NULL END,
    last_execution_at = t.last_attempt_at
FROM public.lottery_draws AS d
WHERE d.lottery_type = t.lottery_type
  AND d.issue = t.expected_issue;

UPDATE public.lottery_fetch_targets
SET data_status = CASE WHEN status = 'updated' THEN 'completed' ELSE 'waiting' END,
    last_execution_status = CASE
      WHEN last_attempt_at IS NOT NULL THEN
        CASE WHEN last_error IS NULL THEN 'success' ELSE 'failed' END
      ELSE NULL
    END,
    last_action = CASE WHEN last_attempt_at IS NOT NULL THEN 'fetched' ELSE NULL END,
    last_execution_at = last_attempt_at
WHERE data_status IS NULL;

ALTER TABLE public.lottery_fetch_targets
  ALTER COLUMN data_status SET DEFAULT 'waiting',
  ALTER COLUMN data_status SET NOT NULL;

CREATE INDEX IF NOT EXISTS lottery_draws_data_status_idx
  ON public.lottery_draws (data_status, draw_date DESC);
CREATE INDEX IF NOT EXISTS lottery_fetch_targets_status_idx
  ON public.lottery_fetch_targets (target_date DESC, data_status);
CREATE INDEX IF NOT EXISTS lottery_ingest_runs_started_idx
  ON public.lottery_ingest_runs (started_at DESC);

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lottery_draws_data_status_check'
  ) THEN
    ALTER TABLE public.lottery_draws
      ADD CONSTRAINT lottery_draws_data_status_check
      CHECK (data_status IN ('numbers_ready', 'completed'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lottery_fetch_targets_data_status_check'
  ) THEN
    ALTER TABLE public.lottery_fetch_targets
      ADD CONSTRAINT lottery_fetch_targets_data_status_check
      CHECK (data_status IN ('waiting', 'numbers_ready', 'completed'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lottery_fetch_targets_execution_status_check'
  ) THEN
    ALTER TABLE public.lottery_fetch_targets
      ADD CONSTRAINT lottery_fetch_targets_execution_status_check
      CHECK (last_execution_status IS NULL OR last_execution_status IN ('success', 'failed'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lottery_fetch_targets_action_check'
  ) THEN
    ALTER TABLE public.lottery_fetch_targets
      ADD CONSTRAINT lottery_fetch_targets_action_check
      CHECK (last_action IS NULL OR last_action IN ('fetched', 'skipped'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lottery_ingest_runs_status_check'
  ) THEN
    ALTER TABLE public.lottery_ingest_runs
      ADD CONSTRAINT lottery_ingest_runs_status_check
      CHECK (status IN ('running', 'success', 'failed'));
  END IF;
END
$migration$;
