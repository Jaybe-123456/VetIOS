import { createHash, randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { API_CREDENTIALS, CONNECTOR_INSTALLATIONS, SERVICE_ACCOUNTS } from '@/lib/db/schemaContracts';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import { resolveSessionTenant } from '@/lib/supabaseServer';

export const MACHINE_CREDENTIAL_SCOPES = [
    'inference:write',
    'outcome:write',
    'simulation:write',
    'evaluation:write',
    'evaluation:read',
    'signals:ingest',
    'signals:connect',
    'signals:read',
    'machine:manage',
] as const;

export type MachineCredentialScope = typeof MACHINE_CREDENTIAL_SCOPES[number];
export type MachineCredentialPrincipalType = 'service_account' | 'connector_installation';
export type ClinicalApiAuthMode = 'session' | 'dev_bypass' | 'service_account' | 'connector_installation';

export interface ServiceAccountRecord {
    id: string;
    tenant_id: string;
    name: string;
    description: string | null;
    status: 'active' | 'disabled' | 'revoked';
    metadata: Record<string, unknown>;
    created_by: string | null;
    last_used_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface ConnectorInstallationRecord {
    id: string;
    tenant_id: string;
    installation_name: string;
    connector_type: string;
    vendor_name: string | null;
    vendor_account_ref: string | null;
    status: 'active' | 'paused' | 'revoked';
    metadata: Record<string, unknown>;
    created_by: string | null;
    last_used_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface ApiCredentialRecord {
    id: string;
    tenant_id: string;
    principal_type: MachineCredentialPrincipalType;
    service_account_id: string | null;
    connector_installation_id: string | null;
    label: string;
    key_prefix: string;
    key_hash: string;
    scopes: MachineCredentialScope[];
    status: 'active' | 'revoked';
    expires_at: string | null;
    metadata: Record<string, unknown>;
    created_by: string | null;
    revoked_by: string | null;
    last_used_at: string | null;
    created_at: string;
    revoked_at: string | null;
}

export interface MachineApiPrincipal {
    tenantId: string;
    userId: null;
    authMode: 'service_account' | 'connector_installation';
    credential: ApiCredentialRecord;
    scopes: MachineCredentialScope[];
    serviceAccount: ServiceAccountRecord | null;
    connectorInstallation: ConnectorInstallationRecord | null;
    principalLabel: string;
}

export interface ClinicalApiActor {
    tenantId: string;
    userId: string | null;
    authMode: ClinicalApiAuthMode;
    scopes: MachineCredentialScope[] | ['*'];
    credentialId: string | null;
    principalLabel: string | null;
    serviceAccountId: string | null;
    connectorInstallation: ConnectorInstallationRecord | null;
}

export interface ClinicalApiActorResolution {
    actor: ClinicalApiActor | null;
    error: { status: number; message: string } | null;
}

export function normalizeMachineCredentialScopes(scopes: readonly string[] | null | undefined): MachineCredentialScope[] {
    if (!Array.isArray(scopes)) {
        return [];
    }

    const allowed = new Set<string>(MACHINE_CREDENTIAL_SCOPES);
    const normalized = scopes
        .map((scope) => scope.trim())
        .filter((scope): scope is MachineCredentialScope => allowed.has(scope));

    return [...new Set(normalized)];
}

export async function listServiceAccounts(
    client: SupabaseClient,
    tenantId: string,
): Promise<ServiceAccountRecord[]> {
    const C = SERVICE_ACCOUNTS.COLUMNS;
    const { data, error } = await client
        .from(SERVICE_ACCOUNTS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .order(C.created_at, { ascending: false })
        .limit(100);

    if (error) {
        throw new Error(`Failed to list service accounts: ${error.message}`);
    }

    return (data ?? []).map((row) => mapServiceAccount(row as Record<string, unknown>));
}

export async function listConnectorInstallations(
    client: SupabaseClient,
    tenantId: string,
): Promise<ConnectorInstallationRecord[]> {
    const C = CONNECTOR_INSTALLATIONS.COLUMNS;
    const { data, error } = await client
        .from(CONNECTOR_INSTALLATIONS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .order(C.created_at, { ascending: false })
        .limit(100);

    if (error) {
        throw new Error(`Failed to list connector installations: ${error.message}`);
    }

    return (data ?? []).map((row) => mapConnectorInstallation(row as Record<string, unknown>));
}

export async function getConnectorInstallation(
    client: SupabaseClient,
    tenantId: string,
    id: string,
): Promise<ConnectorInstallationRecord | null> {
    return getConnectorInstallationById(client, tenantId, id);
}

export async function updateConnectorInstallation(input: {
    client: SupabaseClient;
    tenantId: string;
    connectorInstallationId: string;
    patch: Partial<{
        installation_name: string;
        vendor_name: string | null;
        vendor_account_ref: string | null;
        status: ConnectorInstallationRecord['status'];
        metadata: Record<string, unknown>;
    }>;
}): Promise<ConnectorInstallationRecord> {
    const existing = await getConnectorInstallationById(input.client, input.tenantId, input.connectorInstallationId);
    if (!existing) {
        throw new Error('Connector installation was not found.');
    }

    const C = CONNECTOR_INSTALLATIONS.COLUMNS;
    const updatePayload: Record<string, unknown> = {};
    if (typeof input.patch.installation_name === 'string' && input.patch.installation_name.trim().length > 0) {
        updatePayload[C.installation_name] = input.patch.installation_name.trim();
    }
    if (input.patch.vendor_name !== undefined) {
        updatePayload[C.vendor_name] = normalizeOptionalText(input.patch.vendor_name);
    }
    if (input.patch.vendor_account_ref !== undefined) {
        updatePayload[C.vendor_account_ref] = normalizeOptionalText(input.patch.vendor_account_ref);
    }
    if (input.patch.status) {
        updatePayload[C.status] = input.patch.status;
    }
    if (input.patch.metadata) {
        updatePayload[C.metadata] = mergeRecords(existing.metadata, input.patch.metadata);
    }

    const { data, error } = await input.client
        .from(CONNECTOR_INSTALLATIONS.TABLE)
        .update(updatePayload)
        .eq(C.tenant_id, input.tenantId)
        .eq(C.id, input.connectorInstallationId)
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to update connector installation: ${error?.message ?? 'Unknown error'}`);
    }

    return mapConnectorInstallation(data as Record<string, unknown>);
}

export async function listApiCredentials(
    client: SupabaseClient,
    tenantId: string,
): Promise<ApiCredentialRecord[]> {
    const C = API_CREDENTIALS.COLUMNS;
    const { data, error } = await client
        .from(API_CREDENTIALS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .order(C.created_at, { ascending: false })
        .limit(200);

    if (error) {
        throw new Error(`Failed to list API credentials: ${error.message}`);
    }

    return (data ?? []).map((row) => mapApiCredential(row as Record<string, unknown>));
}

export async function createServiceAccountWithCredential(input: {
    client: SupabaseClient;
    tenantId: string;
    actor: string | null;
    name: string;
    description?: string | null;
    label?: string | null;
    scopes: readonly string[];
    metadata?: Record<string, unknown>;
    expiresAt?: string | null;
}): Promise<{
    serviceAccount: ServiceAccountRecord;
    credential: ApiCredentialRecord;
    apiKey: string;
}> {
    const name = normalizeRequiredText(input.name, 'name');
    const account = await createServiceAccount(input.client, {
        tenantId: input.tenantId,
        actor: input.actor,
        name,
        description: input.description ?? null,
        metadata: input.metadata ?? {},
    });

    const issued = await issueApiCredential(input.client, {
        tenantId: input.tenantId,
        actor: input.actor,
        principalType: 'service_account',
        serviceAccountId: account.id,
        connectorInstallationId: null,
        label: input.label?.trim() || `${name} default`,
        scopes: input.scopes,
        expiresAt: input.expiresAt ?? null,
        metadata: input.metadata ?? {},
    });

    return {
        serviceAccount: account,
        credential: issued.credential,
        apiKey: issued.apiKey,
    };
}

export async function createConnectorInstallationWithCredential(input: {
    client: SupabaseClient;
    tenantId: string;
    actor: string | null;
    installationName: string;
    connectorType: string;
    vendorName?: string | null;
    vendorAccountRef?: string | null;
    label?: string | null;
    scopes?: readonly string[];
    metadata?: Record<string, unknown>;
    expiresAt?: string | null;
}): Promise<{
    installation: ConnectorInstallationRecord;
    credential: ApiCredentialRecord;
    apiKey: string;
}> {
    const installationName = normalizeRequiredText(input.installationName, 'installation_name');
    const connectorType = normalizeRequiredText(input.connectorType, 'connector_type');

    const installation = await createConnectorInstallation(input.client, {
        tenantId: input.tenantId,
        actor: input.actor,
        installationName,
        connectorType,
        vendorName: normalizeOptionalText(input.vendorName),
        vendorAccountRef: normalizeOptionalText(input.vendorAccountRef),
        metadata: input.metadata ?? {},
    });

    const scopes = input.scopes?.length
        ? input.scopes
        : ['signals:connect', 'signals:ingest'];
    const issued = await issueApiCredential(input.client, {
        tenantId: input.tenantId,
        actor: input.actor,
        principalType: 'connector_installation',
        serviceAccountId: null,
        connectorInstallationId: installation.id,
        label: input.label?.trim() || `${installationName} connector`,
        scopes,
        expiresAt: input.expiresAt ?? null,
        metadata: {
            connector_type: connectorType,
            vendor_name: installation.vendor_name,
            vendor_account_ref: installation.vendor_account_ref,
            ...input.metadata,
        },
    });

    return {
        installation,
        credential: issued.credential,
        apiKey: issued.apiKey,
    };
}

export async function issueServiceAccountCredential(input: {
    client: SupabaseClient;
    tenantId: string;
    actor: string | null;
    serviceAccountId: string;
    label: string;
    scopes: readonly string[];
    metadata?: Record<string, unknown>;
    expiresAt?: string | null;
}): Promise<{ credential: ApiCredentialRecord; apiKey: string }> {
    return issueApiCredential(input.client, {
        tenantId: input.tenantId,
        actor: input.actor,
        principalType: 'service_account',
        serviceAccountId: input.serviceAccountId,
        connectorInstallationId: null,
        label: normalizeRequiredText(input.label, 'label'),
        scopes: input.scopes,
        expiresAt: input.expiresAt ?? null,
        metadata: input.metadata ?? {},
    });
}

export async function issueConnectorInstallationCredential(input: {
    client: SupabaseClient;
    tenantId: string;
    actor: string | null;
    connectorInstallationId: string;
    label: string;
    scopes: readonly string[];
    metadata?: Record<string, unknown>;
    expiresAt?: string | null;
}): Promise<{ credential: ApiCredentialRecord; apiKey: string }> {
    return issueApiCredential(input.client, {
        tenantId: input.tenantId,
        actor: input.actor,
        principalType: 'connector_installation',
        serviceAccountId: null,
        connectorInstallationId: input.connectorInstallationId,
        label: normalizeRequiredText(input.label, 'label'),
        scopes: input.scopes,
        expiresAt: input.expiresAt ?? null,
        metadata: input.metadata ?? {},
    });
}

export async function revokeApiCredential(input: {
    client: SupabaseClient;
    tenantId: string;
    actor: string | null;
    credentialId: string;
}): Promise<ApiCredentialRecord> {
    const C = API_CREDENTIALS.COLUMNS;
    const { data, error } = await input.client
        .from(API_CREDENTIALS.TABLE)
        .update({
            [C.status]: 'revoked',
            [C.revoked_at]: new Date().toISOString(),
            [C.revoked_by]: input.actor,
        })
        .eq(C.tenant_id, input.tenantId)
        .eq(C.id, input.credentialId)
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to revoke API credential: ${error?.message ?? 'Unknown error'}`);
    }

    return mapApiCredential(data as Record<string, unknown>);
}

export async function resolveClinicalApiActor(
    req: Request,
    options: {
        client: SupabaseClient;
        requiredScopes?: readonly MachineCredentialScope[];
    },
): Promise<ClinicalApiActorResolution> {
    const session = await resolveSessionTenant();
    if (session) {
        const actor = resolveRequestActor(session);
        return {
            actor: {
                tenantId: actor.tenantId,
                userId: actor.userId,
                authMode: 'session',
                scopes: ['*'],
                credentialId: null,
                principalLabel: null,
                serviceAccountId: null,
                connectorInstallation: null,
            },
            error: null,
        };
    }

    const machine = await resolveMachineApiPrincipal(options.client, req, {
        requiredScopes: options.requiredScopes,
    });
    if (machine.error) {
        return { actor: null, error: machine.error };
    }
    if (machine.principal) {
        return {
            actor: {
                tenantId: machine.principal.tenantId,
                userId: null,
                authMode: machine.principal.authMode,
                scopes: machine.principal.scopes,
                credentialId: machine.principal.credential.id,
                principalLabel: machine.principal.principalLabel,
                serviceAccountId: machine.principal.serviceAccount?.id ?? null,
                connectorInstallation: machine.principal.connectorInstallation,
            },
            error: null,
        };
    }

    if (process.env.VETIOS_DEV_BYPASS === 'true') {
        return {
            actor: {
                tenantId: process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001',
                userId: process.env.VETIOS_DEV_USER_ID ?? null,
                authMode: 'dev_bypass',
                scopes: ['*'],
                credentialId: null,
                principalLabel: 'dev_bypass',
                serviceAccountId: null,
                connectorInstallation: null,
            },
            error: null,
        };
    }

    return {
        actor: null,
        error: { status: 401, message: 'Unauthorized' },
    };
}

export function validateConnectorInstallationAccess(input: {
    actor: ClinicalApiActor;
    connectorType: string;
    vendorName?: string | null;
    vendorAccountRef?: string | null;
}): { ok: true } | { ok: false; status: number; message: string } {
    if (input.actor.authMode !== 'connector_installation') {
        return { ok: true };
    }

    const installation = input.actor.connectorInstallation;
    if (!installation) {
        return { ok: false, status: 403, message: 'Connector installation context is missing.' };
    }

    if (installation.status !== 'active') {
        return { ok: false, status: 403, message: 'Connector installation is not active.' };
    }

    if (installation.connector_type !== input.connectorType) {
        return { ok: false, status: 403, message: 'Connector installation is not authorized for this connector type.' };
    }

    if (installation.vendor_name && installation.vendor_name !== normalizeOptionalText(input.vendorName)) {
        return { ok: false, status: 403, message: 'Connector installation is not authorized for this vendor.' };
    }

    if (installation.vendor_account_ref && installation.vendor_account_ref !== normalizeOptionalText(input.vendorAccountRef)) {
        return { ok: false, status: 403, message: 'Connector installation is not authorized for this vendor account reference.' };
    }

    return { ok: true };
}

async function resolveMachineApiPrincipal(
    client: SupabaseClient,
    req: Request,
    options: {
        requiredScopes?: readonly MachineCredentialScope[];
    },
): Promise<{
    principal: MachineApiPrincipal | null;
    error: { status: number; message: string } | null;
}> {
    const presentedKey = extractPresentedApiKey(req);
    if (!presentedKey) {
        return { principal: null, error: null };
    }

    const credential = await getApiCredentialByPresentedKey(client, presentedKey);
    if (!credential) {
        return {
            principal: null,
            error: { status: 401, message: 'Invalid API credential.' },
        };
    }

    if (credential.status !== 'active') {
        return {
            principal: null,
            error: { status: 403, message: 'API credential is not active.' },
        };
    }

    if (credential.expires_at && Date.parse(credential.expires_at) <= Date.now()) {
        return {
            principal: null,
            error: { status: 403, message: 'API credential has expired.' },
        };
    }

    const [serviceAccount, connectorInstallation] = await Promise.all([
        credential.service_account_id
            ? getServiceAccountById(client, credential.tenant_id, credential.service_account_id)
            : Promise.resolve(null),
        credential.connector_installation_id
            ? getConnectorInstallationById(client, credential.tenant_id, credential.connector_installation_id)
            : Promise.resolve(null),
    ]);

    if (credential.principal_type === 'service_account' && (!serviceAccount || serviceAccount.status !== 'active')) {
        return {
            principal: null,
            error: { status: 403, message: 'Service account is not active.' },
        };
    }

    if (credential.principal_type === 'connector_installation' && (!connectorInstallation || connectorInstallation.status !== 'active')) {
        return {
            principal: null,
            error: { status: 403, message: 'Connector installation is not active.' },
        };
    }

    const requiredScopes = options.requiredScopes ?? [];
    if (!hasAllRequiredScopes(credential.scopes, requiredScopes)) {
        return {
            principal: null,
            error: { status: 403, message: 'API credential does not grant the required scope.' },
        };
    }

    await markCredentialUsage(client, credential, serviceAccount, connectorInstallation);

    return {
        principal: {
            tenantId: credential.tenant_id,
            userId: null,
            authMode: credential.principal_type,
            credential,
            scopes: credential.scopes,
            serviceAccount,
            connectorInstallation,
            principalLabel: serviceAccount?.name ?? connectorInstallation?.installation_name ?? credential.label,
        },
        error: null,
    };
}

async function createServiceAccount(
    client: SupabaseClient,
    input: {
        tenantId: string;
        actor: string | null;
        name: string;
        description: string | null;
        metadata: Record<string, unknown>;
    },
): Promise<ServiceAccountRecord> {
    const C = SERVICE_ACCOUNTS.COLUMNS;
    const { data, error } = await client
        .from(SERVICE_ACCOUNTS.TABLE)
        .insert({
            [C.tenant_id]: input.tenantId,
            [C.name]: input.name,
            [C.description]: input.description,
            [C.status]: 'active',
            [C.metadata]: input.metadata,
            [C.created_by]: input.actor,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to create service account: ${error?.message ?? 'Unknown error'}`);
    }

    return mapServiceAccount(data as Record<string, unknown>);
}

async function createConnectorInstallation(
    client: SupabaseClient,
    input: {
        tenantId: string;
        actor: string | null;
        installationName: string;
        connectorType: string;
        vendorName: string | null;
        vendorAccountRef: string | null;
        metadata: Record<string, unknown>;
    },
): Promise<ConnectorInstallationRecord> {
    const C = CONNECTOR_INSTALLATIONS.COLUMNS;
    const { data, error } = await client
        .from(CONNECTOR_INSTALLATIONS.TABLE)
        .insert({
            [C.tenant_id]: input.tenantId,
            [C.installation_name]: input.installationName,
            [C.connector_type]: input.connectorType,
            [C.vendor_name]: input.vendorName,
            [C.vendor_account_ref]: input.vendorAccountRef,
            [C.status]: 'active',
            [C.metadata]: input.metadata,
            [C.created_by]: input.actor,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to create connector installation: ${error?.message ?? 'Unknown error'}`);
    }

    return mapConnectorInstallation(data as Record<string, unknown>);
}

async function issueApiCredential(
    client: SupabaseClient,
    input: {
        tenantId: string;
        actor: string | null;
        principalType: MachineCredentialPrincipalType;
        serviceAccountId: string | null;
        connectorInstallationId: string | null;
        label: string;
        scopes: readonly string[];
        expiresAt: string | null;
        metadata: Record<string, unknown>;
    },
): Promise<{ credential: ApiCredentialRecord; apiKey: string }> {
    const scopes = normalizeMachineCredentialScopes(input.scopes);
    if (scopes.length === 0) {
        throw new Error('At least one valid scope is required.');
    }

    const secret = createApiCredentialSecret(input.principalType);
    const C = API_CREDENTIALS.COLUMNS;
    const { data, error } = await client
        .from(API_CREDENTIALS.TABLE)
        .insert({
            [C.tenant_id]: input.tenantId,
            [C.principal_type]: input.principalType,
            [C.service_account_id]: input.serviceAccountId,
            [C.connector_installation_id]: input.connectorInstallationId,
            [C.label]: normalizeRequiredText(input.label, 'label'),
            [C.key_prefix]: secret.prefix,
            [C.key_hash]: secret.hash,
            [C.scopes]: scopes,
            [C.status]: 'active',
            [C.expires_at]: input.expiresAt,
            [C.metadata]: input.metadata,
            [C.created_by]: input.actor,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to issue API credential: ${error?.message ?? 'Unknown error'}`);
    }

    return {
        credential: mapApiCredential(data as Record<string, unknown>),
        apiKey: secret.plainKey,
    };
}

function createApiCredentialSecret(principalType: MachineCredentialPrincipalType): {
    plainKey: string;
    prefix: string;
    hash: string;
} {
    const seed = randomBytes(24).toString('hex');
    const plainKey = principalType === 'service_account'
        ? `vetios_sa_${seed}`
        : `vetios_ci_${seed}`;

    return {
        plainKey,
        prefix: plainKey.slice(0, 18),
        hash: createHash('sha256').update(plainKey).digest('hex'),
    };
}

async function getApiCredentialByPresentedKey(
    client: SupabaseClient,
    presentedKey: string,
): Promise<ApiCredentialRecord | null> {
    const C = API_CREDENTIALS.COLUMNS;
    const hash = createHash('sha256').update(presentedKey).digest('hex');
    const { data, error } = await client
        .from(API_CREDENTIALS.TABLE)
        .select('*')
        .eq(C.key_hash, hash)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to resolve API credential: ${error.message}`);
    }

    return data ? mapApiCredential(data as Record<string, unknown>) : null;
}

async function getServiceAccountById(
    client: SupabaseClient,
    tenantId: string,
    id: string,
): Promise<ServiceAccountRecord | null> {
    const C = SERVICE_ACCOUNTS.COLUMNS;
    const { data, error } = await client
        .from(SERVICE_ACCOUNTS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .eq(C.id, id)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to load service account: ${error.message}`);
    }

    return data ? mapServiceAccount(data as Record<string, unknown>) : null;
}

async function getConnectorInstallationById(
    client: SupabaseClient,
    tenantId: string,
    id: string,
): Promise<ConnectorInstallationRecord | null> {
    const C = CONNECTOR_INSTALLATIONS.COLUMNS;
    const { data, error } = await client
        .from(CONNECTOR_INSTALLATIONS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .eq(C.id, id)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to load connector installation: ${error.message}`);
    }

    return data ? mapConnectorInstallation(data as Record<string, unknown>) : null;
}

async function markCredentialUsage(
    client: SupabaseClient,
    credential: ApiCredentialRecord,
    serviceAccount: ServiceAccountRecord | null,
    connectorInstallation: ConnectorInstallationRecord | null,
): Promise<void> {
    const now = new Date().toISOString();
    const credentialColumns = API_CREDENTIALS.COLUMNS;

    await Promise.all([
        client
            .from(API_CREDENTIALS.TABLE)
            .update({
                [credentialColumns.last_used_at]: now,
            })
            .eq(credentialColumns.id, credential.id),
        serviceAccount
            ? client
                .from(SERVICE_ACCOUNTS.TABLE)
                .update({
                    [SERVICE_ACCOUNTS.COLUMNS.last_used_at]: now,
                })
                .eq(SERVICE_ACCOUNTS.COLUMNS.id, serviceAccount.id)
            : Promise.resolve(),
        connectorInstallation
            ? client
                .from(CONNECTOR_INSTALLATIONS.TABLE)
                .update({
                    [CONNECTOR_INSTALLATIONS.COLUMNS.last_used_at]: now,
                })
                .eq(CONNECTOR_INSTALLATIONS.COLUMNS.id, connectorInstallation.id)
            : Promise.resolve(),
    ]).catch(() => {
        // Best-effort usage tracking; auth success should not fail on telemetry updates.
    });
}

function extractPresentedApiKey(req: Request): string | null {
    const authorization = req.headers.get('authorization');
    const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
    const directKey = req.headers.get('x-vetios-api-key')?.trim() ?? null;
    const candidate = bearer ?? directKey;

    if (!candidate) {
        return null;
    }

    return candidate.length > 12 ? candidate : null;
}

function hasAllRequiredScopes(
    granted: readonly MachineCredentialScope[],
    required: readonly MachineCredentialScope[],
): boolean {
    if (required.length === 0) {
        return true;
    }

    const grantedSet = new Set(granted);
    return required.every((scope) => grantedSet.has(scope));
}

function mapServiceAccount(row: Record<string, unknown>): ServiceAccountRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        name: String(row.name),
        description: normalizeOptionalText(row.description),
        status: normalizeServiceAccountStatus(row.status),
        metadata: asRecord(row.metadata),
        created_by: normalizeOptionalText(row.created_by),
        last_used_at: normalizeOptionalText(row.last_used_at),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
    };
}

function mapConnectorInstallation(row: Record<string, unknown>): ConnectorInstallationRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        installation_name: String(row.installation_name),
        connector_type: String(row.connector_type),
        vendor_name: normalizeOptionalText(row.vendor_name),
        vendor_account_ref: normalizeOptionalText(row.vendor_account_ref),
        status: normalizeConnectorInstallationStatus(row.status),
        metadata: asRecord(row.metadata),
        created_by: normalizeOptionalText(row.created_by),
        last_used_at: normalizeOptionalText(row.last_used_at),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
    };
}

function mapApiCredential(row: Record<string, unknown>): ApiCredentialRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        principal_type: normalizePrincipalType(row.principal_type),
        service_account_id: normalizeOptionalText(row.service_account_id),
        connector_installation_id: normalizeOptionalText(row.connector_installation_id),
        label: String(row.label),
        key_prefix: String(row.key_prefix),
        key_hash: String(row.key_hash),
        scopes: normalizeMachineCredentialScopes(asStringArray(row.scopes)),
        status: normalizeCredentialStatus(row.status),
        expires_at: normalizeOptionalText(row.expires_at),
        metadata: asRecord(row.metadata),
        created_by: normalizeOptionalText(row.created_by),
        revoked_by: normalizeOptionalText(row.revoked_by),
        last_used_at: normalizeOptionalText(row.last_used_at),
        created_at: String(row.created_at),
        revoked_at: normalizeOptionalText(row.revoked_at),
    };
}

function normalizeRequiredText(value: unknown, field: string): string {
    const normalized = normalizeOptionalText(value);
    if (!normalized) {
        throw new Error(`${field} is required.`);
    }
    return normalized;
}

function normalizeOptionalText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizePrincipalType(value: unknown): MachineCredentialPrincipalType {
    return value === 'connector_installation' ? 'connector_installation' : 'service_account';
}

function normalizeServiceAccountStatus(value: unknown): ServiceAccountRecord['status'] {
    return value === 'disabled' || value === 'revoked' ? value : 'active';
}

function normalizeConnectorInstallationStatus(value: unknown): ConnectorInstallationRecord['status'] {
    return value === 'paused' || value === 'revoked' ? value : 'active';
}

function normalizeCredentialStatus(value: unknown): ApiCredentialRecord['status'] {
    return value === 'revoked' ? 'revoked' : 'active';
}

function mergeRecords(left: Record<string, unknown>, right: Record<string, unknown>): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...left };
    for (const [key, value] of Object.entries(right)) {
        if (value === undefined) {
            continue;
        }
        if (isRecord(value) && isRecord(merged[key])) {
            merged[key] = mergeRecords(merged[key] as Record<string, unknown>, value);
            continue;
        }
        merged[key] = value;
    }
    return merged;
}

function asRecord(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string')
        : [];
}
