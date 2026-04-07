-- Migration: Fix Tenant Isolation Fallback
-- Description: Refines the tenant isolation trigger to support auth.uid() fallback
-- and bypasses for service roles. This resolves the "Tenant context is missing" 
-- error when logging inference events from both client and server.

CREATE OR REPLACE FUNCTION public.enforce_tenant_isolation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    -- Use the robust current_tenant_text() which handles auth.uid() fallback
    session_tenant text := public.current_tenant_text();
    session_role text := coalesce(nullif(current_setting('app.role', true), ''), 'tenant_user');
BEGIN
    -- Bypass isolation checks for system and administrative roles
    -- This ensures server-side logging (from Railway/Backend) is not blocked
    IF session_role IN ('system_admin', 'service_role', 'supabase_admin') THEN
        RETURN coalesce(new, old);
    END IF;

    IF session_tenant IS NULL THEN
        RAISE EXCEPTION 'Tenant context is missing for %', tg_table_name;
    END IF;

    IF tg_op = 'DELETE' THEN
        IF old.tenant_id::text IS DISTINCT FROM session_tenant THEN
            RAISE EXCEPTION 'Tenant isolation violation on delete for %', tg_table_name;
        END IF;
        RETURN old;
    END IF;

    IF new.tenant_id::text IS DISTINCT FROM session_tenant THEN
        RAISE EXCEPTION 'Tenant isolation violation on write for %', tg_table_name;
    END IF;

    IF tg_op = 'UPDATE' AND old.tenant_id::text IS DISTINCT FROM session_tenant THEN
        RAISE EXCEPTION 'Tenant isolation violation on update for %', tg_table_name;
    END IF;

    RETURN new;
END;
$$;

-- Note: Ensure current_tenant_text exists and is correctly implemented
-- The following function is already expected to exist from previous migrations
-- but provided here for reference.
CREATE OR REPLACE FUNCTION public.current_tenant_text()
RETURNS text
LANGUAGE sql
STABLE
AS $$
    SELECT coalesce(
        nullif(current_setting('app.tenant_id', true), ''),
        auth.uid()::text
    )
$$;
