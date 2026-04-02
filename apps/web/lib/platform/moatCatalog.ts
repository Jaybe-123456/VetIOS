export type CapabilityStatus = 'implemented' | 'partial' | 'missing';

export interface PlatformCapabilityLink {
    label: string;
    href: string;
}

export interface PlatformLayerCapability {
    label: string;
    status: CapabilityStatus;
    summary: string;
    href?: string;
}

export interface PlatformLayerDefinition {
    id: string;
    label: string;
    accentClass: string;
    surfaceClass: string;
    capabilities: PlatformLayerCapability[];
}

export interface MoatCardDefinition {
    id: string;
    company: string;
    themeClass: string;
    status: CapabilityStatus;
    title: string;
    thesis: string;
    claim: string;
    availableNow: string[];
    missingNow: string[];
    links: PlatformCapabilityLink[];
}

export const platformLayers: PlatformLayerDefinition[] = [
    {
        id: 'consumer',
        label: 'Consumer layer',
        accentClass: 'bg-[#2563eb]',
        surfaceClass: 'border-[#93c5fd] bg-[#dbeafe]',
        capabilities: [
            {
                label: 'PetPass (pet owner app)',
                status: 'partial',
                summary: 'PetPass now has real owner accounts, pet links, timeline entries, and notification deliveries behind the preview surface.',
                href: '/platform/petpass',
            },
            {
                label: 'Clinic PetPass integration',
                status: 'partial',
                summary: 'Clinic-owner links, consent capture, and owner-pet relationships are now wired as network infrastructure.',
            },
            {
                label: 'Health history & alerts',
                status: 'partial',
                summary: 'Owner-facing timeline and alerts now have database-backed timeline and notification records, though full mobile distribution still needs productization.',
                href: '/platform/petpass',
            },
        ],
    },
    {
        id: 'clinical',
        label: 'Clinical layer',
        accentClass: 'bg-[#0f766e]',
        surfaceClass: 'border-[#5eead4] bg-[#d1fae5]',
        capabilities: [
            {
                label: 'Inference Console',
                status: 'implemented',
                summary: 'Structured, free-text, and JSON inference workflows are live.',
                href: '/inference',
            },
            {
                label: 'Outcome Learning',
                status: 'implemented',
                summary: 'Clinician validation, outcomes, and learning feedback loops are live.',
                href: '/outcome',
            },
            {
                label: 'Adversarial Sim',
                status: 'implemented',
                summary: 'Simulation and adversarial stress workflows are already exposed in-product.',
                href: '/simulate',
            },
        ],
    },
    {
        id: 'data-ml',
        label: 'Data & ML layer',
        accentClass: 'bg-[#7c3aed]',
        surfaceClass: 'border-[#c4b5fd] bg-[#ede9fe]',
        capabilities: [
            {
                label: 'Clinical Dataset',
                status: 'implemented',
                summary: 'Canonical case storage, curation, and export flows are present.',
                href: '/dataset',
            },
            {
                label: 'Experiment Track',
                status: 'implemented',
                summary: 'Run telemetry, calibration, adversarial metrics, and comparisons are present.',
                href: '/experiments',
            },
            {
                label: 'Model Registry',
                status: 'implemented',
                summary: 'Governed registry, promotion controls, rollback, and routing already exist.',
                href: '/models',
            },
        ],
    },
    {
        id: 'infrastructure',
        label: 'Infrastructure',
        accentClass: 'bg-[#0f172a]',
        surfaceClass: 'border-[#94a3b8] bg-[#e2e8f0]',
        capabilities: [
            {
                label: 'Telemetry',
                status: 'implemented',
                summary: 'Execution telemetry, observability, and live dashboard signals are wired.',
                href: '/telemetry',
            },
            {
                label: 'Network Intelligence',
                status: 'implemented',
                summary: 'Topology, routing, and governance-linked network intelligence are present.',
                href: '/intelligence',
            },
            {
                label: 'Edge Box (offline)',
                status: 'missing',
                summary: 'There is no offline edge appliance or sync layer in this repo yet.',
            },
        ],
    },
];

export const moatCards: MoatCardDefinition[] = [
    {
        id: 'developer-api',
        company: 'NVIDIA',
        themeClass: 'border-[#22c55e] bg-[#0f2f2d]',
        status: 'partial',
        title: 'VetIOS Developer API',
        thesis: 'CUDA ecosystem lock-in',
        claim: 'PIMS vendors build on it.',
        availableNow: [
            'Authenticated API routes already exist for inference, outcomes, simulation, evaluation, and passive connector ingest.',
            'A public developer portal and endpoint catalog now document the integration surface.',
        ],
        missingNow: [
            'No self-serve API keys, partner onboarding flow, or durable versioned public docs contract yet.',
            'Routes are still operator-first rather than productized for third-party vendors.',
        ],
        links: [
            { label: 'Developer Portal', href: '/platform/developers' },
            { label: 'Inference Console', href: '/inference' },
        ],
    },
    {
        id: 'petpass',
        company: 'APPLE',
        themeClass: 'border-[#8b5cf6] bg-[#221b4b]',
        status: 'partial',
        title: 'PetPass app',
        thesis: 'Two-sided consumer ecosystem',
        claim: 'Pet owners pull clinics toward VetIOS.',
        availableNow: [
            'A PetPass preview app now exists with owner alerts, history timeline, and clinic-linked care actions.',
            'Owner accounts, pet links, clinic-owner links, consent records, timeline entries, and notification deliveries now exist as real infrastructure.',
        ],
        missingNow: [
            'Invitation flows, consumer authentication, and mobile-grade owner distribution are still not implemented.',
            'The network substrate is real now, but the end-user app experience is still early rather than mass-market ready.',
        ],
        links: [
            { label: 'PetPass Preview', href: '/platform/petpass' },
        ],
    },
    {
        id: 'federated-learning',
        company: 'AWS',
        themeClass: 'border-[#3b82f6] bg-[#172554]',
        status: 'partial',
        title: 'Federated Outcome Learning',
        thesis: 'Data flywheel -> compounding moat',
        claim: 'The network gets smarter every case.',
        availableNow: [
            'Inference -> outcome -> dataset -> benchmark -> promotion loops are implemented.',
            'Outcome-linked learning cycles, calibration, adversarial evaluation, registry promotion, and a public learning snapshot are live.',
            'Federation memberships, tenant snapshot publishing, and weighted aggregation rounds now exist as real infrastructure.',
        ],
        missingNow: [
            'The current federation layer is coordinator-driven rather than privacy-preserving secure aggregation.',
            'Automated clinic enrollment, round scheduling, and hardened governance over cross-clinic participation still need productization.',
        ],
        links: [
            { label: 'Network Learning', href: '/platform/network-learning' },
            { label: 'Experiment Track', href: '/experiments' },
        ],
    },
    {
        id: 'inference-api',
        company: 'OPENAI',
        themeClass: 'border-[#f59e0b] bg-[#2b2628]',
        status: 'implemented',
        title: 'Inference API',
        thesis: 'Middleware everyone routes through',
        claim: 'All vet AI agents call VetIOS.',
        availableNow: [
            'Inference routing, telemetry, clinical integrity checks, and registry-aware model selection are live.',
            'The core POST /api/inference surface is already production-shaped.',
        ],
        missingNow: [
            'Broader agent ecosystem adoption still depends on external integrations, docs, and partner distribution.',
        ],
        links: [
            { label: 'Inference Console', href: '/inference' },
        ],
    },
    {
        id: 'passive-signal-engine',
        company: 'TESLA',
        themeClass: 'border-[#14b8a6] bg-[#123a47]',
        status: 'partial',
        title: 'Passive Signal Engine',
        thesis: 'Passive fleet data collection',
        claim: 'Clinics generate data by working.',
        availableNow: [
            'Passive connector normalization exists for lab results, rechecks, referrals, imaging, and medication refill signals.',
            'Episode reconciliation, a clinic workflow signal dock, and a published connector catalog are already built.',
        ],
        missingNow: [
            'Most connector ingestion is still manual or shared-secret based, not turnkey vendor sync at fleet scale.',
            'There is no connector marketplace, scheduler, or broad EHR/PIMS sync coverage yet.',
        ],
        links: [
            { label: 'Passive Signals', href: '/platform/passive-signals' },
        ],
    },
    {
        id: 'public-model-cards',
        company: 'ANTHROPIC',
        themeClass: 'border-[#ef4444] bg-[#341823]',
        status: 'partial',
        title: 'Public Model Cards',
        thesis: 'Transparency as trust moat',
        claim: 'Auditable, certified, trustworthy.',
        availableNow: [
            'Registry governance, gate status, blockers, and lineage already exist internally.',
            'A public read-only model card surface is added in this change so the registry can be shared externally.',
        ],
        missingNow: [
            'Formal certification, external attestations, and publication workflows are still not implemented.',
        ],
        links: [
            { label: 'Public Model Cards', href: '/platform/model-cards' },
            { label: 'Registry Control Plane', href: '/models' },
        ],
    },
];

export function countStatuses<T extends { status: CapabilityStatus }>(items: T[]): Record<CapabilityStatus, number> {
    return items.reduce<Record<CapabilityStatus, number>>((counts, item) => {
        counts[item.status] += 1;
        return counts;
    }, {
        implemented: 0,
        partial: 0,
        missing: 0,
    });
}

export function formatStatusLabel(status: CapabilityStatus): string {
    switch (status) {
        case 'implemented':
            return 'Implemented';
        case 'partial':
            return 'Partial';
        case 'missing':
            return 'Missing';
        default:
            return status;
    }
}
