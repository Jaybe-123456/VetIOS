import type { SupabaseClient } from '@supabase/supabase-js';
import { enforceTenantRateLimit } from '@/lib/platform/rateLimit';
import type { GovernancePolicyRecord, GovernancePolicyRules, PlatformActor } from '@/lib/platform/types';

type GovernanceDecision =
    | { decision: 'allow'; policyId: string | null; reason: null; tokenCount: number; flagged: false }
    | { decision: 'flag'; policyId: string | null; reason: string; tokenCount: number; flagged: true }
    | { decision: 'block'; policyId: string | null; reason: string; tokenCount: number; flagged: false };

type CachedPolicy = {
    expiresAtMs: number;
    policy: GovernancePolicyRecord | null;
};

declare global {
    // eslint-disable-next-line no-var
    var __vetiosGovernancePolicyCache: Map<string, CachedPolicy> | undefined;
}

const POLICY_CACHE_TTL_MS = 30_000;

function getPolicyCache() {
    if (!globalThis.__vetiosGovernancePolicyCache) {
        globalThis.__vetiosGovernancePolicyCache = new Map<string, CachedPolicy>();
    }

    return globalThis.__vetiosGovernancePolicyCache;
}

export async function getActiveGovernancePolicy(
    client: SupabaseClient,
    tenantId: string,
) {
    const cache = getPolicyCache();
    const cached = cache.get(tenantId);
    if (cached && cached.expiresAtMs > Date.now()) {
        return cached.policy;
    }

    const { data, error } = await client
        .from('governance_policies')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to load active governance policy: ${error.message}`);
    }

    const policy = (data ?? null) as GovernancePolicyRecord | null;
    cache.set(tenantId, {
        policy,
        expiresAtMs: Date.now() + POLICY_CACHE_TTL_MS,
    });

    return policy;
}

export function invalidateGovernancePolicyCache(tenantId: string) {
    getPolicyCache().delete(tenantId);
}

export async function createGovernancePolicy(
    client: SupabaseClient,
    input: {
        tenantId: string;
        actor: string | null;
        name: string;
        rules: GovernancePolicyRules;
        metadata?: Record<string, unknown>;
    },
) {
    const { data, error } = await client
        .from('governance_policies')
        .insert({
            tenant_id: input.tenantId,
            name: input.name.trim() || 'Tenant policy',
            status: 'draft',
            rules: input.rules,
            metadata: input.metadata ?? {},
            created_by: input.actor,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to create governance policy: ${error?.message ?? 'Unknown error'}`);
    }

    await writeGovernanceAuditEvent(client, {
        tenantId: input.tenantId,
        eventType: 'policy_updated',
        actor: input.actor,
        payload: {
            policy_id: (data as Record<string, unknown>).id ?? null,
            status: 'draft',
            rules: input.rules,
        },
    });

    return data as GovernancePolicyRecord;
}

export async function activateGovernancePolicy(
    client: SupabaseClient,
    input: {
        tenantId: string;
        policyId: string;
        actor: string | null;
    },
) {
    const { data: targetPolicy, error: targetError } = await client
        .from('governance_policies')
        .select('*')
        .eq('tenant_id', input.tenantId)
        .eq('id', input.policyId)
        .maybeSingle();

    if (targetError) {
        throw new Error(`Failed to load governance policy: ${targetError.message}`);
    }

    if (!targetPolicy) {
        throw new Error('Governance policy was not found for this tenant.');
    }

    const { data: existingActive, error: activeError } = await client
        .from('governance_policies')
        .select('id')
        .eq('tenant_id', input.tenantId)
        .eq('status', 'active')
        .maybeSingle();

    if (activeError) {
        throw new Error(`Failed to load current active governance policy: ${activeError.message}`);
    }

    if (existingActive?.id && existingActive.id !== input.policyId) {
        const { error: archiveError } = await client
            .from('governance_policies')
            .update({
                status: 'archived',
                archived_at: new Date().toISOString(),
            })
            .eq('tenant_id', input.tenantId)
            .eq('id', existingActive.id);

        if (archiveError) {
            throw new Error(`Failed to archive previous governance policy: ${archiveError.message}`);
        }
    }

    const { data, error } = await client
        .from('governance_policies')
        .update({
            status: 'active',
            activated_at: new Date().toISOString(),
            archived_at: null,
        })
        .eq('tenant_id', input.tenantId)
        .eq('id', input.policyId)
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to activate governance policy: ${error?.message ?? 'Unknown error'}`);
    }

    invalidateGovernancePolicyCache(input.tenantId);

    await writeGovernanceAuditEvent(client, {
        tenantId: input.tenantId,
        eventType: 'policy_updated',
        actor: input.actor,
        payload: {
            policy_id: input.policyId,
            previous_policy_id: existingActive?.id ?? null,
            status: 'active',
        },
    });

    return data as GovernancePolicyRecord;
}

export async function listGovernancePolicies(
    client: SupabaseClient,
    tenantId: string,
) {
    const { data, error } = await client
        .from('governance_policies')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

    if (error) {
        throw new Error(`Failed to list governance policies: ${error.message}`);
    }

    return (data ?? []) as GovernancePolicyRecord[];
}

export async function writeGovernanceAuditEvent(
    client: SupabaseClient,
    input: {
        tenantId: string;
        eventType: 'policy_updated' | 'policy_applied' | 'request_blocked' | 'request_flagged' | 'model_version_changed' | 'governance_override';
        actor: string | null;
        payload: Record<string, unknown>;
    },
) {
    const { data, error } = await client
        .from('audit_log')
        .insert({
            tenant_id: input.tenantId,
            event_type: input.eventType,
            actor: input.actor,
            payload: input.payload,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to append governance audit event: ${error?.message ?? 'Unknown error'}`);
    }

    return data;
}

export async function listGovernanceAuditEvents(
    client: SupabaseClient,
    input: {
        tenantId: string | null;
        actor: PlatformActor;
        cursor?: string | null;
        limit?: number;
    },
) {
    const limit = Math.max(1, Math.min(input.limit ?? 25, 100));
    let query = client
        .from('audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit + 1);

    if (input.actor.role !== 'system_admin') {
        query = query.eq('tenant_id', input.actor.tenantId);
    } else if (input.tenantId) {
        query = query.eq('tenant_id', input.tenantId);
    }

    const decodedCursor = decodeCursor(input.cursor);
    if (decodedCursor) {
        query = query.lt('created_at', decodedCursor.createdAt);
    }

    const { data, error } = await query;
    if (error) {
        throw new Error(`Failed to list governance audit log: ${error.message}`);
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const lastRow = pageRows.at(-1);

    return {
        rows: pageRows,
        nextCursor: hasMore && lastRow
            ? encodeCursor(String(lastRow.created_at), String(lastRow.id))
            : null,
    };
}

export async function evaluateGovernancePolicyForInference(
    client: SupabaseClient,
    input: {
        actor: PlatformActor;
        tenantId: string;
        requestBody: Record<string, unknown>;
    },
): Promise<GovernanceDecision> {
    const policy = await getActiveGovernancePolicy(client, input.tenantId);
    if (!policy) {
        return {
            decision: 'allow',
            policyId: null,
            reason: null,
            tokenCount: estimateTokenCount(input.requestBody),
            flagged: false,
        };
    }

    const tokenCount = estimateTokenCount(input.requestBody);
    const rules = policy.rules ?? {};
    const requestedModelVersion = readRequestedModelVersion(input.requestBody);
    const promptText = readPromptText(input.requestBody);

    if (Array.isArray(rules.allowed_model_versions) && rules.allowed_model_versions.length > 0) {
        if (!requestedModelVersion || !rules.allowed_model_versions.includes(requestedModelVersion)) {
            const reason = `Model version ${requestedModelVersion ?? 'unknown'} is not allowed by policy.`;
            await writeGovernanceAuditEvent(client, {
                tenantId: input.tenantId,
                eventType: 'request_blocked',
                actor: input.actor.userId,
                payload: {
                    policy_id: policy.id,
                    reason,
                    model_version: requestedModelVersion,
                },
            });
            return {
                decision: 'block',
                policyId: policy.id,
                reason,
                tokenCount,
                flagged: false,
            };
        }
    }

    if (Array.isArray(rules.blocked_model_versions) && rules.blocked_model_versions.length > 0) {
        if (requestedModelVersion && rules.blocked_model_versions.includes(requestedModelVersion)) {
            const reason = `Model version ${requestedModelVersion} is blocked by governance policy.`;
            await writeGovernanceAuditEvent(client, {
                tenantId: input.tenantId,
                eventType: 'request_blocked',
                actor: input.actor.userId,
                payload: {
                    policy_id: policy.id,
                    reason,
                    model_version: requestedModelVersion,
                },
            });
            return {
                decision: 'block',
                policyId: policy.id,
                reason,
                tokenCount,
                flagged: false,
            };
        }
    }

    if (Array.isArray(rules.blocked_prompt_patterns) && promptText) {
        const matchedPattern = rules.blocked_prompt_patterns.find((pattern) => {
            try {
                return new RegExp(pattern, 'i').test(promptText);
            } catch {
                return false;
            }
        });

        if (matchedPattern) {
            const reason = `Prompt matched blocked policy pattern ${matchedPattern}.`;
            await writeGovernanceAuditEvent(client, {
                tenantId: input.tenantId,
                eventType: 'request_blocked',
                actor: input.actor.userId,
                payload: {
                    policy_id: policy.id,
                    reason,
                    pattern: matchedPattern,
                },
            });
            return {
                decision: 'block',
                policyId: policy.id,
                reason,
                tokenCount,
                flagged: false,
            };
        }
    }

    if (typeof rules.max_requests_per_minute === 'number' && rules.max_requests_per_minute > 0) {
        const rateLimitResult = await enforceTenantRateLimit(
            client,
            input.tenantId,
            'inference',
            rules.max_requests_per_minute,
        );
        if (!rateLimitResult.allowed) {
            const reason = `Tenant exceeded governance request rate limit (${rules.max_requests_per_minute}/min).`;
            await writeGovernanceAuditEvent(client, {
                tenantId: input.tenantId,
                eventType: 'request_blocked',
                actor: input.actor.userId,
                payload: {
                    policy_id: policy.id,
                    reason,
                    retry_after_seconds: rateLimitResult.retryAfterSeconds,
                },
            });
            return {
                decision: 'block',
                policyId: policy.id,
                reason,
                tokenCount,
                flagged: false,
            };
        }
    }

    if (typeof rules.max_token_limit === 'number' && rules.max_token_limit > 0) {
        if (tokenCount > rules.max_token_limit) {
            const reason = `Request exceeded the tenant token limit (${rules.max_token_limit}).`;
            await writeGovernanceAuditEvent(client, {
                tenantId: input.tenantId,
                eventType: 'request_blocked',
                actor: input.actor.userId,
                payload: {
                    policy_id: policy.id,
                    reason,
                    token_count: tokenCount,
                },
            });
            return {
                decision: 'block',
                policyId: policy.id,
                reason,
                tokenCount,
                flagged: false,
            };
        }

        if (tokenCount >= rules.max_token_limit * 0.9) {
            const reason = `Request is approaching the tenant token limit (${tokenCount}/${rules.max_token_limit}).`;
            await writeGovernanceAuditEvent(client, {
                tenantId: input.tenantId,
                eventType: 'request_flagged',
                actor: input.actor.userId,
                payload: {
                    policy_id: policy.id,
                    reason,
                    token_count: tokenCount,
                },
            });
            return {
                decision: 'flag',
                policyId: policy.id,
                reason,
                tokenCount,
                flagged: true,
            };
        }
    }

    await writeGovernanceAuditEvent(client, {
        tenantId: input.tenantId,
        eventType: 'policy_applied',
        actor: input.actor.userId,
        payload: {
            policy_id: policy.id,
            model_version: requestedModelVersion,
            token_count: tokenCount,
        },
    });

    return {
        decision: 'allow',
        policyId: policy.id,
        reason: null,
        tokenCount,
        flagged: false,
    };
}

function estimateTokenCount(payload: Record<string, unknown>) {
    const raw = JSON.stringify(payload);
    return Math.max(1, Math.ceil(raw.length / 4));
}

function readRequestedModelVersion(payload: Record<string, unknown>) {
    const model = payload.model;
    if (typeof model === 'object' && model !== null && !Array.isArray(model)) {
        const version = (model as Record<string, unknown>).version;
        return typeof version === 'string' && version.trim().length > 0 ? version.trim() : null;
    }

    return null;
}

function readPromptText(payload: Record<string, unknown>) {
    const input = payload.input;
    if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
        const inputSignature = (input as Record<string, unknown>).input_signature;
        if (typeof inputSignature === 'object' && inputSignature !== null && !Array.isArray(inputSignature)) {
            const metadata = (inputSignature as Record<string, unknown>).metadata;
            if (typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)) {
                const rawNote = (metadata as Record<string, unknown>).raw_note;
                if (typeof rawNote === 'string' && rawNote.trim().length > 0) {
                    return rawNote.trim();
                }
            }
        }
    }

    return JSON.stringify(payload);
}

function encodeCursor(createdAt: string, id: string) {
    return Buffer.from(JSON.stringify({ createdAt, id }), 'utf8').toString('base64url');
}

function decodeCursor(value: string | null | undefined) {
    if (!value) {
        return null;
    }

    try {
        const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
            createdAt?: string;
            id?: string;
        };

        if (!parsed.createdAt || !parsed.id) {
            return null;
        }

        return {
            createdAt: parsed.createdAt,
            id: parsed.id,
        };
    } catch {
        return null;
    }
}
