-- ── VetIOS Audit Log Table ────────────────────────────────────────────────
-- Stores a tamper-evident record of every API call including tenant identity,
-- hashed IP, endpoint, response code, fingerprint, and content hash.
-- Retention: 90 days enforced by the cleanup function below.

CREATE TABLE IF NOT EXISTS vetios_audit_log (
    id              BIGSERIAL PRIMARY KEY,
    request_id      TEXT        NOT NULL,
    tenant_id       TEXT,
    endpoint        TEXT        NOT NULL,
    method          TEXT        NOT NULL DEFAULT 'POST',
    status_code     INTEGER     NOT NULL,
    latency_ms      INTEGER,
    ip_hash         TEXT,                   -- SHA-256 first 16 hex chars
    user_agent_hash TEXT,                   -- SHA-256 first 12 hex chars
    fingerprint     TEXT,                   -- vi1.<payload>.<sig> watermark token
    content_hash    TEXT,                   -- SHA-256 first 32 hex chars of response
    mode            TEXT,                   -- clinical | educational | general
    blocked         BOOLEAN     NOT NULL DEFAULT FALSE,
    block_reason    TEXT,
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for tenant-scoped audit queries
CREATE INDEX IF NOT EXISTS idx_audit_tenant_created
    ON vetios_audit_log (tenant_id, created_at DESC);

-- Index for fingerprint lookups (clone/copy detection)
CREATE INDEX IF NOT EXISTS idx_audit_fingerprint
    ON vetios_audit_log (fingerprint)
    WHERE fingerprint IS NOT NULL;

-- Index for blocked request monitoring
CREATE INDEX IF NOT EXISTS idx_audit_blocked
    ON vetios_audit_log (blocked, created_at DESC)
    WHERE blocked = TRUE;

-- Index for endpoint-level analytics
CREATE INDEX IF NOT EXISTS idx_audit_endpoint_created
    ON vetios_audit_log (endpoint, created_at DESC);

-- RLS: only service role can read audit logs (no user-facing access)
ALTER TABLE vetios_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON vetios_audit_log
    USING (auth.role() = 'service_role');

-- ── 90-day retention cleanup ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cleanup_old_audit_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM vetios_audit_log
    WHERE created_at < NOW() - INTERVAL '90 days';
END;
$$;

COMMENT ON TABLE vetios_audit_log IS
    'Tamper-evident audit trail for all VetIOS API calls. '
    'Retention: 90 days. Service role access only. '
    'Fingerprint column enables tracing of outputs that appear outside the platform.';
