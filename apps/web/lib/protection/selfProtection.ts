import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { getConfiguredSiteOrigin, isPreviewHostname } from '@/lib/site';
import { getAuthorisedOriginList, isAuthorisedOrigin } from './originGuard';

const DEFAULT_ATTESTATION_MAX_AGE_MS = 5 * 60 * 1000;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export type VetiosProtectionRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface VetiosProtectionSignal {
    id: string;
    severity: VetiosProtectionRiskLevel;
    description: string;
    evidence?: Record<string, string | number | boolean | null>;
}

export interface VetiosSecurityAssessment {
    allowed: boolean;
    blocked: boolean;
    risk_score: number;
    risk_level: VetiosProtectionRiskLevel;
    clone_suspected: boolean;
    signals: VetiosProtectionSignal[];
    actions: string[];
    protection_headers: Record<string, string>;
}

export interface VetiosSelfProtectionPosture {
    posture_id: 'vetios_self_protection';
    mode: 'enforcing' | 'report_only';
    clone_defense: 'active' | 'degraded';
    attack_resistance: 'active' | 'degraded';
    attestation_secret_configured: boolean;
    authorised_origins: string[];
    layers: Array<{
        id: string;
        label: string;
        status: 'active' | 'degraded';
        control: string;
    }>;
}

export interface ClientAttestationPayload {
    origin: string;
    path: string;
    method: string;
    issued_at: number;
    nonce: string;
}

export interface VerifyClientAttestationResult {
    ok: boolean;
    reason: string | null;
    payload: ClientAttestationPayload | null;
}

export function buildVetiosSelfProtectionPosture(): VetiosSelfProtectionPosture {
    const strictOrigin = process.env.VETIOS_STRICT_ORIGIN_GUARD === 'true';
    const reportOnly = process.env.VETIOS_PROTECTION_REPORT_ONLY !== 'false' && !strictOrigin;
    const attestationSecretConfigured = Boolean(resolveAttestationSecret());

    return {
        posture_id: 'vetios_self_protection',
        mode: reportOnly ? 'report_only' : 'enforcing',
        clone_defense: attestationSecretConfigured ? 'active' : 'degraded',
        attack_resistance: 'active',
        attestation_secret_configured: attestationSecretConfigured,
        authorised_origins: getAuthorisedOriginList(),
        layers: [
            {
                id: 'origin_binding',
                label: 'Origin-bound API surface',
                status: 'active',
                control: 'Rejects or flags browser requests from domains outside the VetIOS allowlist.',
            },
            {
                id: 'machine_credentials',
                label: 'Scoped machine credentials',
                status: 'active',
                control: 'Requires scoped service-account or connector credentials for non-session clinical APIs.',
            },
            {
                id: 'rate_and_size_limits',
                label: 'Rate and body-size protection',
                status: 'active',
                control: 'Limits request frequency and payload size before handlers run.',
            },
            {
                id: 'client_attestation',
                label: 'Clone-resistant client attestation',
                status: attestationSecretConfigured ? 'active' : 'degraded',
                control: 'Signs short-lived origin/path/method attestations so copied frontends cannot silently impersonate VetIOS.',
            },
            {
                id: 'output_fingerprints',
                label: 'Inference output fingerprints',
                status: process.env.VETIOS_FINGERPRINT_KEY ? 'active' : 'degraded',
                control: 'Watermarks intelligence outputs so copied answers can be traced to a tenant/session/request.',
            },
            {
                id: 'audit_chain',
                label: 'Security and clinical audit chain',
                status: 'active',
                control: 'Records request IDs, hashed network signals, block reasons, fingerprints, and protection events.',
            },
            {
                id: 'evidence_source_safety',
                label: 'RAG evidence source safety',
                status: 'active',
                control: 'Blocks private/local source URLs and preserves trust tiers so injected sources cannot become high-authority evidence.',
            },
        ],
    };
}

export function assessVetiosSelfProtectionRequest(
    req: Request,
    options: {
        enforceOrigin?: boolean;
        requireClientAttestation?: boolean;
        nowMs?: number;
    } = {},
): VetiosSecurityAssessment {
    const signals: VetiosProtectionSignal[] = [];
    const actions: string[] = [];
    const nowMs = options.nowMs ?? Date.now();
    const method = req.method.toUpperCase();
    const url = new URL(req.url);
    const origin = normalizeOrigin(req.headers.get('origin'));
    const refererOrigin = normalizeOrigin(req.headers.get('referer'));
    const host = normalizeHost(req.headers.get('host') ?? url.host);
    const configuredHost = configuredSiteHost();
    const hasCredential = hasMachineCredential(req);
    const strictOrigin = options.enforceOrigin ?? process.env.VETIOS_STRICT_ORIGIN_GUARD === 'true';
    const requireClientAttestation = options.requireClientAttestation
        ?? process.env.VETIOS_STRICT_CLIENT_ATTESTATION === 'true';

    let riskScore = 0;
    let blocked = false;

    const addSignal = (signal: VetiosProtectionSignal, score: number, block = false) => {
        signals.push(signal);
        riskScore += score;
        blocked = blocked || block;
    };

    if (origin && !isAuthorisedOrigin(origin)) {
        addSignal({
            id: 'origin_not_authorised',
            severity: 'critical',
            description: 'Browser request origin is outside the VetIOS authorised-origin allowlist.',
            evidence: { origin, path: url.pathname },
        }, 80, strictOrigin);
        actions.push(strictOrigin ? 'blocked_unknown_origin' : 'report_unknown_origin');
    }

    if (configuredHost && host && host !== configuredHost && !isPreviewHostname(host) && !isLocalDevHost(host)) {
        addSignal({
            id: 'host_mismatch',
            severity: 'high',
            description: 'Request host does not match the configured VetIOS site host.',
            evidence: { host, configured_host: configuredHost },
        }, 35, strictOrigin);
        actions.push(strictOrigin ? 'blocked_host_mismatch' : 'report_host_mismatch');
    }

    if (MUTATING_METHODS.has(method) && origin && refererOrigin && origin !== refererOrigin) {
        addSignal({
            id: 'referer_origin_mismatch',
            severity: 'medium',
            description: 'Mutating browser request has a referer origin that differs from the Origin header.',
            evidence: { origin, referer_origin: refererOrigin, method },
        }, 25);
        actions.push('audit_referer_mismatch');
    }

    if (MUTATING_METHODS.has(method) && origin && requireClientAttestation) {
        const token = req.headers.get('x-vetios-client-attestation');
        const verified = verifyClientAttestation(token, {
            origin,
            path: url.pathname,
            method,
            nowMs,
        });
        if (!verified.ok) {
            addSignal({
                id: 'client_attestation_invalid',
                severity: 'critical',
                description: 'Mutating browser request did not present a valid short-lived VetIOS client attestation.',
                evidence: { reason: verified.reason, method, path: url.pathname },
            }, 75, true);
            actions.push('blocked_invalid_client_attestation');
        }
    }

    if (looksAutomated(req.headers.get('user-agent')) && !hasCredential) {
        addSignal({
            id: 'automation_without_machine_credential',
            severity: 'medium',
            description: 'Automation-like client did not present a VetIOS machine credential.',
            evidence: { has_credential: false },
        }, 20);
        actions.push('audit_uncredentialed_automation');
    }

    if (!resolveAttestationSecret()) {
        addSignal({
            id: 'client_attestation_secret_missing',
            severity: 'medium',
            description: 'Client attestation is not fully active because no attestation secret is configured.',
        }, 15);
        actions.push('configure_vetios_client_attestation_secret');
    }

    const clampedRisk = Math.min(100, riskScore);
    const riskLevel = riskLevelFromScore(clampedRisk);
    const cloneSuspected = signals.some((signal) =>
        signal.id === 'origin_not_authorised' ||
        signal.id === 'host_mismatch' ||
        signal.id === 'client_attestation_invalid',
    );

    if (!blocked && signals.length === 0) {
        actions.push('allow_request');
    }

    return {
        allowed: !blocked,
        blocked,
        risk_score: clampedRisk,
        risk_level: riskLevel,
        clone_suspected: cloneSuspected,
        signals,
        actions,
        protection_headers: buildProtectionHeaders({
            riskLevel,
            cloneSuspected,
            mode: blocked ? 'enforcing' : process.env.VETIOS_PROTECTION_REPORT_ONLY === 'false' ? 'enforcing' : 'report_only',
        }),
    };
}

export function createClientAttestation(input: {
    origin: string;
    path: string;
    method?: string;
    issuedAtMs?: number;
    nonce?: string;
    secret?: string;
}): string {
    const secret = input.secret ?? resolveAttestationSecret();
    if (!secret) {
        throw new Error('VetIOS client attestation secret is not configured.');
    }

    const payload: ClientAttestationPayload = {
        origin: normalizeOrigin(input.origin) ?? input.origin,
        path: normalizePath(input.path) ?? '/',
        method: (input.method ?? '*').toUpperCase(),
        issued_at: input.issuedAtMs ?? Date.now(),
        nonce: input.nonce ?? randomBytes(12).toString('base64url'),
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = signAttestation(encoded, secret);
    return `vca1.${encoded}.${signature}`;
}

export function verifyClientAttestation(
    token: string | null | undefined,
    expected: {
        origin?: string | null;
        path?: string | null;
        method?: string | null;
        nowMs?: number;
        maxAgeMs?: number;
        secret?: string;
    } = {},
): VerifyClientAttestationResult {
    const secret = expected.secret ?? resolveAttestationSecret();
    if (!secret) {
        return { ok: false, reason: 'attestation_secret_missing', payload: null };
    }
    if (!token) {
        return { ok: false, reason: 'attestation_missing', payload: null };
    }

    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'vca1') {
        return { ok: false, reason: 'attestation_malformed', payload: null };
    }

    const [, encoded, signature] = parts;
    const expectedSignature = signAttestation(encoded, secret);
    if (!constantTimeEqual(signature, expectedSignature)) {
        return { ok: false, reason: 'attestation_signature_invalid', payload: null };
    }

    let payload: ClientAttestationPayload;
    try {
        payload = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as ClientAttestationPayload;
    } catch {
        return { ok: false, reason: 'attestation_payload_invalid', payload: null };
    }
    if (
        typeof payload.origin !== 'string' ||
        typeof payload.path !== 'string' ||
        typeof payload.method !== 'string' ||
        typeof payload.issued_at !== 'number' ||
        typeof payload.nonce !== 'string'
    ) {
        return { ok: false, reason: 'attestation_payload_invalid', payload: null };
    }

    const nowMs = expected.nowMs ?? Date.now();
    const maxAgeMs = expected.maxAgeMs ?? DEFAULT_ATTESTATION_MAX_AGE_MS;
    if (!Number.isFinite(payload.issued_at) || payload.issued_at > nowMs + 30_000) {
        return { ok: false, reason: 'attestation_issued_at_invalid', payload };
    }
    if (nowMs - payload.issued_at > maxAgeMs) {
        return { ok: false, reason: 'attestation_expired', payload };
    }

    const expectedOrigin = normalizeOrigin(expected.origin);
    if (expectedOrigin && normalizeOrigin(payload.origin) !== expectedOrigin) {
        return { ok: false, reason: 'attestation_origin_mismatch', payload };
    }

    const expectedPath = normalizePath(expected.path);
    if (expectedPath && normalizePath(payload.path) !== expectedPath) {
        return { ok: false, reason: 'attestation_path_mismatch', payload };
    }

    const expectedMethod = expected.method?.toUpperCase() ?? null;
    if (expectedMethod && payload.method !== '*' && payload.method.toUpperCase() !== expectedMethod) {
        return { ok: false, reason: 'attestation_method_mismatch', payload };
    }

    return { ok: true, reason: null, payload };
}

export function buildProtectionHeaders(input: {
    riskLevel?: VetiosProtectionRiskLevel;
    cloneSuspected?: boolean;
    mode?: 'enforcing' | 'report_only';
} = {}): Record<string, string> {
    return {
        'x-vetios-protection': input.mode ?? 'report_only',
        'x-vetios-risk-level': input.riskLevel ?? 'low',
        'x-vetios-clone-defense': input.cloneSuspected ? 'suspected' : 'origin-bound',
        'x-vetios-security-model': 'origin+attestation+credential+fingerprint+audit',
    };
}

function resolveAttestationSecret(): string | null {
    const secret =
        process.env.VETIOS_CLIENT_ATTESTATION_SECRET ||
        process.env.VETIOS_FINGERPRINT_KEY ||
        process.env.VETIOS_INTERNAL_API_TOKEN ||
        null;
    return secret && secret.length >= 24 ? secret : null;
}

function signAttestation(encodedPayload: string, secret: string): string {
    return createHmac('sha256', secret).update(encodedPayload).digest('hex').slice(0, 32);
}

function constantTimeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeOrigin(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    if (!trimmed) {
        return null;
    }
    try {
        return new URL(trimmed).origin;
    } catch {
        return null;
    }
}

function normalizePath(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    if (!trimmed) {
        return null;
    }
    try {
        return new URL(trimmed, 'https://vetios.tech').pathname;
    } catch {
        return null;
    }
}

function normalizeHost(value: string | null | undefined): string | null {
    const trimmed = value?.trim().toLowerCase();
    if (!trimmed) {
        return null;
    }
    return trimmed.split(':')[0] ?? null;
}

function configuredSiteHost(): string | null {
    const origin = getConfiguredSiteOrigin();
    return origin ? normalizeHost(new URL(origin).host) : null;
}

function hasMachineCredential(req: Request): boolean {
    const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    return Boolean(
        (bearer && bearer.length > 12) ||
        req.headers.get('x-vetios-api-key')?.trim() ||
        req.headers.get('x-vetios-connector-key')?.trim(),
    );
}

function looksAutomated(userAgent: string | null): boolean {
    if (!userAgent) {
        return false;
    }
    return /\b(curl|wget|python-requests|aiohttp|httpx|axios|node-fetch|go-http-client|postmanruntime)\b/i.test(userAgent);
}

function riskLevelFromScore(score: number): VetiosProtectionRiskLevel {
    if (score >= 80) return 'critical';
    if (score >= 50) return 'high';
    if (score >= 20) return 'medium';
    return 'low';
}

function isLocalDevHost(host: string): boolean {
    return host === 'localhost' || host === '127.0.0.1';
}
