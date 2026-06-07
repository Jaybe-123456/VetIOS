import { createHash, randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    CLINIC_OWNER_LINKS,
    OWNER_ACCOUNTS,
    OWNER_PET_LINKS,
    PETPASS_CONSENTS,
    PETPASS_NOTIFICATION_DELIVERIES,
    PETPASS_NOTIFICATION_PREFERENCES,
    PETPASS_OWNER_INVITATIONS,
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
export type PetPassInvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';
export type PetPassInvitationDeliveryChannel = 'link' | 'email' | 'sms';

export interface OwnerAccountRecord {
    id: string;
    tenant_id: string;
    external_owner_ref: string | null;
    full_name: string;
    preferred_name: string | null;
    email: string | null;
    phone: string | null;
    status: OwnerAccountStatus;
    consumer_identity_hash: string | null;
    consumer_auth_provider: string | null;
    consumer_activated_at: string | null;
    consumer_last_seen_at: string | null;
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

export interface PetPassOwnerInvitationRecord {
    id: string;
    tenant_id: string;
    owner_account_id: string;
    pet_profile_id: string | null;
    clinic_owner_link_id: string | null;
    token_hash: string;
    invite_url: string;
    delivery_channel: PetPassInvitationDeliveryChannel;
    delivery_address_hash: string | null;
    status: PetPassInvitationStatus;
    expires_at: string;
    accepted_at: string | null;
    accepted_identity_hash: string | null;
    accepted_user_agent_hash: string | null;
    metadata: Record<string, unknown>;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface PetPassIssuedInvitation {
    invitation: PetPassOwnerInvitationRecord;
    invite_token: string;
    invite_url: string;
}

export interface PetPassInvitationPreview {
    invitation_id: string;
    status: PetPassInvitationStatus;
    expires_at: string;
    clinic_name: string;
    owner_display_name: string;
    pet: {
        id: string;
        pet_name: string;
        species: string | null;
        breed: string | null;
        age_display: string | null;
        risk_state: PetPassRiskState;
    } | null;
}

export interface PetPassOwnerAppSnapshot {
    owner: {
        id: string;
        display_name: string;
        status: OwnerAccountStatus;
        activated_at: string | null;
    };
    pets: Array<{
        id: string;
        pet_name: string;
        species: string | null;
        breed: string | null;
        age_display: string | null;
        risk_state: PetPassRiskState;
        clinic_name: string | null;
    }>;
    clinic_links: Array<{
        id: string;
        clinic_name: string;
        status: ClinicOwnerLinkStatus;
    }>;
    timeline: PetPassTimelineItem[];
    alerts: PetPassAlert[];
    consents: Array<{
        consent_type: string;
        status: PetPassConsentStatus;
    }>;
    notification_preferences: Array<{
        channel: PetPassChannel;
        notification_type: string;
        enabled: boolean;
    }>;
}

export interface PetPassControlPlaneSnapshot {
    tenant_id: string;
    owners: OwnerAccountRecord[];
    pet_profiles: PetPassPetProfileRecord[];
    owner_pet_links: OwnerPetLinkRecord[];
    clinic_owner_links: ClinicOwnerLinkRecord[];
    owner_invitations: PetPassOwnerInvitationRecord[];
    consents: PetPassConsentRecord[];
    notification_preferences: PetPassNotificationPreferenceRecord[];
    timeline_entries: PetPassTimelineEntryRecord[];
    notification_deliveries: PetPassNotificationDeliveryRecord[];
    summary: {
        owner_accounts: number;
        linked_pets: number;
        clinic_links: number;
        pending_invitations: number;
        accepted_invitations: number;
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
        pending_invitations: number;
        accepted_invitations: number;
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
        ownerInvitations,
        consents,
        notificationPreferences,
        timelineEntries,
        notificationDeliveries,
    ] = await Promise.all([
        listOwnerAccounts(client, tenantId, limit),
        listPetProfiles(client, tenantId, limit),
        listOwnerPetLinks(client, tenantId, limit),
        listClinicOwnerLinks(client, tenantId, limit),
        listOwnerInvitations(client, tenantId, limit),
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
        owner_invitations: ownerInvitations,
        consents,
        notification_preferences: notificationPreferences,
        timeline_entries: timelineEntries,
        notification_deliveries: notificationDeliveries,
        summary: {
            owner_accounts: owners.length,
            linked_pets: uniqueStrings(ownerPetLinks.map((link) => link.pet_profile_id)).length,
            clinic_links: clinicOwnerLinks.length,
            pending_invitations: ownerInvitations.filter((invite) => invite.status === 'pending').length,
            accepted_invitations: ownerInvitations.filter((invite) => invite.status === 'accepted').length,
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
                title: 'Owner invitation acceptance',
                summary: 'Clinics can now issue hashed one-time PetPass links that activate the owner record and return an owner-safe mobile snapshot.',
                readiness: 'preview',
            },
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

export async function createOwnerInvitation(
    client: SupabaseClient,
    input: {
        tenantId: string;
        actor: string | null;
        ownerAccountId: string;
        clinicOwnerLinkId?: string | null;
        petProfileId?: string | null;
        baseUrl?: string | null;
        deliveryChannel?: PetPassInvitationDeliveryChannel;
        deliveryAddress?: string | null;
        expiresAt?: string | null;
        metadata?: Record<string, unknown>;
    },
): Promise<PetPassIssuedInvitation> {
    const token = createPetPassInviteToken();
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const inviteUrl = `${baseUrl}/petpass/invite?token=${encodeURIComponent(token)}`;
    const C = PETPASS_OWNER_INVITATIONS.COLUMNS;
    const { data, error } = await client
        .from(PETPASS_OWNER_INVITATIONS.TABLE)
        .insert({
            [C.tenant_id]: input.tenantId,
            [C.owner_account_id]: input.ownerAccountId,
            [C.pet_profile_id]: input.petProfileId ?? null,
            [C.clinic_owner_link_id]: input.clinicOwnerLinkId ?? null,
            [C.token_hash]: hashPetPassInviteToken(token),
            [C.invite_url]: inviteUrl,
            [C.delivery_channel]: input.deliveryChannel ?? 'link',
            [C.delivery_address_hash]: hashOptionalIdentity(input.deliveryAddress),
            [C.status]: 'pending',
            [C.expires_at]: input.expiresAt ?? twoWeeksFromNow(),
            [C.metadata]: input.metadata ?? {},
            [C.created_by]: input.actor,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to create PetPass owner invitation: ${error?.message ?? 'Unknown error'}`);
    }

    return {
        invitation: mapOwnerInvitation(asRecord(data)),
        invite_token: token,
        invite_url: inviteUrl,
    };
}

export async function previewOwnerInvitation(
    client: SupabaseClient,
    token: string,
): Promise<PetPassInvitationPreview | null> {
    const resolved = await resolveOwnerInvitationByToken(client, token);
    if (!resolved) {
        return null;
    }

    return {
        invitation_id: resolved.invitation.id,
        status: resolved.invitation.status,
        expires_at: resolved.invitation.expires_at,
        clinic_name: resolved.clinicLink?.clinic_name ?? resolved.pet?.clinic_name ?? 'VetIOS clinic',
        owner_display_name: resolved.owner.preferred_name ?? resolved.owner.full_name,
        pet: resolved.pet
            ? {
                id: resolved.pet.id,
                pet_name: resolved.pet.pet_name,
                species: resolved.pet.species,
                breed: resolved.pet.breed,
                age_display: resolved.pet.age_display,
                risk_state: resolved.pet.risk_state,
            }
            : null,
    };
}

export async function acceptOwnerInvitation(
    client: SupabaseClient,
    input: {
        token: string;
        identity?: string | null;
        userAgent?: string | null;
        consentTypes?: string[];
        notificationChannel?: PetPassChannel | null;
        notificationTypes?: string[];
    },
): Promise<{
        invitation: PetPassOwnerInvitationRecord;
        owner_app: PetPassOwnerAppSnapshot;
    }> {
    const resolved = await resolveOwnerInvitationByToken(client, input.token);
    if (!resolved) {
        throw new Error('PetPass invitation was not found.');
    }

    const now = new Date();
    const expiresAt = new Date(resolved.invitation.expires_at);
    if (resolved.invitation.status !== 'pending' || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
        await markOwnerInvitationExpired(client, resolved.invitation);
        throw new Error('PetPass invitation has expired or is no longer active.');
    }

    const identityHash = hashOptionalIdentity(input.identity);
    const userAgentHash = hashOptionalIdentity(input.userAgent);
    const IC = PETPASS_OWNER_INVITATIONS.COLUMNS;
    const acceptedAt = now.toISOString();
    const { data: inviteData, error: inviteError } = await client
        .from(PETPASS_OWNER_INVITATIONS.TABLE)
        .update({
            [IC.status]: 'accepted',
            [IC.accepted_at]: acceptedAt,
            [IC.accepted_identity_hash]: identityHash,
            [IC.accepted_user_agent_hash]: userAgentHash,
        })
        .eq(IC.id, resolved.invitation.id)
        .eq(IC.status, 'pending')
        .select('*')
        .single();

    if (inviteError || !inviteData) {
        throw new Error(`Failed to accept PetPass invitation: ${inviteError?.message ?? 'Unknown error'}`);
    }

    const OC = OWNER_ACCOUNTS.COLUMNS;
    await client
        .from(OWNER_ACCOUNTS.TABLE)
        .update({
            [OC.status]: 'active',
            [OC.consumer_identity_hash]: identityHash,
            [OC.consumer_auth_provider]: 'petpass_invite',
            [OC.consumer_activated_at]: acceptedAt,
            [OC.consumer_last_seen_at]: acceptedAt,
            [OC.last_active_at]: acceptedAt,
        })
        .eq(OC.tenant_id, resolved.invitation.tenant_id)
        .eq(OC.id, resolved.invitation.owner_account_id);

    if (resolved.clinicLink) {
        const CLC = CLINIC_OWNER_LINKS.COLUMNS;
        await client
            .from(CLINIC_OWNER_LINKS.TABLE)
            .update({ [CLC.status]: 'active' })
            .eq(CLC.tenant_id, resolved.invitation.tenant_id)
            .eq(CLC.id, resolved.clinicLink.id);
    }

    if (resolved.pet) {
        const OPLC = OWNER_PET_LINKS.COLUMNS;
        await client
            .from(OWNER_PET_LINKS.TABLE)
            .update({ [OPLC.status]: 'active' })
            .eq(OPLC.tenant_id, resolved.invitation.tenant_id)
            .eq(OPLC.owner_account_id, resolved.invitation.owner_account_id)
            .eq(OPLC.pet_profile_id, resolved.pet.id);
    }

    for (const consentType of normalizeConsentTypes(input.consentTypes)) {
        await recordConsent(client, {
            tenantId: resolved.invitation.tenant_id,
            actor: null,
            ownerAccountId: resolved.invitation.owner_account_id,
            petProfileId: resolved.pet?.id ?? null,
            consentType,
            status: 'granted',
            grantedAt: acceptedAt,
            metadata: {
                source: 'petpass_invite_acceptance',
                invitation_id: resolved.invitation.id,
            },
        });
    }

    if (input.notificationChannel) {
        for (const notificationType of normalizeNotificationTypes(input.notificationTypes)) {
            await upsertNotificationPreference(client, {
                tenantId: resolved.invitation.tenant_id,
                ownerAccountId: resolved.invitation.owner_account_id,
                petProfileId: resolved.pet?.id ?? null,
                channel: input.notificationChannel,
                notificationType,
                enabled: true,
                metadata: {
                    source: 'petpass_invite_acceptance',
                    invitation_id: resolved.invitation.id,
                },
            });
        }
    }

    return {
        invitation: mapOwnerInvitation(asRecord(inviteData)),
        owner_app: await getOwnerAppSnapshot(client, resolved.invitation.tenant_id, resolved.invitation.owner_account_id),
    };
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

export async function getOwnerAppSnapshot(
    client: SupabaseClient,
    tenantId: string,
    ownerAccountId: string,
): Promise<PetPassOwnerAppSnapshot> {
    const owner = await getOwnerAccount(client, tenantId, ownerAccountId);
    if (!owner) {
        throw new Error('PetPass owner account was not found.');
    }

    const ownerPetLinks = await listOwnerPetLinksForOwner(client, tenantId, ownerAccountId);
    const petIds = uniqueStrings(ownerPetLinks.map((link) => link.pet_profile_id));
    const [pets, clinicLinks, timelineEntries, deliveries, consents, preferences] = await Promise.all([
        listPetProfilesByIds(client, tenantId, petIds),
        listClinicOwnerLinksForOwner(client, tenantId, ownerAccountId),
        listTimelineEntriesForPets(client, tenantId, petIds),
        listNotificationDeliveriesForOwner(client, tenantId, ownerAccountId),
        listConsentsForOwner(client, tenantId, ownerAccountId),
        listNotificationPreferencesForOwner(client, tenantId, ownerAccountId),
    ]);

    const alerts = toPublicAlerts(deliveries, timelineEntries);

    return {
        owner: {
            id: owner.id,
            display_name: owner.preferred_name ?? owner.full_name,
            status: owner.status,
            activated_at: owner.consumer_activated_at,
        },
        pets: pets.map((pet) => ({
            id: pet.id,
            pet_name: pet.pet_name,
            species: pet.species,
            breed: pet.breed,
            age_display: pet.age_display,
            risk_state: pet.risk_state,
            clinic_name: pet.clinic_name,
        })),
        clinic_links: clinicLinks.map((link) => ({
            id: link.id,
            clinic_name: link.clinic_name,
            status: link.status,
        })),
        timeline: timelineEntries.slice(0, 12).map(mapTimelineEntryToPreview),
        alerts,
        consents: consents.map((consent) => ({
            consent_type: consent.consent_type,
            status: consent.status,
        })),
        notification_preferences: preferences.map((preference) => ({
            channel: preference.channel,
            notification_type: preference.notification_type,
            enabled: preference.enabled,
        })),
    };
}

async function resolveOwnerInvitationByToken(
    client: SupabaseClient,
    token: string,
): Promise<{
        invitation: PetPassOwnerInvitationRecord;
        owner: OwnerAccountRecord;
        pet: PetPassPetProfileRecord | null;
        clinicLink: ClinicOwnerLinkRecord | null;
    } | null> {
    const normalizedToken = normalizeOptionalText(token);
    if (!normalizedToken) {
        return null;
    }

    const C = PETPASS_OWNER_INVITATIONS.COLUMNS;
    const { data, error } = await client
        .from(PETPASS_OWNER_INVITATIONS.TABLE)
        .select('*')
        .eq(C.token_hash, hashPetPassInviteToken(normalizedToken))
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to load PetPass invitation: ${error.message}`);
    }
    if (!data) {
        return null;
    }

    const invitation = mapOwnerInvitation(asRecord(data));
    const expiresAt = new Date(invitation.expires_at);
    if (invitation.status === 'pending' && (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= Date.now())) {
        return {
            invitation: await markOwnerInvitationExpired(client, invitation),
            owner: await requireOwnerAccount(client, invitation.tenant_id, invitation.owner_account_id),
            pet: invitation.pet_profile_id ? await getPetProfile(client, invitation.tenant_id, invitation.pet_profile_id) : null,
            clinicLink: invitation.clinic_owner_link_id ? await getClinicOwnerLink(client, invitation.tenant_id, invitation.clinic_owner_link_id) : null,
        };
    }

    return {
        invitation,
        owner: await requireOwnerAccount(client, invitation.tenant_id, invitation.owner_account_id),
        pet: invitation.pet_profile_id ? await getPetProfile(client, invitation.tenant_id, invitation.pet_profile_id) : null,
        clinicLink: invitation.clinic_owner_link_id ? await getClinicOwnerLink(client, invitation.tenant_id, invitation.clinic_owner_link_id) : null,
    };
}

async function markOwnerInvitationExpired(
    client: SupabaseClient,
    invitation: PetPassOwnerInvitationRecord,
): Promise<PetPassOwnerInvitationRecord> {
    if (invitation.status !== 'pending') {
        return invitation;
    }

    const C = PETPASS_OWNER_INVITATIONS.COLUMNS;
    const { data, error } = await client
        .from(PETPASS_OWNER_INVITATIONS.TABLE)
        .update({ [C.status]: 'expired' })
        .eq(C.id, invitation.id)
        .eq(C.status, 'pending')
        .select('*')
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to expire PetPass invitation: ${error.message}`);
    }

    return data ? mapOwnerInvitation(asRecord(data)) : invitation;
}

async function requireOwnerAccount(
    client: SupabaseClient,
    tenantId: string,
    ownerAccountId: string,
): Promise<OwnerAccountRecord> {
    const owner = await getOwnerAccount(client, tenantId, ownerAccountId);
    if (!owner) {
        throw new Error('PetPass owner account was not found.');
    }
    return owner;
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

async function listOwnerInvitations(
    client: SupabaseClient,
    tenantId: string,
    limit: number,
): Promise<PetPassOwnerInvitationRecord[]> {
    const { data, error } = await client
        .from(PETPASS_OWNER_INVITATIONS.TABLE)
        .select('*')
        .eq(PETPASS_OWNER_INVITATIONS.COLUMNS.tenant_id, tenantId)
        .order(PETPASS_OWNER_INVITATIONS.COLUMNS.created_at, { ascending: false })
        .limit(limit);

    if (error) {
        throw new Error(`Failed to list PetPass owner invitations: ${error.message}`);
    }

    return (data ?? []).map((row) => mapOwnerInvitation(asRecord(row)));
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

async function getPetProfile(
    client: SupabaseClient,
    tenantId: string,
    petProfileId: string,
): Promise<PetPassPetProfileRecord | null> {
    const { data, error } = await client
        .from(PETPASS_PET_PROFILES.TABLE)
        .select('*')
        .eq(PETPASS_PET_PROFILES.COLUMNS.tenant_id, tenantId)
        .eq(PETPASS_PET_PROFILES.COLUMNS.id, petProfileId)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to load PetPass pet profile: ${error.message}`);
    }

    return data ? mapPetProfile(asRecord(data)) : null;
}

async function getClinicOwnerLink(
    client: SupabaseClient,
    tenantId: string,
    clinicOwnerLinkId: string,
): Promise<ClinicOwnerLinkRecord | null> {
    const { data, error } = await client
        .from(CLINIC_OWNER_LINKS.TABLE)
        .select('*')
        .eq(CLINIC_OWNER_LINKS.COLUMNS.tenant_id, tenantId)
        .eq(CLINIC_OWNER_LINKS.COLUMNS.id, clinicOwnerLinkId)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to load PetPass clinic-owner link: ${error.message}`);
    }

    return data ? mapClinicOwnerLink(asRecord(data)) : null;
}

async function listOwnerPetLinksForOwner(
    client: SupabaseClient,
    tenantId: string,
    ownerAccountId: string,
): Promise<OwnerPetLinkRecord[]> {
    const { data, error } = await client
        .from(OWNER_PET_LINKS.TABLE)
        .select('*')
        .eq(OWNER_PET_LINKS.COLUMNS.tenant_id, tenantId)
        .eq(OWNER_PET_LINKS.COLUMNS.owner_account_id, ownerAccountId)
        .in(OWNER_PET_LINKS.COLUMNS.status, ['active', 'invited'])
        .order(OWNER_PET_LINKS.COLUMNS.linked_at, { ascending: false });

    if (error) {
        throw new Error(`Failed to list owner PetPass links: ${error.message}`);
    }

    return (data ?? []).map((row) => mapOwnerPetLink(asRecord(row)));
}

async function listPetProfilesByIds(
    client: SupabaseClient,
    tenantId: string,
    petProfileIds: string[],
): Promise<PetPassPetProfileRecord[]> {
    if (petProfileIds.length === 0) {
        return [];
    }

    const { data, error } = await client
        .from(PETPASS_PET_PROFILES.TABLE)
        .select('*')
        .eq(PETPASS_PET_PROFILES.COLUMNS.tenant_id, tenantId)
        .in(PETPASS_PET_PROFILES.COLUMNS.id, petProfileIds)
        .order(PETPASS_PET_PROFILES.COLUMNS.updated_at, { ascending: false });

    if (error) {
        throw new Error(`Failed to list owner PetPass pets: ${error.message}`);
    }

    return (data ?? []).map((row) => mapPetProfile(asRecord(row)));
}

async function listClinicOwnerLinksForOwner(
    client: SupabaseClient,
    tenantId: string,
    ownerAccountId: string,
): Promise<ClinicOwnerLinkRecord[]> {
    const { data, error } = await client
        .from(CLINIC_OWNER_LINKS.TABLE)
        .select('*')
        .eq(CLINIC_OWNER_LINKS.COLUMNS.tenant_id, tenantId)
        .eq(CLINIC_OWNER_LINKS.COLUMNS.owner_account_id, ownerAccountId)
        .order(CLINIC_OWNER_LINKS.COLUMNS.updated_at, { ascending: false });

    if (error) {
        throw new Error(`Failed to list owner clinic links: ${error.message}`);
    }

    return (data ?? []).map((row) => mapClinicOwnerLink(asRecord(row)));
}

async function listTimelineEntriesForPets(
    client: SupabaseClient,
    tenantId: string,
    petProfileIds: string[],
): Promise<PetPassTimelineEntryRecord[]> {
    if (petProfileIds.length === 0) {
        return [];
    }

    const { data, error } = await client
        .from(PETPASS_TIMELINE_ENTRIES.TABLE)
        .select('*')
        .eq(PETPASS_TIMELINE_ENTRIES.COLUMNS.tenant_id, tenantId)
        .eq(PETPASS_TIMELINE_ENTRIES.COLUMNS.visibility, 'owner_safe')
        .in(PETPASS_TIMELINE_ENTRIES.COLUMNS.pet_profile_id, petProfileIds)
        .order(PETPASS_TIMELINE_ENTRIES.COLUMNS.occurred_at, { ascending: false })
        .limit(24);

    if (error) {
        throw new Error(`Failed to list owner PetPass timeline: ${error.message}`);
    }

    return (data ?? []).map((row) => mapTimelineEntry(asRecord(row)));
}

async function listNotificationDeliveriesForOwner(
    client: SupabaseClient,
    tenantId: string,
    ownerAccountId: string,
): Promise<PetPassNotificationDeliveryRecord[]> {
    const { data, error } = await client
        .from(PETPASS_NOTIFICATION_DELIVERIES.TABLE)
        .select('*')
        .eq(PETPASS_NOTIFICATION_DELIVERIES.COLUMNS.tenant_id, tenantId)
        .eq(PETPASS_NOTIFICATION_DELIVERIES.COLUMNS.owner_account_id, ownerAccountId)
        .order(PETPASS_NOTIFICATION_DELIVERIES.COLUMNS.scheduled_at, { ascending: false })
        .limit(24);

    if (error) {
        throw new Error(`Failed to list owner notification deliveries: ${error.message}`);
    }

    return (data ?? []).map((row) => mapNotificationDelivery(asRecord(row)));
}

async function listConsentsForOwner(
    client: SupabaseClient,
    tenantId: string,
    ownerAccountId: string,
): Promise<PetPassConsentRecord[]> {
    const { data, error } = await client
        .from(PETPASS_CONSENTS.TABLE)
        .select('*')
        .eq(PETPASS_CONSENTS.COLUMNS.tenant_id, tenantId)
        .eq(PETPASS_CONSENTS.COLUMNS.owner_account_id, ownerAccountId)
        .order(PETPASS_CONSENTS.COLUMNS.created_at, { ascending: false })
        .limit(24);

    if (error) {
        throw new Error(`Failed to list owner consents: ${error.message}`);
    }

    return (data ?? []).map((row) => mapConsent(asRecord(row)));
}

async function listNotificationPreferencesForOwner(
    client: SupabaseClient,
    tenantId: string,
    ownerAccountId: string,
): Promise<PetPassNotificationPreferenceRecord[]> {
    const { data, error } = await client
        .from(PETPASS_NOTIFICATION_PREFERENCES.TABLE)
        .select('*')
        .eq(PETPASS_NOTIFICATION_PREFERENCES.COLUMNS.tenant_id, tenantId)
        .eq(PETPASS_NOTIFICATION_PREFERENCES.COLUMNS.owner_account_id, ownerAccountId)
        .order(PETPASS_NOTIFICATION_PREFERENCES.COLUMNS.updated_at, { ascending: false });

    if (error) {
        throw new Error(`Failed to list owner notification preferences: ${error.message}`);
    }

    return (data ?? []).map((row) => mapNotificationPreference(asRecord(row)));
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
        consumer_identity_hash: readString(row.consumer_identity_hash),
        consumer_auth_provider: readString(row.consumer_auth_provider),
        consumer_activated_at: readString(row.consumer_activated_at),
        consumer_last_seen_at: readString(row.consumer_last_seen_at),
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

function mapOwnerInvitation(row: Record<string, unknown>): PetPassOwnerInvitationRecord {
    return {
        id: String(row.id),
        tenant_id: readString(row.tenant_id) ?? 'unknown_tenant',
        owner_account_id: readString(row.owner_account_id) ?? 'unknown_owner',
        pet_profile_id: readString(row.pet_profile_id),
        clinic_owner_link_id: readString(row.clinic_owner_link_id),
        token_hash: readString(row.token_hash) ?? '',
        invite_url: readString(row.invite_url) ?? '',
        delivery_channel: normalizeInvitationDeliveryChannel(readString(row.delivery_channel)) ?? 'link',
        delivery_address_hash: readString(row.delivery_address_hash),
        status: normalizeInvitationStatus(readString(row.status)) ?? 'pending',
        expires_at: String(row.expires_at ?? row.created_at),
        accepted_at: readString(row.accepted_at),
        accepted_identity_hash: readString(row.accepted_identity_hash),
        accepted_user_agent_hash: readString(row.accepted_user_agent_hash),
        metadata: asRecord(row.metadata),
        created_by: readString(row.created_by),
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

function createPetPassInviteToken(): string {
    return randomBytes(32).toString('base64url');
}

function hashPetPassInviteToken(token: string): string {
    return createHash('sha256')
        .update(`petpass_invite:${token.trim()}`)
        .digest('hex');
}

function hashOptionalIdentity(value: unknown): string | null {
    const normalized = normalizeOptionalText(value)?.toLowerCase();
    if (!normalized) {
        return null;
    }

    return createHash('sha256')
        .update(`petpass_identity:${normalized}`)
        .digest('hex');
}

function normalizeBaseUrl(value: string | null | undefined): string {
    const normalized = normalizeOptionalText(value) ?? process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.vetios.tech';
    return normalized.replace(/\/+$/, '');
}

function twoWeeksFromNow(): string {
    return new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
}

function normalizeConsentTypes(values: string[] | undefined): string[] {
    const normalized = new Set(
        (values ?? [])
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
    );

    if (normalized.size === 0) {
        normalized.add('petpass_terms');
        normalized.add('owner_health_history_access');
    }

    return [...normalized];
}

function normalizeNotificationTypes(values: string[] | undefined): string[] {
    const normalized = new Set(
        (values ?? [])
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
    );

    if (normalized.size === 0) {
        normalized.add('care_alert');
        normalized.add('visit_summary');
    }

    return [...normalized];
}

function normalizeInvitationStatus(value: string | null): PetPassInvitationStatus | null {
    return value === 'pending' || value === 'accepted' || value === 'expired' || value === 'revoked'
        ? value
        : null;
}

function normalizeInvitationDeliveryChannel(value: string | null): PetPassInvitationDeliveryChannel | null {
    return value === 'link' || value === 'email' || value === 'sms' ? value : null;
}

function createEmptyNetworkSummary(): PublicPetPassSnapshot['network_summary'] {
    return {
        owner_accounts: 0,
        linked_pets: 0,
        clinic_links: 0,
        pending_invitations: 0,
        accepted_invitations: 0,
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
