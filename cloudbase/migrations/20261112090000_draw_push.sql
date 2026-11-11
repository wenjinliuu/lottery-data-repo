BEGIN;

-- 开奖推送。云端只知道「哪台设备订了哪些彩种」，不存任何票据：
-- 中没中由手机收到通知后在本机核对。

CREATE TABLE IF NOT EXISTS public.push_devices (
    token TEXT PRIMARY KEY,
    environment VARCHAR(16) NOT NULL DEFAULT 'production'
        CHECK (environment IN ('production', 'sandbox')),
    bundle_id TEXT NOT NULL DEFAULT '',
    -- 订阅的彩种键数组，如 ["ssq","dlt"]。空数组 = 不推。
    lotteries JSONB NOT NULL DEFAULT '[]'::jsonb,
    disabled BOOLEAN NOT NULL DEFAULT FALSE,
    last_error TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 每一期只推一次。
CREATE TABLE IF NOT EXISTS public.draw_push_log (
    lottery_type VARCHAR(16) NOT NULL,
    issue VARCHAR(32) NOT NULL,
    delivered INTEGER NOT NULL DEFAULT 0,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (lottery_type, issue)
);

ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_devices FORCE ROW LEVEL SECURITY;
ALTER TABLE public.draw_push_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draw_push_log FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.push_devices, public.draw_push_log FROM anon, authenticated;
GRANT ALL ON TABLE public.push_devices, public.draw_push_log TO service_role;

DROP POLICY IF EXISTS push_devices_service_all ON public.push_devices;
CREATE POLICY push_devices_service_all ON public.push_devices
    FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS draw_push_log_service_all ON public.draw_push_log;
CREATE POLICY draw_push_log_service_all ON public.draw_push_log
    FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;

-- Rollback:
-- DROP TABLE public.draw_push_log, public.push_devices;
