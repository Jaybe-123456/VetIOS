import type { User } from '@supabase/supabase-js';
import { sanitizeInternalPath } from '@/lib/site';

export const EMAIL_VERIFICATION_PENDING_AT_KEY = 'vetios_email_verification_pending_at';
export const EMAIL_VERIFICATION_VERIFIED_AT_KEY = 'vetios_email_verified_at';
export const EMAIL_VERIFICATION_SENT_AT_KEY = 'vetios_email_verification_sent_at';
export const EMAIL_VERIFICATION_SOURCE_KEY = 'vetios_email_verification_source';
export const EMAIL_VERIFICATION_RESEND_INTERVAL_MS = 60_000;

export interface EmailVerificationState {
    email: string | null;
    pendingAt: string | null;
    verifiedAt: string | null;
    sentAt: string | null;
    source: string | null;
    isVerified: boolean;
    requiresVerification: boolean;
}

export function isEmailVerificationEnforced(): boolean {
    return process.env.VETIOS_DEV_BYPASS !== 'true';
}

export function getEmailVerificationState(
    user: Pick<User, 'email' | 'user_metadata'> | null | undefined,
): EmailVerificationState {
    const metadata = asRecord(user?.user_metadata);
    const pendingAt = readString(metadata[EMAIL_VERIFICATION_PENDING_AT_KEY]);
    const verifiedAt = readString(metadata[EMAIL_VERIFICATION_VERIFIED_AT_KEY]);
    const sentAt = readString(metadata[EMAIL_VERIFICATION_SENT_AT_KEY]);
    const source = readString(metadata[EMAIL_VERIFICATION_SOURCE_KEY]);
    const isVerified = !pendingAt || isVerifiedForPendingWindow(pendingAt, verifiedAt);
    const requiresVerification = isEmailVerificationEnforced() && Boolean(pendingAt) && !isVerified;

    return {
        email: typeof user?.email === 'string' ? user.email : null,
        pendingAt,
        verifiedAt,
        sentAt,
        source,
        isVerified,
        requiresVerification,
    };
}

export function buildPendingEmailVerificationMetadata(
    currentMetadata: unknown,
    input: {
        nowIso?: string;
        source?: string | null;
    } = {},
): Record<string, unknown> {
    const metadata = asRecord(currentMetadata);
    const nowIso = input.nowIso ?? new Date().toISOString();
    const pendingAt = readString(metadata[EMAIL_VERIFICATION_PENDING_AT_KEY]) ?? nowIso;
    const { [EMAIL_VERIFICATION_VERIFIED_AT_KEY]: _verifiedAt, ...remainingMetadata } = metadata;

    return {
        ...remainingMetadata,
        [EMAIL_VERIFICATION_PENDING_AT_KEY]: pendingAt,
        [EMAIL_VERIFICATION_SENT_AT_KEY]: nowIso,
        [EMAIL_VERIFICATION_SOURCE_KEY]: input.source ?? readString(metadata[EMAIL_VERIFICATION_SOURCE_KEY]) ?? null,
    };
}

export function buildCompletedEmailVerificationMetadata(
    currentMetadata: unknown,
    verifiedAtIso = new Date().toISOString(),
): Record<string, unknown> {
    const metadata = asRecord(currentMetadata);

    return {
        ...metadata,
        [EMAIL_VERIFICATION_VERIFIED_AT_KEY]: verifiedAtIso,
    };
}

export function getEmailVerificationResendDelayMs(
    user: Pick<User, 'email' | 'user_metadata'> | null | undefined,
    nowMs = Date.now(),
): number {
    const state = getEmailVerificationState(user);
    if (!state.sentAt) {
        return 0;
    }

    const sentAtMs = Date.parse(state.sentAt);
    if (!Number.isFinite(sentAtMs)) {
        return 0;
    }

    return Math.max(0, EMAIL_VERIFICATION_RESEND_INTERVAL_MS - (nowMs - sentAtMs));
}

export function isLikelyFirstGoogleSignIn(
    user: Pick<User, 'app_metadata' | 'identities' | 'created_at' | 'last_sign_in_at' | 'email' | 'user_metadata'>,
): boolean {
    const verificationState = getEmailVerificationState(user);
    if (verificationState.pendingAt || verificationState.verifiedAt) {
        return false;
    }

    const providers = new Set<string>();
    const appMetadata = asRecord(user.app_metadata);
    const provider = readString(appMetadata.provider);
    if (provider) {
        providers.add(provider);
    }

    const rawProviders = appMetadata.providers;
    if (Array.isArray(rawProviders)) {
        for (const value of rawProviders) {
            if (typeof value === 'string' && value.trim()) {
                providers.add(value.trim().toLowerCase());
            }
        }
    }

    for (const identity of user.identities ?? []) {
        if (typeof identity?.provider === 'string' && identity.provider.trim()) {
            providers.add(identity.provider.trim().toLowerCase());
        }
    }

    if (!providers.has('google')) {
        return false;
    }

    const createdAtMs = Date.parse(user.created_at);
    const lastSignInAtMs = Date.parse(user.last_sign_in_at ?? '');
    if (!Number.isFinite(createdAtMs) || !Number.isFinite(lastSignInAtMs)) {
        return false;
    }

    return Math.abs(lastSignInAtMs - createdAtMs) <= 5 * 60_000;
}

export function buildVerifyEmailPath(nextPath?: string | null): string {
    const url = new URL('/verify-email', 'https://vetios.local');
    url.searchParams.set('next', sanitizeInternalPath(nextPath, '/inference'));
    return `${url.pathname}${url.search}`;
}

function isVerifiedForPendingWindow(pendingAt: string, verifiedAt: string | null): boolean {
    if (!verifiedAt) {
        return false;
    }

    const pendingAtMs = Date.parse(pendingAt);
    const verifiedAtMs = Date.parse(verifiedAt);
    if (!Number.isFinite(pendingAtMs) || !Number.isFinite(verifiedAtMs)) {
        return false;
    }

    return verifiedAtMs >= pendingAtMs;
}

function asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return {};
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
