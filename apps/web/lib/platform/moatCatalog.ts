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
                status: 'implemented',
                summary: 'PetPass now has owner accounts, hashed invitations, invite acceptance, pet links, timeline entries, and notification deliveries behind the owner app surface.',
                href: '/platform/petpass',
            },
            {
                label: 'Clinic PetPass integration',
                status: 'implemented',
                summary: 'Clinic-owner links, one-time invite issuance, consent capture, and owner-pet relationships are now wired as network infrastructure.',
            },
            {
                label: 'Health history & alerts',
                status: 'implemented',
                summary: 'Owner-facing timeline and alerts now have database-backed timeline, notification, and invite-activation records.',
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
                label: 'Outcome Data Snapshot Ledger',
                status: 'implemented',
                summary: 'Confirmed-case collection now writes append-only daily snapshots for validation readiness, closure rate, label coverage, and de-identified learning signals.',
                href: '/cases',
            },
            {
                label: 'Patient Timeline Memory',
                status: 'implemented',
                summary: 'Case detail pages now surface longitudinal patient context, confirmed diagnosis history, and append-only timeline events.',
                href: '/cases',
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
                label: 'Multimodal Artifact Ledger',
                status: 'implemented',
                summary: 'Confirmed cases now produce de-identified, append-only evidence artifacts from labs, vitals, exam facts, imaging references, and voice capture.',
                href: '/cases',
            },
            {
                label: 'Experiment Track',
                status: 'implemented',
                summary: 'Dataset versions, hyperparameter records, model lineage, and comparisons now operate as one reproducible AI research stack.',
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
                status: 'implemented',
                summary: 'Edge boxes now have registry, sync jobs, staged artifacts, hashed device credentials, rotation, revocation, expiry, and sync-auth last-use telemetry.',
                href: '/platform/edge-box',
            },
            {
                label: 'Population Intelligence',
                status: 'implemented',
                summary: 'Aggregate outbreak signals now produce privacy-gated public-health advisories with minimum clinic thresholds and public JSON output.',
                href: '/platform/population-intelligence',
            },
        ],
    },
];

export const moatCards: MoatCardDefinition[] = [
    {
        id: 'outcome-data',
        company: 'TESLA',
        themeClass: 'border-[#34d399] bg-[#11352b]',
        status: 'implemented',
        title: 'Outcome Data Flywheel',
        thesis: 'Confirmed diagnoses become a proprietary validation asset',
        claim: 'Each closed case strengthens VetIOS calibration, benchmark evidence, and future learning loops.',
        availableNow: [
            'Clinical cases already collect confirmed diagnoses, pending outcomes, label coverage, and learning-ready counts in the workspace.',
            'A daily append-only outcome snapshot ledger now stores validation progress, closure rates, overdue backlog, top labels, and de-identified learning signals.',
            'The case-closure cron now writes outcome moat snapshots even when no open-case alert is needed, creating durable longitudinal evidence.',
            'A clinical API now exposes the latest snapshot and live counters with explicit privacy boundaries for patient names, owner contacts, microchip IDs, and raw symptom text.',
        ],
        missingNow: [
            'The technical outcome-data moat is implemented; remaining work is higher-volume real clinic usage, external validation cohorts, and measured confirmation-rate lift over time.',
        ],
        links: [
            { label: 'Clinical Cases', href: '/cases' },
            { label: 'Outcome Data API', href: '/api/clinical/outcome-data' },
            { label: 'Outcome Closure', href: '/outcome' },
        ],
    },
    {
        id: 'switching-cost',
        company: 'EPIC',
        themeClass: 'border-[#10b981] bg-[#12352b]',
        status: 'implemented',
        title: 'Clinical Memory Switching Cost',
        thesis: 'Longitudinal context makes VetIOS hard to leave',
        claim: 'The more cases a clinic closes, the more patient memory VetIOS owns.',
        availableNow: [
            'Case detail pages now show a patient timeline with current case context, confirmed diagnosis events, and longitudinal visit records.',
            'Outcome confirmation now writes append-only patient timeline events tied to a hashed patient key rather than raw patient or owner identifiers.',
            'The timeline ledger groups future visits by stable de-identified patient identity and carries event type, summary, source module, and clinical payload lineage.',
            'The clinical workspace now presents longitudinal memory next to reliability, model trust, multimodal evidence, outcome closure, and SOAP output.',
        ],
        missingNow: [
            'The technical switching-cost moat is implemented; remaining work is deeper historical imports, PIMS record backfill, enterprise export controls, and months of real clinic usage.',
        ],
        links: [
            { label: 'Clinical Cases', href: '/cases' },
            { label: 'Longitudinal API', href: '/api/longitudinal' },
        ],
    },
    {
        id: 'multimodal-dataset',
        company: 'DATADOG',
        themeClass: 'border-[#a855f7] bg-[#25153c]',
        status: 'implemented',
        title: 'Multimodal Dataset Moat',
        thesis: 'Workflow evidence becomes proprietary training data',
        claim: 'Every confirmed case can compound the dataset beyond text-only notes.',
        availableNow: [
            'Case detail pages now surface a de-identified multimodal artifact ledger instead of only showing attached evidence.',
            'Outcome confirmation now creates append-only artifact rows for labs, vitals, physical exam facts, imaging references, voice capture, and diagnostic documents.',
            'Voice transcripts and imaging references are hashed or summarized before storage, while owner identifiers, contacts, microchip IDs, URLs, and raw transcripts are suppressed.',
            'Artifact rows carry label status, confirmed diagnosis lineage, evidence quality score, source citations, and immutable audit behavior.',
        ],
        missingNow: [
            'The technical multimodal moat is implemented; remaining work is higher-volume clinic usage, richer image/lab ingestion partnerships, and external dataset validation.',
        ],
        links: [
            { label: 'Clinical Cases', href: '/cases' },
            { label: 'Dataset Workspace', href: '/dataset' },
        ],
    },
    {
        id: 'developer-api',
        company: 'NVIDIA',
        themeClass: 'border-[#22c55e] bg-[#0f2f2d]',
        status: 'implemented',
        title: 'VetIOS Developer API',
        thesis: 'CUDA ecosystem lock-in',
        claim: 'PIMS vendors build on it.',
        availableNow: [
            'Authenticated API routes already exist for inference, outcomes, simulation, evaluation, and passive connector ingest.',
            'A public developer portal, published API products, and endpoint catalog now document the integration surface.',
            'Self-serve onboarding intake and admin-issued partner machine credentials now exist in the control plane.',
            'Partner billing plans, quota counters, billable usage events, lifecycle analytics, and rate-limit headers now live in the normal migration chain.',
            'A versioned public developer contract now exposes API auth, scopes, quota headers, plans, endpoint examples, and generated JSON/YAML OpenAPI from the same source of truth.',
        ],
        missingNow: [
            'The technical moat is implemented; the remaining work is external SDK distribution, partner adoption, and production traffic validation.',
        ],
        links: [
            { label: 'Developer Portal', href: '/platform/developers' },
            { label: 'Developer Contract', href: '/api/public/developer-contract' },
            { label: 'Developer Ops', href: '/settings/developer-platform' },
            { label: 'Inference Console', href: '/inference' },
        ],
    },
    {
        id: 'petpass',
        company: 'APPLE',
        themeClass: 'border-[#8b5cf6] bg-[#221b4b]',
        status: 'implemented',
        title: 'PetPass app',
        thesis: 'Two-sided consumer ecosystem',
        claim: 'Pet owners pull clinics toward VetIOS.',
        availableNow: [
            'A PetPass preview app now exists with owner alerts, history timeline, and clinic-linked care actions.',
            'Owner accounts, pet links, clinic-owner links, consent records, timeline entries, and notification deliveries now exist as real infrastructure.',
            'Clinics can now issue hashed one-time PetPass invitations, and owners can accept through a mobile web flow that activates their owner record.',
            'Accepted owners receive an owner-safe PetPass snapshot with linked pets, clinic links, health timeline, alerts, consents, and preferences.',
        ],
        missingNow: [
            'The technical consumer moat is implemented; remaining work is native app packaging, app-store distribution, and broad owner adoption.',
        ],
        links: [
            { label: 'PetPass Preview', href: '/platform/petpass' },
            { label: 'Invite Acceptance', href: '/petpass/invite' },
        ],
    },
    {
        id: 'federated-learning',
        company: 'AWS',
        themeClass: 'border-[#3b82f6] bg-[#172554]',
        status: 'implemented',
        title: 'Federated Outcome Learning',
        thesis: 'Data flywheel -> compounding moat',
        claim: 'The network gets smarter every case.',
        availableNow: [
            'Inference -> outcome -> dataset -> benchmark -> promotion loops are implemented.',
            'Experiment Track now stores dataset versions, hyperparameters, model lineage, and comparison evidence so published results can be independently reproduced.',
            'Outcome-linked learning cycles, calibration, adversarial evaluation, registry promotion, and a public learning snapshot are live.',
            'Federation memberships, tenant snapshot publishing, and weighted aggregation rounds now exist as real infrastructure.',
            'Coordinator governance now enforces allow-list enrollment, benchmark and calibration gates, and automated federation round scheduling.',
            'Secure aggregation commitments now store masked per-site contribution hashes while suppressing raw site-delta artifacts from completed federation rounds.',
        ],
        missingNow: [
            'The technical federation moat is implemented; remaining work is external participant adoption, independent privacy review, and real multi-clinic traffic.',
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
        status: 'implemented',
        title: 'Passive Signal Engine',
        thesis: 'Passive fleet data collection',
        claim: 'Clinics generate data by working.',
        availableNow: [
            'Passive connector normalization exists for lab results, rechecks, referrals, imaging, and medication refill signals.',
            'Episode reconciliation, a clinic workflow signal dock, and a published connector catalog are already built.',
            'Connector marketplace packs, installation-scoped connector credentials, and scheduled passive sync execution are now live.',
            'Native vendor adapter connections, OAuth-style callback handling, credential hashing, adapter runtime dispatch, and native sync run ledgers now exist for PIMS, lab, pharmacy, and imaging vendors.',
        ],
        missingNow: [
            'The technical passive-signal moat is implemented; remaining work is vendor contract approval, real native endpoint credentials, and production traffic across clinic systems.',
        ],
        links: [
            { label: 'Passive Signals', href: '/platform/passive-signals' },
        ],
    },
    {
        id: 'public-model-cards',
        company: 'ANTHROPIC',
        themeClass: 'border-[#ef4444] bg-[#341823]',
        status: 'implemented',
        title: 'Public Model Cards',
        thesis: 'Transparency as trust moat',
        claim: 'Auditable, certified, trustworthy.',
        availableNow: [
            'Registry governance, gate status, blockers, and lineage already exist internally.',
            'A public read-only model card surface is added in this change so the registry can be shared externally.',
            'Publication records, certifications, and attestations now exist behind the trust surface.',
            'External attestations can now carry signed payload hashes, signature hashes, signing-key fingerprints, and verification status for public trust review.',
            'Third-party evidence systems can now submit signed attestation evidence through an authenticated automated ingestion endpoint with idempotent intake and Trust Ops review.',
        ],
        missingNow: [
            'The technical trust surface is implemented; the remaining work is external issuer adoption and real third-party certification partnerships.',
        ],
        links: [
            { label: 'Public Model Cards', href: '/platform/model-cards' },
            { label: 'Trust Ops', href: '/settings/model-trust' },
            { label: 'Registry Control Plane', href: '/models' },
        ],
    },
    {
        id: 'population-intelligence',
        company: 'BLOOMBERG',
        themeClass: 'border-[#06b6d4] bg-[#123047]',
        status: 'implemented',
        title: 'Population Intelligence',
        thesis: 'Proprietary signal network',
        claim: 'Aggregate case flow becomes regional disease intelligence.',
        availableNow: [
            'Population disease signals, outbreak detection, and heatmap generation already operate across de-identified case flow.',
            'Public-health advisories now publish only aggregate signals that meet a minimum clinic threshold.',
            'A public API and platform page expose advisory summaries, severity, affected region/species, recommended actions, and privacy boundaries.',
            'The advisory ledger is append-only, so public population intelligence has auditable publication lineage.',
        ],
        missingNow: [
            'The technical population-intelligence moat is implemented; remaining work is larger clinic coverage, association adoption, and public-health partner validation.',
        ],
        links: [
            { label: 'Population Intelligence', href: '/platform/population-intelligence' },
            { label: 'Public Feed', href: '/api/public/population-intelligence' },
            { label: 'Internal Report', href: '/api/population-signal/report' },
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
