import type { User } from '@supabase/supabase-js';
import {
    buildCompletedEmailVerificationMetadata,
    buildPendingEmailVerificationMetadata,
    EMAIL_VERIFICATION_PENDING_AT_KEY,
    EMAIL_VERIFICATION_SENT_AT_KEY,
    getEmailVerificationResendDelayMs,
    getEmailVerificationState,
} from '@/lib/auth/emailVerification';
import { buildConfiguredEmailVerificationCallbackUrl } from '@/lib/site';
import { getSupabasePublicServer, getSupabaseServer } from '@/lib/supabaseServer';

export async function beginUserEmailVerification(input: {
    userId: string;
    email: string;
    currentMetadata: unknown;
    source: string;
    nextPath?: string | null;
    fallbackOrigin?: string;
}): Promise<{
    pendingAt: string;
    sentAt: string;
}> {
    if (!input.userId.trim()) {
        throw new Error('Cannot start email verification without a user ID.');
    }
    if (!input.email.trim()) {
        throw new Error('Cannot start email verification without an email address.');
    }

    const nextMetadata = buildPendingEmailVerificationMetadata(input.currentMetadata, {
        source: input.source,
    });
    const pendingAt = readString(nextMetadata[EMAIL_VERIFICATION_PENDING_AT_KEY]) ?? new Date().toISOString();
    const sentAt = readString(nextMetadata[EMAIL_VERIFICATION_SENT_AT_KEY]) ?? new Date().toISOString();

    const { error: updateError } = await getSupabaseServer().auth.admin.updateUserById(input.userId, {
        user_metadata: nextMetadata,
    });

    if (updateError) {
        throw new Error(`Failed to mark email verification pending: ${updateError.message}`);
    }

    await sendEmailVerificationLink({
        email: input.email,
        nextPath: input.nextPath,
        fallbackOrigin: input.fallbackOrigin,
    });

    return {
        pendingAt,
        sentAt,
    };
}

export async function completeUserEmailVerification(input: {
    userId: string;
    currentMetadata: unknown;
}): Promise<void> {
    if (!input.userId.trim()) {
        throw new Error('Cannot complete email verification without a user ID.');
    }

    const nextMetadata = buildCompletedEmailVerificationMetadata(input.currentMetadata);
    const { error } = await getSupabaseServer().auth.admin.updateUserById(input.userId, {
        user_metadata: nextMetadata,
    });

    if (error) {
        throw new Error(`Failed to mark email as verified: ${error.message}`);
    }
}

export async function resendUserEmailVerification(input: {
    user: Pick<User, 'id' | 'email' | 'user_metadata'>;
    nextPath?: string | null;
    fallbackOrigin?: string;
}): Promise<{
    sentAt: string;
    retryAfterMs: number;
}> {
    if (!input.user.id.trim()) {
        throw new Error('Cannot resend email verification without a user ID.');
    }

    const retryAfterMs = getEmailVerificationResendDelayMs(input.user);
    if (retryAfterMs > 0) {
        return {
            sentAt: getEmailVerificationState(input.user).sentAt ?? new Date().toISOString(),
            retryAfterMs,
        };
    }

    const email = input.user.email?.trim().toLowerCase();
    if (!email) {
        throw new Error('No email address is available for this account.');
    }

    const nextMetadata = buildPendingEmailVerificationMetadata(input.user.user_metadata, {
        source: getEmailVerificationState(input.user).source ?? 'manual_resend',
    });

    const { error: updateError } = await getSupabaseServer().auth.admin.updateUserById(input.user.id, {
        user_metadata: nextMetadata,
    });

    if (updateError) {
        throw new Error(`Failed to update email verification metadata: ${updateError.message}`);
    }

    await sendEmailVerificationLink({
        email,
        nextPath: input.nextPath,
        fallbackOrigin: input.fallbackOrigin,
    });

    return {
        sentAt: readString(nextMetadata[EMAIL_VERIFICATION_SENT_AT_KEY]) ?? new Date().toISOString(),
        retryAfterMs: 0,
    };
}

async function sendEmailVerificationLink(input: {
    email: string;
    nextPath?: string | null;
    fallbackOrigin?: string;
}): Promise<void> {
    const redirectTo = buildConfiguredEmailVerificationCallbackUrl(
        input.nextPath,
        input.fallbackOrigin,
    );

    if (!redirectTo) {
        throw new Error('Unable to build email verification callback URL.');
    }

    const { error } = await getSupabasePublicServer().auth.signInWithOtp({
        email: input.email.trim().toLowerCase(),
        options: {
            shouldCreateUser: false,
            emailRedirectTo: redirectTo,
        },
    });

    if (error) {
        throw new Error(`Failed to send email verification link: ${error.message}`);
    }
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
