/**
 * @vetios/db — Multi-Tenant Helpers
 *
 * Utilities for enforcing tenant isolation at the application layer.
 * These complement RLS policies by ensuring tenant_id is always set
 * in the PostgreSQL session context before queries execute.
 */

import type { TypedSupabaseClient } from './client';

/**
 * Sets the tenant context for the current database session.
 * This is used by RLS policies that reference `current_setting('app.tenant_id')`.
 *
 * Must be called at the beginning of every server-side request handler
 * that interacts with tenant-scoped data.
 */
export async function setTenantContext(
    client: TypedSupabaseClient,
    tenantId: string,
): Promise<void> {
    const { error } = await client.rpc('set_tenant_context' as never, {
        tenant_id: tenantId,
    } as never);

    if (error) {
        throw new Error(`Failed to set tenant context: ${error.message}`);
    }
}

/**
 * Validates that a tenant_id is a well-formed UUID.
 * Prevents injection of malformed values into the session context.
 */
export function validateTenantId(tenantId: unknown): tenantId is string {
    if (typeof tenantId !== 'string') return false;
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return UUID_REGEX.test(tenantId);
}

/**
 * Extracts tenant_id from a request header.
 * The middleware layer is responsible for injecting this header
 * after validating the user's JWT claims.
 */
export function getTenantIdFromHeaders(headers: Headers): string {
    const tenantId = headers.get('x-tenant-id');

    if (!tenantId || !validateTenantId(tenantId)) {
        throw new Error('Missing or invalid x-tenant-id header.');
    }

    return tenantId;
}
