import type { SupabaseClient } from '@supabase/supabase-js';
import {
    getNotificationDelivery,
    getOwnerAccount,
    updateNotificationDeliveryStatus,
    type OwnerAccountRecord,
    type PetPassNotificationDeliveryRecord,
} from '@/lib/petpass/service';

type JsonRecord = Record<string, unknown>;

export interface PetPassDeliveryDispatchResult {
    status: 'succeeded' | 'retryable' | 'dead_letter';
    responsePayload?: JsonRecord;
    errorMessage?: string | null;
}

export async function dispatchPetPassNotificationDelivery(
    client: SupabaseClient,
    input: {
        tenantId: string;
        notificationDeliveryId: string;
    },
): Promise<PetPassDeliveryDispatchResult> {
    const delivery = await getNotificationDelivery(client, input.tenantId, input.notificationDeliveryId);
    if (!delivery) {
        return {
            status: 'dead_letter',
            errorMessage: 'PetPass notification delivery was not found.',
        };
    }

    if (delivery.delivery_status === 'sent') {
        return {
            status: 'succeeded',
            responsePayload: {
                provider: 'already_sent',
                channel: delivery.channel,
                notification_delivery_id: delivery.id,
            },
        };
    }

    const owner = await getOwnerAccount(client, input.tenantId, delivery.owner_account_id);
    if (!owner) {
        await updateNotificationDeliveryStatus(client, {
            tenantId: input.tenantId,
            deliveryId: delivery.id,
            deliveryStatus: 'failed',
            errorMessage: 'PetPass owner account was not found for this notification delivery.',
        });
        return {
            status: 'dead_letter',
            errorMessage: 'PetPass owner account was not found for this notification delivery.',
        };
    }

    const dispatchResult = delivery.channel === 'email'
        ? await sendPetPassEmail(delivery, owner)
        : delivery.channel === 'sms'
            ? await sendPetPassSms(delivery, owner)
            : {
                status: 'dead_letter' as const,
                errorMessage: 'Push delivery is not configured yet for PetPass. Use email or sms.',
                responsePayload: {
                    channel: delivery.channel,
                },
            };

    if (dispatchResult.status === 'succeeded') {
        await updateNotificationDeliveryStatus(client, {
            tenantId: input.tenantId,
            deliveryId: delivery.id,
            deliveryStatus: 'sent',
            deliveredAt: new Date().toISOString(),
            errorMessage: null,
        });
        return dispatchResult;
    }

    if (dispatchResult.status === 'retryable') {
        await updateNotificationDeliveryStatus(client, {
            tenantId: input.tenantId,
            deliveryId: delivery.id,
            deliveryStatus: 'queued',
            errorMessage: dispatchResult.errorMessage ?? 'PetPass notification delivery is waiting for a retry.',
        });
        return dispatchResult;
    }

    await updateNotificationDeliveryStatus(client, {
        tenantId: input.tenantId,
        deliveryId: delivery.id,
        deliveryStatus: 'failed',
        errorMessage: dispatchResult.errorMessage ?? 'PetPass notification delivery failed.',
    });
    return dispatchResult;
}

async function sendPetPassEmail(
    delivery: PetPassNotificationDeliveryRecord,
    owner: OwnerAccountRecord,
): Promise<PetPassDeliveryDispatchResult> {
    const to = normalizeOptionalText(owner.email);
    if (!to) {
        return {
            status: 'dead_letter',
            errorMessage: 'The selected owner account does not have an email address for PetPass delivery.',
        };
    }

    const apiKey = normalizeOptionalText(process.env.RESEND_API_KEY);
    const from = normalizeOptionalText(process.env.PETPASS_EMAIL_FROM)
        ?? normalizeOptionalText(process.env.VETIOS_EMAIL_FROM);
    const replyTo = normalizeOptionalText(process.env.PETPASS_EMAIL_REPLY_TO)
        ?? normalizeOptionalText(process.env.VETIOS_EMAIL_REPLY_TO);
    if (!apiKey || !from) {
        return {
            status: 'dead_letter',
            errorMessage: 'Email delivery is not configured. Set RESEND_API_KEY and PETPASS_EMAIL_FROM.',
        };
    }

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            from,
            to: [to],
            ...(replyTo ? { reply_to: replyTo } : {}),
            subject: delivery.title,
            text: buildEmailText(delivery, owner),
        }),
    }).catch((error: unknown) => ({
        ok: false,
        status: 503,
        text: async () => (error instanceof Error ? error.message : 'Email delivery request failed.'),
    }));

    const responseText = await response.text();
    const responsePayload = parseJsonRecord(responseText);
    if (response.ok) {
        return {
            status: 'succeeded',
            responsePayload: {
                provider: 'resend',
                channel: 'email',
                to,
                message_id: readString(responsePayload?.id) ?? null,
            },
        };
    }

    return {
        status: isRetryableStatus(response.status) ? 'retryable' : 'dead_letter',
        errorMessage: extractProviderError(responsePayload, responseText, `Email delivery failed with status ${response.status}.`),
        responsePayload: {
            provider: 'resend',
            channel: 'email',
            to,
            status_code: response.status,
        },
    };
}

async function sendPetPassSms(
    delivery: PetPassNotificationDeliveryRecord,
    owner: OwnerAccountRecord,
): Promise<PetPassDeliveryDispatchResult> {
    const to = normalizePhoneForSms(owner.phone);
    if (!to) {
        return {
            status: 'dead_letter',
            errorMessage: 'The selected owner account needs a valid SMS phone number in E.164 format or PETPASS_DEFAULT_COUNTRY_CODE configured.',
        };
    }

    const accountSid = normalizeOptionalText(process.env.TWILIO_ACCOUNT_SID);
    const authToken = normalizeOptionalText(process.env.TWILIO_AUTH_TOKEN);
    const messagingServiceSid = normalizeOptionalText(process.env.TWILIO_MESSAGING_SERVICE_SID);
    const fromNumber = normalizeOptionalText(process.env.TWILIO_FROM_NUMBER);

    if (!accountSid || !authToken || (!messagingServiceSid && !fromNumber)) {
        return {
            status: 'dead_letter',
            errorMessage: 'SMS delivery is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID.',
        };
    }

    const form = new URLSearchParams();
    form.set('To', to);
    form.set('Body', buildSmsBody(delivery));
    if (messagingServiceSid) {
        form.set('MessagingServiceSid', messagingServiceSid);
    } else if (fromNumber) {
        form.set('From', fromNumber);
    }

    const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
            authorization: `Basic ${basicAuth}`,
            'content-type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
    }).catch((error: unknown) => ({
        ok: false,
        status: 503,
        text: async () => (error instanceof Error ? error.message : 'SMS delivery request failed.'),
    }));

    const responseText = await response.text();
    const responsePayload = parseJsonRecord(responseText);
    if (response.ok) {
        return {
            status: 'succeeded',
            responsePayload: {
                provider: 'twilio',
                channel: 'sms',
                to,
                message_sid: readString(responsePayload?.sid) ?? null,
                status: readString(responsePayload?.status) ?? null,
            },
        };
    }

    return {
        status: isRetryableStatus(response.status) ? 'retryable' : 'dead_letter',
        errorMessage: extractProviderError(responsePayload, responseText, `SMS delivery failed with status ${response.status}.`),
        responsePayload: {
            provider: 'twilio',
            channel: 'sms',
            to,
            status_code: response.status,
        },
    };
}

function buildEmailText(
    delivery: PetPassNotificationDeliveryRecord,
    owner: OwnerAccountRecord,
): string {
    const greetingName = owner.preferred_name ?? owner.full_name;
    return [
        `Hello ${greetingName},`,
        '',
        delivery.title,
        delivery.body,
        '',
        'Sent by VetIOS PetPass.',
    ].join('\n');
}

function buildSmsBody(delivery: PetPassNotificationDeliveryRecord): string {
    return truncateText(`${delivery.title}: ${delivery.body}`, 640) ?? delivery.title;
}

function normalizePhoneForSms(value: string | null): string | null {
    const normalized = normalizeOptionalText(value);
    if (!normalized) {
        return null;
    }

    if (normalized.startsWith('+')) {
        const digits = normalized.slice(1).replace(/\D/g, '');
        return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
    }

    const digits = normalized.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) {
        return null;
    }

    const defaultCountryCode = normalizeCountryCode(process.env.PETPASS_DEFAULT_COUNTRY_CODE);
    if (!defaultCountryCode) {
        return null;
    }

    const countryDigits = defaultCountryCode.slice(1);
    if (digits.startsWith(countryDigits)) {
        return `+${digits}`;
    }

    if (digits.startsWith('0')) {
        return `+${countryDigits}${digits.replace(/^0+/, '')}`;
    }

    return `+${countryDigits}${digits}`;
}

function normalizeCountryCode(value: string | undefined): string | null {
    const normalized = normalizeOptionalText(value);
    if (!normalized) {
        return null;
    }

    const digits = normalized.replace(/\D/g, '');
    return digits.length > 0 ? `+${digits}` : null;
}

function extractProviderError(
    payload: JsonRecord | null,
    rawText: string,
    fallback: string,
): string {
    return readString(payload?.message)
        ?? readString(payload?.error)
        ?? readString(payload?.name)
        ?? truncateText(rawText.trim(), 500)
        ?? fallback;
}

function parseJsonRecord(value: string): JsonRecord | null {
    if (!value || value.trim().length === 0) {
        return null;
    }

    try {
        const parsed = JSON.parse(value) as unknown;
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
            ? parsed as JsonRecord
            : null;
    } catch {
        return null;
    }
}

function isRetryableStatus(status: number): boolean {
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function normalizeOptionalText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function truncateText(value: string, maxLength: number): string | null {
    if (value.length === 0) {
        return null;
    }

    return value.length <= maxLength
        ? value
        : `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
