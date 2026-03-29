-- Migration: Authentication Login Hardening
-- Description: Persists password-login security events for account lockout,
-- IP blocking, CAPTCHA escalation, and audit visibility.

CREATE TABLE IF NOT EXISTS auth_login_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_hash TEXT NOT NULL,
    ip_hash TEXT NOT NULL,
    ip_email_hash TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'blocked', 'rejected')),
    reason TEXT NOT NULL,
    request_id TEXT,
    user_agent_hash TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auth_login_events_email_created_at_idx
    ON auth_login_events (email_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS auth_login_events_ip_created_at_idx
    ON auth_login_events (ip_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS auth_login_events_ip_email_created_at_idx
    ON auth_login_events (ip_email_hash, created_at DESC);

ALTER TABLE auth_login_events ENABLE ROW LEVEL SECURITY;
