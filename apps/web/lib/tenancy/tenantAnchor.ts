import type { SupabaseClient } from '@supabase/supabase-js';

export async function ensureTenantAnchor(
    client: SupabaseClient,
    input: {
        tenantId: string;
        label?: string | null;
        source?: string | null;
    },
): Promise<void> {
    const tenantId = input.tenantId.trim();
    if (!tenantId) {
        throw new Error('Cannot ensure tenant anchor without a tenant id.');
    }

    const existing = await client
        .from('tenants')
        .select('id')
        .eq('id', tenantId)
        .maybeSingle();

    if (existing.error) {
        throw new Error(`Failed to check tenant registry anchor: ${existing.error.message}`);
    }
    if (existing.data) {
        return;
    }

    const { error } = await client
        .from('tenants')
        .insert({
            id: tenantId,
            name: normalizeTenantName(input.label) ?? `VetIOS tenant ${tenantId.slice(0, 8)}`,
            settings: {
                source: input.source ?? 'vetios_runtime_tenant_anchor',
                tenant_model: 'v1_auth_user_id',
                created_for_fk_integrity: true,
            },
        });

    if (!error) {
        return;
    }

    if (error.code === '23505') {
        return;
    }

    if (error.code === '42501') {
        throw new Error(
            'Tenant registry row is missing and the server Supabase key cannot create it. ' +
            'Set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY in Vercel, or run the auth tenant backfill migration.',
        );
    }

    throw new Error(`Failed to create tenant registry anchor: ${error.message}`);
}

function normalizeTenantName(value: string | null | undefined): string | null {
    return typeof value === 'string' && value.trim().length > 0
        ? value.trim().slice(0, 120)
        : null;
}
