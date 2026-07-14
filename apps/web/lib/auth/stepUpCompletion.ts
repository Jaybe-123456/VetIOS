import type { SupabaseClient, User } from '@supabase/supabase-js';
import { type AuthTrustAssuranceLevel } from '@/lib/auth/authTrustFabric';
import { resolveUserAssuranceLevel } from '@/lib/auth/authTrustRouteGate';

export interface StepUpAssuranceSnapshot {
    assuranceLevel: AuthTrustAssuranceLevel;
    supabaseCurrentLevel: string | null;
    supabaseNextLevel: string | null;
    authenticationMethods: string[];
    source: 'supabase_mfa' | 'user_metadata' | 'session';
}

interface SupabaseMfaClient {
    getAuthenticatorAssuranceLevel?: () => Promise<{
        data?: {
            currentLevel?: string | null;
            nextLevel?: string | null;
            currentAuthenticationMethods?: unknown[];
        } | null;
        error?: { message?: string } | null;
    }>;
}

export async function resolveStepUpAssurance(input: {
    supabase: SupabaseClient;
    user: User | null;
}): Promise<StepUpAssuranceSnapshot> {
    const mfa = input.supabase.auth.mfa as SupabaseMfaClient;
    if (typeof mfa.getAuthenticatorAssuranceLevel === 'function') {
        try {
            const result = await mfa.getAuthenticatorAssuranceLevel();
            const currentLevel = normalizeText(result.data?.currentLevel);
            const nextLevel = normalizeText(result.data?.nextLevel);
            const methods = normalizeMethodList(result.data?.currentAuthenticationMethods);
            const supabaseAssurance = normalizeAssuranceText(currentLevel)
                ?? normalizeAssuranceFromMethods(methods);
            if (supabaseAssurance && supabaseAssurance !== 'session') {
                return {
                    assuranceLevel: supabaseAssurance,
                    supabaseCurrentLevel: currentLevel,
                    supabaseNextLevel: nextLevel,
                    authenticationMethods: methods,
                    source: 'supabase_mfa',
                };
            }
        } catch {
            // Fall back to signed user metadata. The route still fails closed if assurance is insufficient.
        }
    }

    const metadataAssurance = resolveUserAssuranceLevel(input.user);
    return {
        assuranceLevel: metadataAssurance,
        supabaseCurrentLevel: null,
        supabaseNextLevel: null,
        authenticationMethods: [],
        source: metadataAssurance === 'session' || metadataAssurance === 'anonymous' ? 'session' : 'user_metadata',
    };
}

export function normalizeAssuranceText(value: string | null | undefined): AuthTrustAssuranceLevel | null {
    const normalized = value?.trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === 'aal2' || normalized === 'mfa' || normalized === 'multi_factor') return 'mfa';
    if (normalized === 'aal3' || normalized === 'passkey' || normalized === 'webauthn') return 'passkey';
    if (normalized === 'recent_auth' || normalized === 'recent') return 'recent_auth';
    if (normalized === 'workload_identity') return 'workload_identity';
    if (normalized === 'aal1' || normalized === 'session') return 'session';
    return null;
}

function normalizeAssuranceFromMethods(methods: readonly string[]): AuthTrustAssuranceLevel | null {
    if (methods.some((method) => method === 'passkey' || method === 'webauthn')) return 'passkey';
    if (methods.some((method) => method === 'mfa' || method === 'otp' || method === 'totp')) return 'mfa';
    return null;
}

function normalizeMethodList(value: unknown): string[] {
    return Array.isArray(value)
        ? value
            .map((entry) => {
                if (typeof entry === 'string') return entry;
                if (entry && typeof entry === 'object' && 'method' in entry) {
                    const method = (entry as { method?: unknown }).method;
                    return typeof method === 'string' ? method : null;
                }
                return null;
            })
            .filter((entry): entry is string => Boolean(entry))
            .map((entry) => entry.trim().toLowerCase())
        : [];
}

function normalizeText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
