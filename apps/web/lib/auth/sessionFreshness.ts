import type { Session, User } from '@supabase/supabase-js';

const CLOCK_SKEW_MS = 5_000;

export type SessionFreshnessReason =
    | 'fresh'
    | 'no_password_change_marker'
    | 'missing_session'
    | 'missing_access_token_iat'
    | 'stale_after_password_change';

export interface SessionFreshnessResult {
    fresh: boolean;
    reason: SessionFreshnessReason;
    passwordChangedAt: string | null;
    sessionIssuedAt: string | null;
}

export function assessSessionFreshness(
    user: Pick<User, 'app_metadata'> | null | undefined,
    session: Pick<Session, 'access_token'> | null | undefined,
): SessionFreshnessResult {
    const passwordChangedAt = readPasswordChangedAt(user?.app_metadata);
    if (!passwordChangedAt) {
        return {
            fresh: true,
            reason: 'no_password_change_marker',
            passwordChangedAt: null,
            sessionIssuedAt: null,
        };
    }

    if (!session?.access_token) {
        return {
            fresh: false,
            reason: 'missing_session',
            passwordChangedAt: passwordChangedAt.toISOString(),
            sessionIssuedAt: null,
        };
    }

    const issuedAt = readJwtIssuedAt(session.access_token);
    if (!issuedAt) {
        return {
            fresh: false,
            reason: 'missing_access_token_iat',
            passwordChangedAt: passwordChangedAt.toISOString(),
            sessionIssuedAt: null,
        };
    }

    const stale = issuedAt.getTime() + CLOCK_SKEW_MS < passwordChangedAt.getTime();
    return {
        fresh: !stale,
        reason: stale ? 'stale_after_password_change' : 'fresh',
        passwordChangedAt: passwordChangedAt.toISOString(),
        sessionIssuedAt: issuedAt.toISOString(),
    };
}

export function readJwtIssuedAt(accessToken: string): Date | null {
    const parts = accessToken.split('.');
    if (parts.length < 2) return null;

    try {
        const payload = JSON.parse(Buffer.from(toBase64(parts[1]), 'base64').toString('utf8')) as Record<string, unknown>;
        const issuedAt = typeof payload.iat === 'number' ? payload.iat : Number(payload.iat);
        if (!Number.isFinite(issuedAt) || issuedAt <= 0) return null;
        return new Date(issuedAt * 1000);
    } catch {
        return null;
    }
}

function readPasswordChangedAt(appMetadata: User['app_metadata'] | null | undefined): Date | null {
    if (!appMetadata || typeof appMetadata !== 'object') return null;
    const value = readString(appMetadata.password_changed_at)
        ?? readString(appMetadata.passwordChangedAt);
    if (!value) return null;

    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function toBase64(value: string): string {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4;
    return padding === 0 ? normalized : `${normalized}${'='.repeat(4 - padding)}`;
}
