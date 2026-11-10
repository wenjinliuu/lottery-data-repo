BEGIN;

-- 个人票据：App 把录入的票同步上来，开奖抓取完成后由云端核对并推送。
-- 只有 service_role（云函数）能读写；App 只能经带个人密钥的 /v2/me 接口访问。

CREATE SEQUENCE IF NOT EXISTS public.user_tickets_sync_seq;

CREATE TABLE IF NOT EXISTS public.user_tickets (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL DEFAULT '',
    lottery_type VARCHAR(16) NOT NULL,
    issue VARCHAR(32) NOT NULL DEFAULT '',
    -- 与 App 备份文件里的单条记录同构（lottery-ios BackupService.dictionary）。
    record JSONB NOT NULL,
    client_updated_at TIMESTAMPTZ NOT NULL,
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    -- 云端核对结果，和 App 自己的核对结果分开存，互不覆盖。
    settle_status VARCHAR(16)
        CHECK (settle_status IS NULL OR settle_status IN ('won', 'lost', 'prize_float')),
    settle_prize_name TEXT,
    settle_amount NUMERIC(14, 2),
    settle_matched JSONB,
    settled_at TIMESTAMPTZ,
    -- 每次写入都取一个新序号，App 按它增量拉取。
    sync_seq BIGINT NOT NULL DEFAULT nextval('public.user_tickets_sync_seq'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.user_tickets_bump_sync_seq() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.sync_seq := nextval('public.user_tickets_sync_seq');
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_tickets_bump_sync_seq ON public.user_tickets;
CREATE TRIGGER user_tickets_bump_sync_seq
    BEFORE UPDATE ON public.user_tickets
    FOR EACH ROW EXECUTE FUNCTION public.user_tickets_bump_sync_seq();

CREATE UNIQUE INDEX IF NOT EXISTS user_tickets_sync_seq_idx ON public.user_tickets (sync_seq);
CREATE INDEX IF NOT EXISTS user_tickets_issue_idx
    ON public.user_tickets (lottery_type, issue) WHERE NOT deleted;

CREATE TABLE IF NOT EXISTS public.user_push_devices (
    token TEXT PRIMARY KEY,
    environment VARCHAR(16) NOT NULL DEFAULT 'production'
        CHECK (environment IN ('production', 'sandbox')),
    bundle_id TEXT NOT NULL DEFAULT '',
    disabled BOOLEAN NOT NULL DEFAULT FALSE,
    last_error TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 每一期、每个阶段只推一次：result = 号码出来了；final = 浮动奖金落定。
CREATE TABLE IF NOT EXISTS public.user_draw_notifications (
    lottery_type VARCHAR(16) NOT NULL,
    issue VARCHAR(32) NOT NULL,
    stage VARCHAR(16) NOT NULL CHECK (stage IN ('result', 'final')),
    summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (lottery_type, issue, stage)
);

ALTER TABLE public.user_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_tickets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_push_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_push_devices FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_draw_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_draw_notifications FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_tickets, public.user_push_devices,
    public.user_draw_notifications FROM anon, authenticated;
GRANT ALL ON TABLE public.user_tickets, public.user_push_devices,
    public.user_draw_notifications TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.user_tickets_sync_seq TO service_role;

DROP POLICY IF EXISTS user_tickets_service_all ON public.user_tickets;
CREATE POLICY user_tickets_service_all ON public.user_tickets
    FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS user_push_devices_service_all ON public.user_push_devices;
CREATE POLICY user_push_devices_service_all ON public.user_push_devices
    FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS user_draw_notifications_service_all ON public.user_draw_notifications;
CREATE POLICY user_draw_notifications_service_all ON public.user_draw_notifications
    FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;

-- Rollback（会删掉云端的全部个人票据，本机数据不受影响）：
-- DROP TABLE public.user_draw_notifications, public.user_push_devices, public.user_tickets;
-- DROP FUNCTION public.user_tickets_bump_sync_seq();
-- DROP SEQUENCE public.user_tickets_sync_seq;
