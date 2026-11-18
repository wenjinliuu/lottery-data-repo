BEGIN;

CREATE TABLE IF NOT EXISTS public.draw_push_deliveries (
    lottery_type VARCHAR(16) NOT NULL,
    issue VARCHAR(32) NOT NULL,
    device_token TEXT NOT NULL REFERENCES public.push_devices(token) ON DELETE CASCADE,
    claim_id UUID,
    lease_until TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0,
    accepted_at TIMESTAMPTZ,
    last_error TEXT,
    PRIMARY KEY (lottery_type, issue, device_token)
);

ALTER TABLE public.draw_push_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draw_push_deliveries FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.draw_push_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.draw_push_deliveries TO service_role;
CREATE POLICY draw_push_deliveries_service_all ON public.draw_push_deliveries
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Erase the old purchase-derived preferences. Preserve opted-out and disabled devices.
UPDATE public.push_devices
SET lotteries = '["dlt","fc3d","kl8","pl3","pl5","qlc","qxc","ssq"]'::jsonb
WHERE jsonb_array_length(lotteries) > 0;

-- Atomically claim a bounded batch. A crashed worker releases its claims after three minutes.
CREATE FUNCTION public.claim_draw_push_deliveries(p_lottery_type text, p_issue text, p_claim_id uuid)
RETURNS TABLE (device_token text, environment varchar)
LANGUAGE sql
SET search_path = ''
AS $$
    WITH candidates AS (
        SELECT d.token
        FROM public.push_devices d
        LEFT JOIN public.draw_push_deliveries l
            ON l.lottery_type = p_lottery_type AND l.issue = p_issue AND l.device_token = d.token
        WHERE NOT d.disabled AND jsonb_array_length(d.lotteries) > 0
          AND l.accepted_at IS NULL
          AND COALESCE(l.attempts, 0) < 5
          AND COALESCE(l.lease_until, '-infinity'::timestamptz) <= now()
          AND COALESCE(l.last_error, '') <> 'inactive_device'
          AND NOT EXISTS (
              SELECT 1 FROM public.draw_push_log old
              WHERE old.lottery_type = p_lottery_type AND old.issue = p_issue AND old.delivered > 0
          )
        ORDER BY COALESCE(l.attempts, 0), d.token
        LIMIT 500
    ), claims AS (
        INSERT INTO public.draw_push_deliveries AS l
            (lottery_type, issue, device_token, claim_id, lease_until, attempts)
        SELECT p_lottery_type, p_issue, c.token, p_claim_id, now() + interval '3 minutes', 1
        FROM candidates c
        ON CONFLICT (lottery_type, issue, device_token) DO UPDATE
        SET claim_id = EXCLUDED.claim_id, lease_until = EXCLUDED.lease_until,
            attempts = l.attempts + 1
        WHERE l.accepted_at IS NULL AND l.attempts < 5
          AND COALESCE(l.lease_until, '-infinity'::timestamptz) <= now()
          AND COALESCE(l.last_error, '') <> 'inactive_device'
        RETURNING l.device_token
    )
    SELECT c.device_token, d.environment
    FROM claims c JOIN public.push_devices d ON d.token = c.device_token;
$$;

REVOKE ALL ON FUNCTION public.claim_draw_push_deliveries(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_draw_push_deliveries(text, text, uuid) TO service_role;

COMMIT;
