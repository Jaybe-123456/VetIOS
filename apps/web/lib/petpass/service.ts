import type { SupabaseClient } from '@supabase/supabase-js';
import {
    CLINIC_OWNER_LINKS,
    OWNER_ACCOUNTS,
    OWNER_PET_LINKS,
    PETPASS_CONSENTS,
    PETPASS_NOTIFICATION_DELIVERIES,
    PETPASS_NOTIFICATION_PREFERENCES,
    PETPASS_PET_PROFILES,
    PETPASS_TIMELINE_ENTRIES,
} from '@/lib/db/schemaContracts';
import {
    petPassPreview,
    type PetPassAlert,
    type PetPassPreviewData,
    type PetPassProfile,
    type PetPassTimelineItem,
} from '@/lib/platform/petpassPreview';
import { resolvePublicCatalogTenant, type PublicCatalogSource } from '@/lib/platform/publicTenant';
import { getSupabaseServer } from '@/lib/supabaseServer';

export type OwnerAccountStatus = 'invited' | 'active' | 'inactive';
export type OwnerPetLinkStatus = 'invited' | 'active' | 'inactive';
export type ClinicOwnerLinkStatus = 'invited' | 'active' | 'paused' | 'revoked';
export type PetPassRiskState = 'stable' | 'watch' | 'urgent';
export type PetPassConsentStatus = 'pending' | 'granted' | 'revoked';
export type PetPassChannel = 'sms' | 'email' | 'push';
export type PetPassEntryType = 'visit' | 'result' | 'medication' | 'alert' | 'message' | 'referral';
export type PetPassVisibility = 'owner_safe' | 'internal';
export type PetPassDeliveryStatus = 'queued' | 'sent' | 'failed' | 'canceled';

export interface OwnerAccountRecord {
    id: string;
    tenant_id: string;
    external_owner_ref: string | null;
    full_name: string;
    preferred_name: string | null;
    email: string | null;
    phone: string | null;
    status: OwnerAccountStatus;
    metadata: Record<string, unknown>;
    created_by: string | null;
    last_active_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface PetPassPetProfileRecord {
    id: string;
    tenant_id: string;
    patient_id: string | null;
    pet_name: string;
    species: string | null;
    breed: string | null;
    age_display: string | null;
    sex: string | null;
    risk_state: PetPassRiskState;
    clinic_id: string | null;
    clinic_name: string | null;
    latest_case_id: string | null;
    latest_episode_id: string | null;
    metadata: Record<string, unknown>;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface OwnerPetLinkRecord {
    id: string;
    tenant_id: string;
    owner_account_id: string;
    pet_profile_id: string;
    relationship_type: string;
    primary_owner: boolean;
    status: OwnerPetLinkStatus;
    linked_at: string;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}

export interface ClinicOwnerLinkRecord {
    id: string;
    tenant_id: string;
    owner_account_id: string;
    clinic_id: string | null;
    clinic_name: string;
    status: ClinicOwnerLinkStatus;
    invite_token: string | null;
    invite_expires_at: string | null;
    linked_by: string | null;
    linked_at: string;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}

export interface PetPassConsentRecord {
    id: string;
    tenant_id: string;
    owner_account_id: string;
    pet_profile_id: string | null;
    consent_type: string;
    status: PetPassConsentStatus;
    granted_at: string | null;
    revoked_at: string | null;
    expires_at: string | null;
    metadata: Record<string, unknown>;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface PetPassNotificationPreferenceRecord {
    id: string;
    tenant_id: string;
    owner_account_id: string;
    pet_profile_id: string | null;
    channel: PetPassChannel;
    notification_type: string;
    enabled: boolean;
    quiet_hours: Record<string, unknown>;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}

export interface PetPassTimelineEntryRecord {
    id: string;
    tenant_id: string;
    owner_account_id: string | null;
    pet_profile_id: string;
    clinic_owner_link_id: string | null;
    entry_type: PetPassEntryType;
    title: string;
    detail: string;
    occurred_at: string;
    visibility: PetPassVisibility;
    source_module: string | null;
    source_record_id: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
}

export interface PetPassNotificationDeliveryRecord {
    id: string;
    tenant_id: string;
    owner_account_id: string;
    pet_profile_id: string | null;
    timeline_entry_id: string | null;
    channel: PetPassChannel;
    notification_type: string;
    title: string;
    body: string;
    delivery_status: PetPassDeliveryStatus;
    scheduled_at: string;
    delivered_at: string | null;
    error_message: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}

export interface PetPassControlPlaneSnapshot {
    tenant_id: string;
    owners: OwnerAccountRecord[];
    pet_profiles: PetPassPetProfileRecord[];
    owner_pet_links: OwnerPetLinkRecord[];
    clinic_owner_links: ClinicOwnerLinkRecord[];
    consents: PetPassConsentRecord[];
    notification_preferences: PetPassNotificationPreferenceRecord[];
    timeline_entries: PetPassTimelineEntryRecord[];
    notification_deliveries: PetPassNotificationDeliveryRecord[];
    summary: {
        owner_accounts: number;
        linked_pets: number;
        clinic_links: number;
        granted_consents: number;
        active_alerts: number;
        queued_notifications: number;
        sent_notifications: number;
    };
    refreshed_at: string;
}

export interface PublicPetPassSnapshot extends PetPassPreviewData {
    configured: boolean;
    source: PublicCatalogSource;
    tenant_id: string | null;
    data_mode: 'live' | 'preview' | 'unconfigured';
    network_summary: {
        owner_accounts: number;
        linked_pets: number;
        clinic_links: number;
        granted_consents: number;
        active_alerts: number;
        queued_notifications: number;
        sent_notifications: number;
    };
}

export async function getPetPassControlPlaneSnapshot(
    client: SupabaseClient,
    tenantId: string,
    options: { limit?: number } = {},
): Promise<PetPassControlPlaneSnapshot> {
    const limit = options.limit ?? 24;
    const [
        owners,
        petProfiles,
        ownerPetLinks,
        clinicOwnerLinks,
        consents,
        notificationPreferences,
        timelineEntries,
        notificationDeliveries,
    ] = await Promise.all([
        listOwnerAccounts(client, tenantId, limit),
        listPetProfiles(client, tenantId, limit),
        listOwnerPetLinks(client, tenantId, limit),
        listClinicOwnerLinks(client, tenantId, limit),
        listConsents(client, tenantId, limit),
        listNotificationPreferences(client, tenantId, limit),
        listTimelineEntries(client, tenantId, limit),
        listNotificationDeliveries(client, tenantId, limit),
    ]);

    return {
        tenant_id: tenantId,
        owners,
        pet_profiles: petProfiles,
        owner_pet_links: ownerPetLinks,
        clinic_owner_links: clinicOwnerLinks,
        consents,
        notification_preferences: notificationPreferences,
        timeline_entries: timelineEntries,
        notification_deliveries: notificationDeliveries,
        summary: {
            owner_accounts: owners.length,
            linked_pets: uniqueStrings(ownerPetLinks.map((link) => link.pet_profile_id)).length,
            clinic_links: clinicOwnerLinks.length,
            granted_consents: consents.filter((consent) => consent.status === 'granted').length,
            active_alerts: timelineEntries.filter((entry) => entry.entry_type === 'alert').length,
            queued_notifications: notificationDeliveries.filter((delivery) => delivery.delivery_status === 'queued').length,
            sent_notifications: notificationDeliveries.filter((delivery) => delivery.delivery_status === 'sent').length,
        },
        refreshed_at: new Date().toISOString(),
    };
}

export async function getPublicPetPassSnapshot(): Promise<PublicPetPassSnapshot> {
    const target = await resolvePublicCatalogTenant();
    if (!target.tenantId) {
        return {
            configured: false,
            source: target.source,
            tenant_id: null,
            data_mode: 'unconfigured',
            network_summary: createEmptyNetworkSummary(),
            ...petPassPreview,
        };
    }

    const snapshot = await getPetPassControlPlaneSnapshot(getSupabaseServer(), target.tenantId, { limit: 12 });
    const owner = snapshot.owners[0] ?? null;
    const pet = snapshot.pet_profiles[0] ?? null;
    const clinicLink = owner ? snapshot.clinic_owner_links.find((link) => link.owner_account_id === owner.id) ?? null : null;

    if (!pet || snapshot.owner_pet_links.length === 0) {
        return {
            configured: true,
            source: target.source,
            tenant_id: target.tenantId,
            data_mode: 'preview',
            network_summary: snapshot.summary,
            ...petPassPreview,
        };
    }

    const profile: PetPassProfile = {
        pet_name: pet.pet_name,
        species: pet.species ?? petPassPreview.profile.species,
        breed: pet.breed ?? petPassPreview.profile.breed,
        age_display: pet.age_display ?? petPassPreview.profile.age_display,
        clinic_name: pet.clinic_name ?? clinicLink?.clinic_name ?? petPassPreview.profile.clinic_name,
        risk_state: pet.risk_state,
    };

    const alerts = toPublicAlerts(snapshot.notification_deliveries, snapshot.timeline_entries);
    const timeline = snapshot.timeline_entries
        .filter((entry) => entry.visibility === 'owner_safe')
        .slice(0, 6)
        .map(mapTimelineEntryToPreview);

    return {
        configured: true,
        source: target.source,
        tenant_id: target.tenantId,
        data_mode: 'live',
        network_summary: snapshot.summary,
        profile,
        alerts: alerts.length > 0 ? alerts : petPassPreview.alerts,
        timeline: timeline.length > 0 ? timeline : petPassPreview.timeline,
        features: [
            {
                title: 'Owner health history',
                summary: 'Clinic-approved timeline entries are now backed by PetPass timeline storage rather than a static preview.',
                readiness: 'preview',
            },
            {
                title: 'Actionable alerts',
                summary: 'Alert deliveries now have real queue and delivery records, with owner-channel preferences per pet or account.',
                readiness: 'preview',
            },
            {
                title: 'Clinic sync',
                summary: 'Clinic-owner links, consents, and owner-pet links now exist as real network infrastructure, even before full mobile distribution.',
                readiness: 'preview',
            },
        ],
    };
}

export async function createOwnerAccount(
    client: SupabaseClient,
    input: {
        tenantId: string;
        actor: string | null;
        fullName: string;
        preferredName?: string | null;
        email?: string | null;
        phone?: string | null;
        externalOwnerRef?: string | null;
        status?: OwnerAccountStatus;
        metadata?: Record<string, unknown>;
    },
): Promise<OwnerAccountRecord> {
    const { data, error } = await client
        .from(OWNER_ACCOUNTS.TABLE)
        .insert({
            [OWNER_ACCOUNTS.COLUMNS.tenant_id]: input.tenantId,
            [OWNER_ACCOUNTS.COLUMNS.full_name]: input.fullName,
            [OWNER_ACCOUNTS.COLUMNS.preferred_name]: input.preferredName ?? null,
            [OWNER_ACCOUNTS.COLUMNS.email]: input.email ?? null,
            [OWNER_ACCOUNTS.COLUMNS.phone]: input.phone ?? null,
            [OWNER_ACCOUNTS.COLUMNS.external_owner_ref]: input.externalOwnerRef ?? null,
            [OWNER_ACCOUNTS.COLUMNS.status]: input.status ?? 'active',
            [OWNER_ACCOUNTS.COLUMNS.metadata]: input.metadata ?? {},
            [OWNER_ACCOUNTS.COLUMNS.created_by]: input.actor,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to create owner account: ${error?.message ?? 'Unknown error'}`);
    }

    return mapOwnerAccount(asRecord(data));
}

export async function createPetProfile(
    client: SupabaseClient,
    input: {
        tenantId: string;
        actor: string | null;
        petName: string;
        species?: string | null;
        breed?: string | null;
        ageDisplay?: string | null;
        sex?: string | null;
        riskState?: PetPassRiskState;
        clinicId?: string | null;
        clinicName?: string | null;
        patientId?: string | null;
        latestCaseId?: string | null;
        latestEpisodeId?: string | null;
        metadata?: Record<string, unknown>;
    },
): Promise<PetPassPetProfileRecord> {
    const { data, error } = await client
        .from(PETPASS_PET_PROFILES.TABLE)
        .insert({
            [PETPASS_PET_PROFILES.COLUMNS.tenant_id]: input.tenantId,
            [PETPASS_PET_PROFILES.COLUMNS.pet_name]: input.petName,
            [PETPASS_PET_PROFILES.COLUMNS.species]: input.species ?? null,
            [PETPASS_PET_PROFILES.COLUMNS.breed]: input.breed ?? null,
            [PETPASS_PET_PROFILES.COLUMNS.age_display]: input.ageDisplay ?? null,
            [PETPASS_PET_PROFILES.COLUMNS.sex]: input.sex ?? null,
            [PETPASS_PET_PROFILES.COLUMNS.risk_state]: input.riskState ?? 'stable',
            [PETPASS_PET_PROFILES.COLUMNS.clinic_id]: input.clinicId ?? null,
            [PETPASS_PET_PROFILES.COLUMNS.clinic_name]: input.clinicName ?? null,
            [PETPASS_PET_PROFILES.COLUMNS.patient_id]: input.patientId ?? null,
            [PETPASS_PET_PROFILES.COLUMNS.latest_case_id]: input.latestCaseId ?? null,
            [PETPASS_PET_PROFILES.COLUMNS.latest_episode_id]: input.latestEpisodeId ?? null,
            [PETPASS_PET_PROFILES.COLUMNS.metadata]: input.metadata ?? {},
            [PETPASS_PET_PROFILES.COLUMNS.created_by]: input.actor,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to create pet profile: ${error?.message ?? 'Unknown error'}`);
    }

    return mapPetProfile(asRecord(data));
}

export async function linkOwnerToPet(
    client: SupabaseClient,
    input: {
        tenantId: string;
        ownerAccountId: string;
        petProfileId: string;
        relationshipType?: string;
        primaryOwner?: boolean;
        status?: OwnerPetLinkStatus;
        metadata?: Record<string, unknown>;
    },
): Promise<OwnerPetLinkRecord> {
    const payload = {
        [OWNER_PET_LINKS.COLUMNS.tenant_id]: input.tenantId,
        [OWNER_PET_LINKS.COLUMNS.owner_account_id]: input.ownerAccountId,
        [OWNER_PET_LINKS.COLUMNS.pet_profile_id]: input.petProfileId,
        [OWNER_PET_LINKS.COLUMNS.relationship_type]: input.relationshipType ?? 'owner',
        [OWNER_PET_LINKS.COLUMNS.primary_owner]: input.primaryOwner ?? true,
        [OWNER_PET_LINKS.COLUMNS.status]: input.status ?? 'active',
        [OWNER_PET_LINKS.COLUMNS.metadata]: input.metadata ?? {},
    };

    const { data, error } = await client
        .from(OWNER_PET_LINKS.TABLE)
        .upsert(payload, {
            onConflict: `${OWNER_PET_LINKS.COLUMNS.tenant_id},${OWNER_PET_LINKS.COLUMNS.owner_account_id},${OWNER_PET_LINKS.COLUMNS.pet_profile_id}`,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to link owner to pet: ${error?.message ?? 'Unknown error'}`);
    }

    return mapOwnerPetLink(asRecord(data));
}

export async function createClinicOwnerLink(
    client: SupabaseClient,
    input: {
        tenantId: string;
        ownerAccountId: string;
        clinicName: string;
        clinicId?: string | null;
        linkedBy?: string | null;
        status?: ClinicOwnerLinkStatus;
        inviteToken?: string | null;
        inviteExpiresAt?: string | null;
        metadata?: Record<string, unknown>;
    },
): Promise<ClinicOwnerLinkRecord> {
    const { data, error } = await client
        .from(CLINIC_OWNER_LINKS.TABLE)
        .insert({
            [CLINIC_OWNER_LINKS.COLUMNS.tenant_id]: input.tenantId,
            [CLINIC_OWNER_LINKS.COLUMNS.owner_account_id]: input.ownerAccountId,
            [CLINIC_OWNER_LINKS.COLUMNS.clinic_name]: input.clinicName,
            [CLINIC_OWNER_LINKS.COLUMNS.clinic_id]: input.clinicId ?? null,
            [CLINIC_OWNER_LINKS.COLUMNS.status]: input.status ?? 'active',
            [CLINIC_OWNER_LINKS.COLUMNS.invite_token]: input.inviteToken ?? null,
            [CLINIC_OWNER_LINKS.COLUMNS.invite_expires_at]: input.inviteExpiresAt ?? null,
            [CLINIC_OWNER_LINKS.COLUMNS.linked_by]: input.linkedBy ?? null,
            [CLINIC_OWNER_LINKS.COLUMNS.metadata]: input.metadata ?? {},
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to create clinic-owner link: ${error?.message ?? 'Unknown error'}`);
    }

    return mapClinicOwnerLink(asRecord(data));
}

export async function recordConsent(
    client: SupabaseClient,
    input: {
        tenantId: string;
        actor: string | null;
        ownerAccountId: string;
        petProfileId?: string | null;
        consentType: string;
        status?: PetPassConsentStatus;
        grantedAt?: string | null;
        revokedAt?: string | null;
        expiresAt?: string | null;
        metadata?: Record<string, unknown>;
    },
): Promise<PetPassConsentRecord> {
    const now = new Date().toISOString();
    const status = input.status ?? 'granted';
    const { data, error } = await client
        .from(PETPASS_CONSENTS.TABLE)
        .insert({
            [PETPASS_CONSENTS.COLUMNS.tenant_id]: input.tenantId,
            [PETPASS_CONSENTS.COLUMNS.owner_account_id]: input.ownerAccountId,
            [PETPASS_CONSENTS.COLUMNS.pet_profile_id]: input.petProfileId ?? null,
            [PETPASS_CONSENTS.COLUMNS.consent_type]: input.consentType,
            [PETPASS_CONSENTS.COLUMNS.status]: status,
            [PETPASS_CONSENTS.COLUMNS.granted_at]: status === 'granted' ? (input.grantedAt ?? now) : null,
            [PETPASS_CONSENTS.COLUMNS.revoked_at]: status === 'revoked' ? (input.revokedAt ?? now) : null,
            [PETPASS_CONSENTS.COLUMNS.expires_at]: input.expiresAt ?? null,
            [PETPASS_CONSENTS.COLUMNS.metadata]: input.metadata ?? {},
            [PETPASS_CONSENTS.COLUMNS.created_by]: input.actor,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to record PetPass consent: ${error?.message ?? 'Unknown error'}`);
    }

    return mapConsent(asRecord(data));
}

export async function upsertNotificationPreference(
    client: SupabaseClient,
    input: {
        tenantId: string;
        ownerAccountId: string;
        petProfileId?: string | null;
        channel: PetPassChannel;
        notificationType: string;
        enabled?: boolean;
        quietHours?: Record<string, unknown>;
        metadata?: Record<string, unknown>;
    },
): Promise<PetPassNotificationPreferenceRecord> {
    const payload = {
        [PETPASS_NOTIFICATION_PREFERENCES.COLUMNS.tenant_id]: input.tenantId,
        [PETPASS_NOTIFICATION_PREFERENCES.COLUMNS.owner_account_id]: input.ownerAccountId,
        [PETPASS_NOTIFICATION_PREFERENCES.COLUMNS.pet_profile_id]: input.petProfileId ?? null,
        [PETPASS_NOTIFICATION_PREFERENCES.COLUMNS.channel]: input.channel,
        [PETPASS_NOTIFICATION_PREFERENCES.COLUMNS.notification_type]: input.notificationType,
        [PETPASS_NOTIFICATION_PREFERENCES.COLUMNS.enabled]: input.enabled ?? true,
        [PETPASS_NOTIFICATION_PREFERENCES.COLUMNS.quiet_hours]: input.quietHours ?? {},
        [PETPASS_NOTIFICATION_PREFERENCES.COLUMNS.metadata]: input.metadata ?? {},
    };

    const { data, error } = await client
        .from(PETPASS_NOTIFICATION_PREFERENCES.TABLE)
        .upsert(payload, {
            onConflict: `${PETPASS_NOTIFICATION_PREFERENCES.COLUMNS.tenant_id},${PETPASS_NOTIFICATION_PREFERENCES.COLUMNS.owner_account_id},${PETPASS_NOTIFICATION_PREFERENCES.COLUMNS.pet_profile_id},${PETPASS_NOTIFICATION_PREFERENCES.COLUMNS.channel},${PETPASS_NOTIFICATION_PREFERENCES.COLUMNS.notification_type}`,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to upsert PetPass notification preference: ${error?.message ?? 'Unknown error'}`);
    }

    return mapNotificationPreference(asRecord(data));
}

export async function createTimelineEntry(
    client: SupabaseClient,
    input: {
        tenantId: string;
        ownerAccountId?: string | null;
        petProfileId: string;
        clinicOwnerLinkId?: string | null;
        entryType: PetPassEntryType;
        title: string;
        detail: string;
        occurredAt?: string | null;
        visibility?: PetPassVisibility;
        sourceModule?: string | null;
        sourceRecordId?: string | null;
        metadata?: Record<string, unknown>;
    },
): Promise<PetPassTimelineEntryRecord> {
    const { data, error } = await client
        .from(PETPASS_TIMELINE_ENTRIES.TABLE)
        .insert({
            [PETPASS_TIMELINE_ENTRIES.COLUMNS.tenant_id]: input.tenantId,
            [PETPASS_TIMELINE_ENTRIES.COLUMNS.owner_account_id]: input.ownerAccountId ?? null,
            [PETPASS_TIMELINE_ENTRIES.COLUMNS.pet_profile_id]: input.petProfileId,
            [PETPASS_TIMELINE_ENTRIES.COLUMNS.clinic_owner_link_id]: input.clinicOwnerLinkId ?? null,
            [PETPASS_TIMELINE_ENTRIES.COLUMNS.entry_type]: input.entryType,
            [PETPASS_TIMELINE_ENTRIES.COLUMNS.title]: input.title,
            [PETPASS_TIMELINE_ENTRIES.COLUMNS.detail]: input.detail,
            [PETPASS_TIMELINE_ENTRIES.COLUMNS.occurred_at]: input.occurredAt ?? new Date().toISOString(),
            [PETPASS_TIMELINE_ENTRIES.COLUMNS.visibility]: input.visibility ?? 'owner_safe',
            [PETPASS_TIMELINE_ENTRIES.COLUMNS.source_module]: input.sourceModule ?? null,
            [PETPASS_TIMELINE_ENTRIES.COLUMNS.source_record_id]: input.sourceRecordId ?? null,
            [PETPASS_TIMELINE_ENTRIES.COLUMNS.metadata]: input.metadata ?? {},
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to create PetPass timeline entry: ${error?.message ?? 'Unknown error'}`);
    }

    return mapTimelineEntry(asRecord(data));
}

export async function createNotificationDelivery(
    client: SupabaseClient,
    input: {
        tenantId: string;
        ownerAccountId: string;
        petProfileId?: string | null;
        timelineEntryId?: string | null;
        channel: PetPassChannel;
        notificationType: string;
        title: string;
        body: string;
        deliveryStatus?: PetPassDeliveryStatus;
        scheduledAt?: string | null;
        deliveredAt?: string | null;
        errorMessage?: string | null;
        metadata?: Record<string, unknown>;
    },
): Promise<PetPassNotificationDeliveryRecord> {
    const { data, error } = await client
        .from(PETPASS_NOTIFICATION_DELIVERIES.TABLE)
        .insert({
            [PETPASS_NOTIFICATION_DELIVERIES.COLUMNS.tenant_id]: input.tenantId,
            [PETPASS_NOTIFICATION_DELIVERIES.COLUMNS.owner_account_id]: input.ownerAccountId,
            [PETPASS_NOTIFICATION_DELIVERIES.COLUMNS.pet_profile_id]: input.petProfileId ?? null,
            [PETPASS_NOTIFICATION_DELIVERIES.COLUMNS.timeline_entry_id]: input.timelineEntryId ?? null,
            [PETPASS_NOTIFICATION_DELIVERIES.COLUMNS.channel]: input.channel,
            [PETPASS_NOTIFICATION_DELIVERIES.COLUMNS.notification_type]: input.notificationType,
            [PETPASS_NOTIFICATION_DELIVERIES.COLUMNS.title]: input.title,
            [PETPASS_NOTIFICATION_DELIVERIES.COLUMNS.body]: input.body,
            [PETPASS_NOTIFICATION_DELIVERIES.COLUMNS.delivery_status]: input.deliveryStatus ?? 'queued',
            [PETPASS_NOTIFICATION_DELIVERIES.COLUMNS.scheduled_at]: input.scheduledAt ?? new Date().toISOString(),
            [PETPASS_NOTIFICATION_DELIVERIES.COLUMNS.delivered_at]: input.deliveredAt ?? null,
            [PETPASS_NOTIFICATION_DELIVERIES.COLUMNS.error_message]: input.errorMessage ?? null,
            [PETPASS_NOTIFICATION_DELIVERIES.COLUMNS.metadata]: input.metadata ?? {},
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to create PetPass notification delivery: ${error?.message ?? 'Unknown error'}`);
    }

    return mapNotificationDelivery(asRecord(data));
}

export async function getOwnerAccount(
    client: SupabaseClient,
    tenantId: string,
    ownerAccountId: string,
): Promise<OwnerAccountRecord | null> {
    const { data, error } = await client
        .from(OWNER_ACCOUNTS.TABLE)
        .select('*')
        .eq(OWNER_ACCOUNTS.COLUMNS.tenant_id, tenantId)
        .eq(OWNER_ACCOUNTS.COLUMNS.id, ownerAccountId)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to load owner account: ${error.message}`);
    }

    return data ? mapOwnerAccount(asRecord(data)) : null;
}

export async function getNotificationDelivery(
    client: SupabaseClient,
    tenantId: string,
    deliveryId: string,
): Promise<PetPassNotificationDeliveryRecord | null> {
    const { data, error } = await client
        .from(PETPASS_NOTIFICATION_DELIVERIES.TABLE)
        .select('*')
        .eq(PETPASS_NOTIFICATION_DELIVERIES.COLUMNS.tenant_id, tenantId)
        .eq(PETPASS_NOTIFICATION_DELIVERIES.COLUMNS.id, deliveryId)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to load PetPass notification delivery: ${error.message}`);
    }

    return data ? mapNotificationDelivery(asRecord(data)) : null;
}

export async function updateNotificationDeliveryStatus(
    client: SupabaseClient,
    input: {
        tenantId: string;
        deliveryId: string;
        deliveryStatus: PetPassDeliveryStatus;
        deliveredAt?: string | null;
        errorMessage?: string | null;
    },
): Promise<PetPassNotificationDeliveryRecord> {
    const C = PETPASS_NOTIFICATION_DELIVERIES.COLUMNS;
    const { data, error } = await client
        .from(PETPASS_NOTIFICATION_DELIVERIES.TABLE)
        .update({
            [C.delivery_status]: input.deliveryStatus,
            [C.delivered_at]: input.deliveryStatus === 'sent'
                ? normalizeOptionalText(input.deliveredAt) ?? new Date().toISOString()
                : null,
            [C.error_message]: normalizeOptionalText(input.errorMessage),
        })
        .eq(C.tenant_id, input.tenantId)
        .eq(C.id, input.deliveryId)
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to update PetPass notification delivery: ${error?.message ?? 'Unknown error'}`);
    }

    return mapNotificationDelivery(asRecord(data));
}

async function listOwnerAccounts(
    client: SupabaseClient,
    tenantId: string,
    limit: number,
): Promise<OwnerAccountRecord[]> {
    const { data, error } = await client
        .from(OWNER_ACCOUNTS.TABLE)
        .select('*')
        .eq(OWNER_ACCOUNTS.COLUMNS.tenant_id, tenantId)
        .order(OWNER_ACCOUNTS.COLUMNS.updated_at, { ascending: false })
        .limit(limit);

    if (error) {
        throw new Error(`Failed to list owner accounts: ${error.message}`);
    }

    return (data ?? []).map((row) => mapOwnerAccount(asRecord(row)));
}

async function listPetProfiles(
    client: SupabaseClient,
    tenantId: string,
    limit: number,
): Promise<PetPassPetProfileRecord[]> {
    const { data, error } = await client
        .from(PETPASS_PET_PROFILES.TABLE)
        .select('*')
        .eq(PETPASS_PET_PROFILES.COLUMNS.tenant_id, tenantId)
        .order(PETPASS_PET_PROFILES.COLUMNS.updated_at, { ascending: false })
        .limit(limit);

    if (error) {
        throw new Error(`Failed to list PetPass pet profiles: ${error.message}`);
    }

    return (data ?? []).map((row) => mapPetProfile(asRecord(row)));
}

async function listOwnerPetLinks(
    client: SupabaseClient,
    tenantId: string,
    limit: number,
): Promise<OwnerPetLinkRecord[]> {
    const { data, error } = await client
        .from(OWNER_PET_LINKS.TABLE)
        .select('*')
        .eq(OWNER_PET_LINKS.COLUMNS.tenant_id, tenantId)
        .order(OWNER_PET_LINKS.COLUMNS.updated_at, { ascending: false })
        .limit(limit);

    if (error) {
        throw new Error(`Failed to list owner-pet links: ${error.message}`);
    }

    return (data ?? []).map((row) => mapOwnerPetLink(asRecord(row)));
}

async function listClinicOwnerLinks(
    client: SupabaseClient,
    tenantId: string,
    limit: number,
): Promise<ClinicOwnerLinkRecord[]> {
    const { data, error } = await client
        .from(CLINIC_OWNER_LINKS.TABLE)
        .select('*')
        .eq(CLINIC_OWNER_LINKS.COLUMNS.tenant_id, tenantId)
        .order(CLINIC_OWNER_LINKS.COLUMNS.updated_at, { ascending: false })
        .limit(limit);

    if (error) {
        throw new Error(`Failed to list clinic-owner links: ${error.message}`);
    }

    return (data ?? []).map((row) => mapClinicOwnerLink(asRecord(row)));
}

async function listConsents(
    client: SupabaseClient,
    tenantId: string,
    limit: number,
): Promise<PetPassConsentRecord[]> {
    const { data, error } = await client
        .from(PETPASS_CONSENTS.TABLE)
        .select('*')
        .eq(PETPASS_CONSENTS.COLUMNS.tenant_id, tenantId)
        .order(PETPASS_CONSENTS.COLUMNS.updated_at, { ascending: false })
        .limit(limit);

    if (error) {
        throw new Error(`Failed to list PetPass consents: ${error.message}`);
    }

    return (data ?? []).map((row) => mapConsent(asRecord(row)));
}

async function listNotificationPreferences(
    client: SupabaseClient,
    tenantId: string,
    limit: number,
): Promise<PetPassNotificationPreferenceRecord[]> {
    const { data, error } = await client
        .from(PETPASS_NOTIFICATION_PREFERENCES.TABLE)
        .select('*')
        .eq(PETPASS_NOTIFICATION_PREFERENCES.COLUMNS.tenant_id, tenantId)
        .order(PETPASS_NOTIFICATION_PREFERENCES.COLUMNS.updated_at, { ascending: false })
        .limit(limit);

    if (error) {
        throw new Error(`Failed to list PetPass notification preferences: ${error.message}`);
    }

    return (data ?? []).map((row) => mapNotificationPreference(asRecord(row)));
}

async function listTimelineEntries(
    client: SupabaseClient,
    tenantId: string,
    limit: number,
): Promise<PetPassTimelineEntryRecord[]> {
    const { data, error } = await client
        .from(PETPASS_TIMELINE_ENTRIES.TABLE)
        .select('*')
        .eq(PETPASS_TIMELINE_ENTRIES.COLUMNS.tenant_id, tenantId)
        .order(PETPASS_TIMELINE_ENTRIES.COLUMNS.occurred_at, { ascending: false })
        .limit(limit);

    if (error) {
        throw new Error(`Failed to list PetPass timeline entries: ${error.message}`);
    }

    return (data ?? []).map((row) => mapTimelineEntry(asRecord(row)));
}

async function listNotificationDeliveries(
    client: SupabaseClient,
    tenantId: string,
    limit: number,
): Promise<PetPassNotificationDeliveryRecord[]> {
    const { data, error } = await client
        .from(PETPASS_NOTIFICATION_DELIVERIES.TABLE)
        .select('*')
        .eq(PETPASS_NOTIFICATION_DELIVERIES.COLUMNS.tenant_id, tenantId)
        .order(PETPASS_NOTIFICATION_DELIVERIES.COLUMNS.scheduled_at, { ascending: false })
        .limit(limit);

    if (error) {
        throw new Error(`Failed to list PetPass notification deliveries: ${error.message}`);
    }

    return (data ?? []).map((row) => mapNotificationDelivery(asRecord(row)));
}

function mapOwnerAccount(row: Record<string, unknown>): OwnerAccountRecord {
    return {
        id: String(row.id),
        tenant_id: readString(row.tenant_id) ?? 'unknown_tenant',
        external_owner_ref: readString(row.external_owner_ref),
        full_name: readString(row.full_name) ?? 'Unknown owner',
        preferred_name: readString(row.preferred_name),
        email: readString(row.email),
        phone: readString(row.phone),
        status: (readString(row.status) ?? 'active') as OwnerAccountStatus,
        metadata: asRecord(row.metadata),
        created_by: readString(row.created_by),
        last_active_at: readString(row.last_active_at),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at ?? row.created_at),
    };
}

function mapPetProfile(row: Record<string, unknown>): PetPassPetProfileRecord {
    return {
        id: String(row.id),
        tenant_id: readString(row.tenant_id) ?? 'unknown_tenant',
        patient_id: readString(row.patient_id),
        pet_name: readString(row.pet_name) ?? 'Unknown pet',
        species: readString(row.species),
        breed: readString(row.breed),
        age_display: readString(row.age_display),
        sex: readString(row.sex),
        risk_state: (readString(row.risk_state) ?? 'stable') as PetPassRiskState,
        clinic_id: readString(row.clinic_id),
        clinic_name: readString(row.clinic_name),
        latest_case_id: readString(row.latest_case_id),
        latest_episode_id: readString(row.latest_episode_id),
        metadata: asRecord(row.metadata),
        created_by: readString(row.created_by),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at ?? row.created_at),
    };
}

function mapOwnerPetLink(row: Record<string, unknown>): OwnerPetLinkRecord {
    return {
        id: String(row.id),
        tenant_id: readString(row.tenant_id) ?? 'unknown_tenant',
        owner_account_id: readString(row.owner_account_id) ?? 'unknown_owner',
        pet_profile_id: readString(row.pet_profile_id) ?? 'unknown_pet',
        relationship_type: readString(row.relationship_type) ?? 'owner',
        primary_owner: row.primary_owner === true,
        status: (readString(row.status) ?? 'active') as OwnerPetLinkStatus,
        linked_at: String(row.linked_at ?? row.created_at),
        metadata: asRecord(row.metadata),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at ?? row.created_at),
    };
}

function mapClinicOwnerLink(row: Record<string, unknown>): ClinicOwnerLinkRecord {
    return {
        id: String(row.id),
        tenant_id: readString(row.tenant_id) ?? 'unknown_tenant',
        owner_account_id: readString(row.owner_account_id) ?? 'unknown_owner',
        clinic_id: readString(row.clinic_id),
        clinic_name: readString(row.clinic_name) ?? 'Unknown clinic',
        status: (readString(row.status) ?? 'active') as ClinicOwnerLinkStatus,
        invite_token: readString(row.invite_token),
        invite_expires_at: readString(row.invite_expires_at),
        linked_by: readString(row.linked_by),
        linked_at: String(row.linked_at ?? row.created_at),
        metadata: asRecord(row.metadata),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at ?? row.created_at),
    };
}

function mapConsent(row: Record<string, unknown>): PetPassConsentRecord {
    return {
        id: String(row.id),
        tenant_id: readString(row.tenant_id) ?? 'unknown_tenant',
        owner_account_id: readString(row.owner_account_id) ?? 'unknown_owner',
        pet_profile_id: readString(row.pet_profile_id),
        consent_type: readString(row.consent_type) ?? 'general',
        status: (readString(row.status) ?? 'granted') as PetPassConsentStatus,
        granted_at: readString(row.granted_at),
        revoked_at: readString(row.revoked_at),
        expires_at: readString(row.expires_at),
        metadata: asRecord(row.metadata),
        created_by: readString(row.created_by),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at ?? row.created_at),
    };
}

function mapNotificationPreference(row: Record<string, unknown>): PetPassNotificationPreferenceRecord {
    return {
        id: String(row.id),
        tenant_id: readString(row.tenant_id) ?? 'unknown_tenant',
        owner_account_id: readString(row.owner_account_id) ?? 'unknown_owner',
        pet_profile_id: readString(row.pet_profile_id),
        channel: (readString(row.channel) ?? 'push') as PetPassChannel,
        notification_type: readString(row.notification_type) ?? 'general_update',
        enabled: row.enabled !== false,
        quiet_hours: asRecord(row.quiet_hours),
        metadata: asRecord(row.metadata),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at ?? row.created_at),
    };
}

function mapTimelineEntry(row: Record<string, unknown>): PetPassTimelineEntryRecord {
    return {
        id: String(row.id),
        tenant_id: readString(row.tenant_id) ?? 'unknown_tenant',
        owner_account_id: readString(row.owner_account_id),
        pet_profile_id: readString(row.pet_profile_id) ?? 'unknown_pet',
        clinic_owner_link_id: readString(row.clinic_owner_link_id),
        entry_type: (readString(row.entry_type) ?? 'visit') as PetPassEntryType,
        title: readString(row.title) ?? 'Timeline event',
        detail: readString(row.detail) ?? '',
        occurred_at: String(row.occurred_at ?? row.created_at),
        visibility: (readString(row.visibility) ?? 'owner_safe') as PetPassVisibility,
        source_module: readString(row.source_module),
        source_record_id: readString(row.source_record_id),
        metadata: asRecord(row.metadata),
        created_at: String(row.created_at),
    };
}

function mapNotificationDelivery(row: Record<string, unknown>): PetPassNotificationDeliveryRecord {
    return {
        id: String(row.id),
        tenant_id: readString(row.tenant_id) ?? 'unknown_tenant',
        owner_account_id: readString(row.owner_account_id) ?? 'unknown_owner',
        pet_profile_id: readString(row.pet_profile_id),
        timeline_entry_id: readString(row.timeline_entry_id),
        channel: (readString(row.channel) ?? 'push') as PetPassChannel,
        notification_type: readString(row.notification_type) ?? 'general_update',
        title: readString(row.title) ?? 'Notification',
        body: readString(row.body) ?? '',
        delivery_status: (readString(row.delivery_status) ?? 'queued') as PetPassDeliveryStatus,
        scheduled_at: String(row.scheduled_at ?? row.created_at),
        delivered_at: readString(row.delivered_at),
        error_message: readString(row.error_message),
        metadata: asRecord(row.metadata),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at ?? row.created_at),
    };
}

function toPublicAlerts(
    deliveries: PetPassNotificationDeliveryRecord[],
    timelineEntries: PetPassTimelineEntryRecord[],
): PetPassAlert[] {
    const alertsFromTimeline = timelineEntries
        .filter((entry) => entry.entry_type === 'alert' && entry.visibility === 'owner_safe')
        .slice(0, 3)
        .map((entry, index) => ({
            id: `timeline-${entry.id}`,
            title: entry.title,
            severity: inferAlertSeverity(entry.title, entry.detail),
            detail: entry.detail,
            action: extractActionLabel(entry.metadata, index),
        }));

    if (alertsFromTimeline.length > 0) {
        return alertsFromTimeline;
    }

    return deliveries.slice(0, 3).map((delivery, index) => ({
        id: delivery.id,
        title: delivery.title,
        severity: delivery.delivery_status === 'failed'
            ? 'urgent'
            : delivery.notification_type.includes('reminder')
                ? 'watch'
                : 'info',
        detail: delivery.body,
        action: extractActionLabel(delivery.metadata, index),
    }));
}

function mapTimelineEntryToPreview(entry: PetPassTimelineEntryRecord): PetPassTimelineItem {
    return {
        id: entry.id,
        title: entry.title,
        at: formatTimestamp(entry.occurred_at),
        type: entry.entry_type === 'message' || entry.entry_type === 'referral'
            ? 'alert'
            : entry.entry_type,
        detail: entry.detail,
    };
}

function inferAlertSeverity(title: string, detail: string): PetPassAlert['severity'] {
    const joined = `${title} ${detail}`.toLowerCase();
    if (joined.includes('urgent') || joined.includes('emergency') || joined.includes('escalat')) {
        return 'urgent';
    }
    if (joined.includes('watch') || joined.includes('recheck') || joined.includes('follow-up')) {
        return 'watch';
    }
    return 'info';
}

function extractActionLabel(metadata: Record<string, unknown>, index: number): string {
    const action = readString(metadata.action_label) ?? readString(metadata.action) ?? null;
    if (action) {
        return action;
    }
    return index === 0 ? 'Open PetPass' : 'Review update';
}

function createEmptyNetworkSummary(): PublicPetPassSnapshot['network_summary'] {
    return {
        owner_accounts: 0,
        linked_pets: 0,
        clinic_links: 0,
        granted_consents: 0,
        active_alerts: 0,
        queued_notifications: 0,
        sent_notifications: 0,
    };
}

function formatTimestamp(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return value;
    }

    return parsed.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

function uniqueStrings(values: Array<string | null>): string[] {
    return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalText(value: unknown): string | null {
    return readString(value);
}
