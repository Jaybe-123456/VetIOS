import { createHash } from 'crypto';
import {
    validateCireConformanceReport,
    type CireConformanceReport,
    type CireConformanceResult,
} from '@vetios/cire-engine';
import { CIRE_STANDARD_VERSION } from './standard';

export const CIRE_CERTIFICATION_STATUSES = ['submitted', 'passed', 'failed', 'revoked', 'expired'] as const;
export const CIRE_CERTIFICATION_VERIFICATION_STATUSES = [
    'self_attested',
    'reviewer_verified',
    'signature_verified',
    'third_party_verified',
] as const;
export const CIRE_CONFORMANCE_RESULTS = ['passed', 'failed'] as const;

export type CireCertificationStatus = typeof CIRE_CERTIFICATION_STATUSES[number];
export type CireCertificationVerificationStatus = typeof CIRE_CERTIFICATION_VERIFICATION_STATUSES[number];
export type CireConformanceResultStatus = typeof CIRE_CONFORMANCE_RESULTS[number];

export interface CireCertificationInput {
    standardVersion?: string | null;
    implementationName: string;
    implementationVersion?: string | null;
    implementationUrl?: string | null;
    packageName?: string | null;
    repositoryUrl?: string | null;
    artifactUrl?: string | null;
    report: CireConformanceReport;
    verificationStatus?: CireCertificationVerificationStatus | null;
    publicListingEligible?: boolean | null;
    publicListingLabel?: string | null;
    signedPayloadHash?: string | null;
    signatureAlgorithm?: string | null;
    signatureHash?: string | null;
    signingKeyFingerprint?: string | null;
    limitations?: string | null;
}

export interface CireCertificationAssessment {
    standard_version: string;
    implementation_name: string;
    implementation_version: string | null;
    implementation_url: string | null;
    package_name: string | null;
    repository_url: string | null;
    artifact_url: string | null;
    certification_status: CireCertificationStatus;
    verification_status: CireCertificationVerificationStatus;
    conformance_result: CireConformanceResultStatus;
    total_checks: number;
    passed_checks: number;
    failed_checks: number;
    conformance_score: number;
    public_listing_eligible: boolean;
    public_listing_label: string | null;
    signed_payload_hash: string;
    signature_algorithm: string | null;
    signature_hash: string | null;
    signing_key_fingerprint: string | null;
    report: CireConformanceReport;
    validation: CireConformanceResult;
    limitations: string | null;
    blockers: string[];
}

export interface CireCertificationEventRow {
    id?: string | null;
    standard_version?: string | null;
    implementation_name?: string | null;
    implementation_version?: string | null;
    implementation_url?: string | null;
    package_name?: string | null;
    repository_url?: string | null;
    artifact_url?: string | null;
    certification_status?: string | null;
    verification_status?: string | null;
    conformance_result?: string | null;
    total_checks?: number | string | null;
    passed_checks?: number | string | null;
    failed_checks?: number | string | null;
    conformance_score?: number | string | null;
    public_listing_eligible?: boolean | null;
    public_listing_label?: string | null;
    signed_payload_hash?: string | null;
    signature_algorithm?: string | null;
    signature_hash?: string | null;
    signing_key_fingerprint?: string | null;
    observed_at?: string | null;
    created_at?: string | null;
}

export interface PublicCireCertificationListing {
    certification_id: string | null;
    standard_version: string;
    implementation_name: string;
    implementation_version: string | null;
    implementation_url: string | null;
    package_name: string | null;
    repository_url: string | null;
    certification_status: CireCertificationStatus;
    verification_status: CireCertificationVerificationStatus;
    conformance_score: number;
    total_checks: number;
    passed_checks: number;
    signed_payload_hash: string | null;
    observed_at: string | null;
}

export interface PublicCireCertificationRegistry {
    registry_key: 'vetios-cire-certification-registry';
    standard_version: typeof CIRE_STANDARD_VERSION;
    generated_at: string;
    summary: {
        listed_implementations: number;
        passed_certifications: number;
        verified_certifications: number;
        third_party_verified_certifications: number;
        average_conformance_score: number;
    };
    listings: PublicCireCertificationListing[];
}

const VERIFIED_STATUSES = new Set<CireCertificationVerificationStatus>([
    'reviewer_verified',
    'signature_verified',
    'third_party_verified',
]);

export function buildCireCertificationAssessment(input: CireCertificationInput): CireCertificationAssessment {
    const standardVersion = normalizeOptionalText(input.standardVersion) ?? input.report.standard_version ?? CIRE_STANDARD_VERSION;
    const validation = validateCireConformanceReport(input.report);
    const versionMatches = standardVersion === CIRE_STANDARD_VERSION && input.report.standard_version === CIRE_STANDARD_VERSION;
    const blockers = [
        ...(versionMatches ? [] : ['standard_version_mismatch']),
        ...(validation.passed ? [] : ['conformance_checks_failed']),
    ];
    const certificationStatus: CireCertificationStatus = blockers.length === 0 ? 'passed' : 'failed';
    const conformanceScore = validation.summary.total > 0
        ? roundScore(validation.summary.passed / validation.summary.total)
        : 0;
    const implementationName = normalizeRequiredText(input.implementationName, 'implementationName');
    const publicLabel = normalizeOptionalText(input.publicListingLabel) ?? implementationName;
    const publicListingEligible = Boolean(
        input.publicListingEligible
        && certificationStatus === 'passed'
        && publicLabel.length >= 3,
    );
    const signedPayloadHash = normalizeHash(input.signedPayloadHash) ?? hashStablePayload({
        standard_version: standardVersion,
        implementation_name: implementationName,
        implementation_version: input.implementationVersion ?? null,
        report: input.report,
        validation,
    });

    return {
        standard_version: standardVersion,
        implementation_name: implementationName,
        implementation_version: normalizeOptionalText(input.implementationVersion),
        implementation_url: normalizeOptionalText(input.implementationUrl),
        package_name: normalizeOptionalText(input.packageName),
        repository_url: normalizeOptionalText(input.repositoryUrl),
        artifact_url: normalizeOptionalText(input.artifactUrl),
        certification_status: certificationStatus,
        verification_status: input.verificationStatus ?? 'self_attested',
        conformance_result: validation.passed && versionMatches ? 'passed' : 'failed',
        total_checks: validation.summary.total,
        passed_checks: validation.summary.passed,
        failed_checks: validation.summary.failed,
        conformance_score: conformanceScore,
        public_listing_eligible: publicListingEligible,
        public_listing_label: publicListingEligible ? publicLabel : null,
        signed_payload_hash: signedPayloadHash,
        signature_algorithm: normalizeOptionalText(input.signatureAlgorithm),
        signature_hash: normalizeHash(input.signatureHash),
        signing_key_fingerprint: normalizeOptionalText(input.signingKeyFingerprint),
        report: input.report,
        validation,
        limitations: normalizeOptionalText(input.limitations),
        blockers,
    };
}

export function buildPublicCireCertificationRegistry(
    rows: CireCertificationEventRow[],
    generatedAt = new Date().toISOString(),
): PublicCireCertificationRegistry {
    const listings = rows
        .filter((row) => row.public_listing_eligible === true)
        .filter((row) => row.certification_status === 'passed' && row.conformance_result === 'passed')
        .map(mapPublicListing)
        .sort((left, right) => Date.parse(right.observed_at ?? '') - Date.parse(left.observed_at ?? ''));
    const scoreValues = listings.map((listing) => listing.conformance_score);

    return {
        registry_key: 'vetios-cire-certification-registry',
        standard_version: CIRE_STANDARD_VERSION,
        generated_at: generatedAt,
        summary: {
            listed_implementations: listings.length,
            passed_certifications: listings.filter((listing) => listing.certification_status === 'passed').length,
            verified_certifications: listings.filter((listing) => VERIFIED_STATUSES.has(listing.verification_status)).length,
            third_party_verified_certifications: listings.filter((listing) => listing.verification_status === 'third_party_verified').length,
            average_conformance_score: scoreValues.length > 0
                ? roundScore(scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length)
                : 0,
        },
        listings,
    };
}

function mapPublicListing(row: CireCertificationEventRow): PublicCireCertificationListing {
    return {
        certification_id: normalizeOptionalText(row.id),
        standard_version: normalizeOptionalText(row.standard_version) ?? CIRE_STANDARD_VERSION,
        implementation_name: normalizeOptionalText(row.public_listing_label)
            ?? normalizeOptionalText(row.implementation_name)
            ?? 'CIRE implementation',
        implementation_version: normalizeOptionalText(row.implementation_version),
        implementation_url: normalizeOptionalText(row.implementation_url),
        package_name: normalizeOptionalText(row.package_name),
        repository_url: normalizeOptionalText(row.repository_url),
        certification_status: normalizeCertificationStatus(row.certification_status),
        verification_status: normalizeVerificationStatus(row.verification_status),
        conformance_score: readScore(row.conformance_score),
        total_checks: readCount(row.total_checks),
        passed_checks: readCount(row.passed_checks),
        signed_payload_hash: normalizeHash(row.signed_payload_hash),
        observed_at: normalizeOptionalText(row.observed_at ?? row.created_at),
    };
}

function normalizeCertificationStatus(value: unknown): CireCertificationStatus {
    return CIRE_CERTIFICATION_STATUSES.includes(value as CireCertificationStatus)
        ? value as CireCertificationStatus
        : 'submitted';
}

function normalizeVerificationStatus(value: unknown): CireCertificationVerificationStatus {
    return CIRE_CERTIFICATION_VERIFICATION_STATUSES.includes(value as CireCertificationVerificationStatus)
        ? value as CireCertificationVerificationStatus
        : 'self_attested';
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

function normalizeHash(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function readCount(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
    }
    return 0;
}

function readScore(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return roundScore(value);
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? roundScore(parsed) : 0;
    }
    return 0;
}

function roundScore(value: number): number {
    return Math.max(0, Math.min(1, Math.round(value * 10_000) / 10_000));
}

function hashStablePayload(value: unknown): string {
    return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
    if (value == null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
