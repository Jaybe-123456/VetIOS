import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { runPartnerV1Route } from '@/lib/api/v1-route';
import { resolvePartnerOwnerTenantId } from '@/lib/api/partner-service';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
    createNotificationDelivery,
    createTimelineEntry,
} from '@/lib/petpass/service';
import { safeJson } from '@/lib/http/safeJson';

const PetPassSyncSchema = z.object({
    owner_account_id: z.string().uuid(),
    pet_id: z.string().uuid(),
    clinic_id: z.string().optional(),
    clinic_name: z.string().optional(),
    visit_date: z.string(),
    diagnoses: z.array(z.string()).optional().default([]),
    prescriptions: z.array(z.string()).optional().default([]),
    weight_kg: z.number().optional(),
    next_appointment: z.string().optional(),
    summary: z.string().optional(),
    channel: z.enum(['sms', 'email', 'push']).optional().default('email'),
    send_notification: z.boolean().optional().default(true),
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    return runPartnerV1Route(request, {
        endpoint: '/v1/petpass/sync',
        aggregateType: 'petpass_sync',
        handler: async (auth, req) => {
            const tenantId = resolvePartnerOwnerTenantId(auth.partner);
            if (!tenantId) {
                return NextResponse.json({ error: 'Partner is missing an owner tenant mapping.' }, { status: 400 });
            }

            const parsedJson = await safeJson(req);
            if (!parsedJson.ok) {
                return NextResponse.json({ error: parsedJson.error }, { status: 400 });
            }

            const parsed = PetPassSyncSchema.safeParse(parsedJson.data);
            if (!parsed.success) {
                return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
            }

            const body = parsed.data;
            const detailParts = [
                body.summary ?? null,
                body.diagnoses.length > 0 ? `Diagnoses: ${body.diagnoses.join(', ')}` : null,
                body.prescriptions.length > 0 ? `Prescriptions: ${body.prescriptions.join(', ')}` : null,
                body.weight_kg != null ? `Weight: ${body.weight_kg} kg` : null,
                body.next_appointment ? `Next appointment: ${body.next_appointment}` : null,
            ].filter((value): value is string => Boolean(value));

            const timeline = await createTimelineEntry(getSupabaseServer(), {
                tenantId,
                ownerAccountId: body.owner_account_id,
                petProfileId: body.pet_id,
                entryType: 'visit',
                title: 'Visit synced from partner API',
                detail: detailParts.join(' | ') || 'Visit details were synced through the VetIOS Developer API.',
                occurredAt: body.visit_date,
                visibility: 'owner_safe',
                sourceModule: 'developer_api',
                sourceRecordId: body.pet_id,
                metadata: {
                    clinic_id: body.clinic_id ?? null,
                    clinic_name: body.clinic_name ?? null,
                    diagnoses: body.diagnoses,
                    prescriptions: body.prescriptions,
                },
            });

            let notification = null;
            if (body.send_notification) {
                notification = await createNotificationDelivery(getSupabaseServer(), {
                    tenantId,
                    ownerAccountId: body.owner_account_id,
                    petProfileId: body.pet_id,
                    timelineEntryId: timeline.id,
                    channel: body.channel,
                    notificationType: 'visit_sync',
                    title: 'PetPass visit updated',
                    body: 'A new visit summary is now available in PetPass.',
                    deliveryStatus: body.channel === 'push' ? 'queued' : 'queued',
                    metadata: {
                        source: 'developer_api',
                    },
                });
            }

            return NextResponse.json({
                synced: true,
                timeline_entry_id: timeline.id,
                notification_delivery_id: notification?.id ?? null,
            }, { status: 201 });
        },
    });
}
