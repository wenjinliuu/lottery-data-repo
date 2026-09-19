BEGIN;

CREATE TABLE IF NOT EXISTS lottery_draws (
    id BIGSERIAL PRIMARY KEY,
    lottery_type VARCHAR(16) NOT NULL,
    issue VARCHAR(32) NOT NULL,
    draw_date DATE NOT NULL,
    draw_time TIME,
    numbers JSONB NOT NULL,
    prize_pool TEXT,
    sales_amount TEXT,
    prize_details JSONB NOT NULL DEFAULT '[]'::jsonb,
    semantic_checksum CHAR(64) NOT NULL,
    compatibility_payload JSONB NOT NULL,
    source_payload JSONB,
    source_name VARCHAR(32) NOT NULL DEFAULT 'jisuapi',
    source_fetched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (lottery_type, issue)
);

CREATE INDEX IF NOT EXISTS lottery_draws_type_date_idx
    ON lottery_draws (lottery_type, draw_date DESC);

CREATE TABLE IF NOT EXISTS lottery_calendar (
    lottery_type VARCHAR(16) NOT NULL,
    issue VARCHAR(32) NOT NULL,
    draw_date DATE NOT NULL,
    draw_time TIME,
    sale_close_time TIME,
    source VARCHAR(32) NOT NULL DEFAULT 'generated',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (lottery_type, issue),
    UNIQUE (lottery_type, draw_date)
);

CREATE INDEX IF NOT EXISTS lottery_calendar_date_idx
    ON lottery_calendar (draw_date, lottery_type);

CREATE TABLE IF NOT EXISTS lottery_fetch_targets (
    target_date DATE NOT NULL,
    lottery_type VARCHAR(16) NOT NULL,
    expected_issue VARCHAR(32) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'updated', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    latest_returned_issue VARCHAR(32),
    last_error TEXT,
    first_attempt_at TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (target_date, lottery_type)
);

CREATE TABLE IF NOT EXISTS lottery_api_usage_daily (
    usage_date DATE NOT NULL,
    provider VARCHAR(32) NOT NULL,
    call_count INTEGER NOT NULL DEFAULT 0 CHECK (call_count >= 0),
    class_call_count INTEGER NOT NULL DEFAULT 0 CHECK (class_call_count >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (usage_date, provider)
);

CREATE TABLE IF NOT EXISTS lottery_ingest_runs (
    id BIGSERIAL PRIMARY KEY,
    runner VARCHAR(32) NOT NULL,
    slot VARCHAR(64) NOT NULL,
    target_date DATE NOT NULL,
    status VARCHAR(24) NOT NULL,
    requested_count INTEGER NOT NULL DEFAULT 0,
    updated_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

COMMIT;
