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

const RESEND_API_URL = 'https://api.resend.com/emails';

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

    const customTransportSent = await trySendEmailVerificationViaResend({
        email: input.email,
        redirectTo,
    });
    if (customTransportSent) {
        return;
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

async function trySendEmailVerificationViaResend(input: {
    email: string;
    redirectTo: string;
}): Promise<boolean> {
    const apiKey = normalizeOptionalText(process.env.RESEND_API_KEY);
    const from = normalizeOptionalText(process.env.VETIOS_EMAIL_FROM);
    const replyTo = normalizeOptionalText(process.env.VETIOS_EMAIL_REPLY_TO);

    if (!apiKey || !from) {
        return false;
    }

    const normalizedEmail = input.email.trim().toLowerCase();
    const { data, error } = await getSupabaseServer().auth.admin.generateLink({
        type: 'magiclink',
        email: normalizedEmail,
        options: {
            redirectTo: input.redirectTo,
        },
    });

    if (error) {
        throw new Error(`Failed to generate custom verification link: ${error.message}`);
    }

    const tokenHash = readString(data?.properties?.hashed_token);
    if (!tokenHash) {
        throw new Error('Supabase did not return an email verification token hash.');
    }
    const callbackUrl = buildVerificationCallbackUrl(input.redirectTo, tokenHash);

    const response = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            from,
            to: [normalizedEmail],
            ...(replyTo ? { reply_to: replyTo } : {}),
            subject: 'Verify your VetIOS email',
            text: buildVerificationEmailText(callbackUrl),
            html: buildVerificationEmailHtml(callbackUrl),
        }),
    }).catch((error: unknown) => ({
        ok: false,
        status: 503,
        text: async () => (error instanceof Error ? error.message : 'Verification email request failed.'),
    }));

    if (response.ok) {
        return true;
    }

    const responseText = await response.text();
    throw new Error(
        `Failed to send verification email via Resend: ${extractEmailProviderError(responseText, response.status)}`,
    );
}

function buildVerificationCallbackUrl(baseCallbackUrl: string, tokenHash: string): string {
    const callbackUrl = new URL(baseCallbackUrl);
    callbackUrl.searchParams.set('token_hash', tokenHash);
    callbackUrl.searchParams.set('type', 'email');
    return callbackUrl.toString();
}

function buildVerificationEmailText(callbackUrl: string): string {
    return [
        'Verify your VetIOS email',
        '',
        'Open the link below to confirm your inbox and unlock access:',
        callbackUrl,
        '',
        'If you did not request this, you can ignore this email.',
    ].join('\n');
}

function buildVerificationEmailHtml(callbackUrl: string): string {
    return [
        '<div style="background:#0B0F14;color:#E8EDF2;padding:32px;font-family:Inter,Arial,sans-serif;">',
        '<div style="max-width:560px;margin:0 auto;border:1px solid rgba(255,255,255,0.1);border-radius:24px;background:rgba(255,255,255,0.03);padding:32px;">',
        '<div style="font-size:12px;letter-spacing:0.24em;text-transform:uppercase;color:rgba(232,237,242,0.55);">VetIOS</div>',
        '<h1 style="margin:16px 0 12px;font-size:28px;line-height:1.1;color:#FFFFFF;">Verify your email</h1>',
        '<p style="margin:0 0 24px;font-size:16px;line-height:1.7;color:rgba(232,237,242,0.72);">',
        'Confirm your inbox to unlock your VetIOS account.',
        '</p>',
        `<a href="${escapeHtml(callbackUrl)}" style="display:inline-block;background:#E8EDF2;color:#0B0F14;padding:14px 20px;border-radius:999px;text-decoration:none;font-weight:600;">Verify email</a>`,
        '<p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:rgba(232,237,242,0.5);">',
        'If the button does not work, copy and paste this link into your browser:',
        '</p>',
        `<p style="margin:12px 0 0;font-size:13px;line-height:1.7;word-break:break-all;color:#7CFF4E;">${escapeHtml(callbackUrl)}</p>`,
        '</div>',
        '</div>',
    ].join('');
}

function extractEmailProviderError(responseText: string, status: number): string {
    try {
        const parsed = JSON.parse(responseText) as Record<string, unknown>;
        const message = readString(parsed.message) ?? readString(parsed.error) ?? readString(parsed.name);
        if (message) {
            return `${message} (status ${status})`;
        }
    } catch {
        // ignore malformed provider payloads
    }

    return responseText.trim() || `status ${status}`;
}

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function normalizeOptionalText(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
