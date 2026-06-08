import type { CaseDetail } from '@/lib/cases/caseWorkflow';
import type { ClinicalMultimodalArtifact } from '@/lib/multimodal/artifactLedger';
import { formatClinicalLabel } from './clinicalTypes';

export function MultimodalEvidenceLedger({ clinicalCase }: { clinicalCase: CaseDetail }) {
    const voice = asRecord(clinicalCase.patient_metadata.voice_context);
    const artifacts = clinicalCase.multimodal_artifacts ?? [];
    const labEntries = objectEntries(clinicalCase.labs);
    const vitalEntries = objectEntries(clinicalCase.vitals);
    const examEntries = objectEntries(clinicalCase.physical_exam);
    const imageCount = Array.isArray(clinicalCase.images) ? clinicalCase.images.length : 0;
    const voiceTranscript = readText(voice.raw_transcript);
    const voiceConfidence = readNumber(voice.extraction_confidence);
    const evidenceCount = [
        labEntries.length > 0,
        vitalEntries.length > 0,
        examEntries.length > 0,
        imageCount > 0,
        voiceTranscript !== null,
    ].filter(Boolean).length;
    const labeledArtifacts = artifacts.filter((artifact) => artifact.label_status === 'labeled');
    const averageQuality = average(artifacts.map((artifact) => artifact.evidence_quality_score));

    return (
        <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <EvidenceMetric label="Evidence types" value={evidenceCount} />
                <EvidenceMetric label="Ledger artifacts" value={artifacts.length} />
                <EvidenceMetric label="Outcome-labeled" value={labeledArtifacts.length} />
                <EvidenceMetric label="Dataset quality" value={averageQuality == null ? 'Pending' : `${Math.round(averageQuality * 100)}%`} />
                <EvidenceMetric label="Images" value={imageCount} />
            </div>

            {evidenceCount === 0 ? (
                <div className="rounded-md border border-white/10 bg-white/[0.025] p-4 text-sm leading-relaxed text-white/62">
                    No structured multimodal evidence is attached yet. Add labs, vitals, imaging references, or voice context to strengthen the dataset value of this case.
                </div>
            ) : null}

            <ArtifactLedgerBlock artifacts={artifacts} evidenceCount={evidenceCount} />

            <div className="grid gap-4 lg:grid-cols-2">
                <EvidenceBlock title="Laboratory Evidence" empty="No lab values attached." entries={labEntries} />
                <EvidenceBlock title="Vitals" empty="No vitals attached." entries={vitalEntries} />
                <EvidenceBlock title="Physical Exam" empty="No structured exam facts attached." entries={examEntries} />
                <div className="rounded-md border border-white/10 bg-white/[0.025] p-4">
                    <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/48">Voice and imaging</div>
                    <div className="mt-3 space-y-3 text-sm text-white/72">
                        <div className="flex items-start justify-between gap-4 border-b border-white/8 pb-3">
                            <span className="text-white/48">Voice capture</span>
                            <span className="max-w-[70%] text-right">{voiceTranscript ? 'Captured and hashed for dataset use' : 'Not captured'}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4 border-b border-white/8 pb-3">
                            <span className="text-white/48">Voice extraction confidence</span>
                            <span>{voiceConfidence == null ? 'Not scored' : `${Math.round(voiceConfidence * 100)}%`}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                            <span className="text-white/48">Imaging references</span>
                            <span>{imageCount > 0 ? `${imageCount} attached` : 'None attached'}</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="rounded-md border border-accent/20 bg-accent/[0.04] p-4 text-sm leading-relaxed text-white/70">
                Multimodal completeness matters: confirmed outcomes with labs, vitals, voice, and imaging references become higher-value validation rows than text-only cases.
            </div>
        </div>
    );
}

function ArtifactLedgerBlock({
    artifacts,
    evidenceCount,
}: {
    artifacts: ClinicalMultimodalArtifact[];
    evidenceCount: number;
}) {
    if (artifacts.length === 0) {
        return (
            <div className="rounded-md border border-accent/20 bg-accent/[0.035] p-4 text-sm leading-relaxed text-white/70">
                {evidenceCount > 0
                    ? 'Evidence is present. Once this case is confirmed, VetIOS will convert it into de-identified, outcome-labeled dataset artifacts.'
                    : 'No artifact ledger rows exist yet for this case.'}
            </div>
        );
    }

    return (
        <div className="rounded-md border border-accent/25 bg-accent/[0.04] p-4">
            <div className="flex flex-col gap-2 border-b border-accent/15 pb-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Dataset artifact ledger</div>
                    <p className="mt-2 text-sm leading-relaxed text-white/68">
                        De-identified evidence rows linked to this case outcome for validation and future model improvement.
                    </p>
                </div>
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/48">
                    {artifacts.length} rows
                </div>
            </div>
            <div className="mt-3 divide-y divide-white/8">
                {artifacts.slice(0, 8).map((artifact) => (
                    <div key={artifact.artifact_key} className="grid gap-2 py-3 text-sm sm:grid-cols-[1.2fr_0.8fr_0.6fr] sm:items-center">
                        <div>
                            <div className="font-semibold text-white">{formatArtifactType(artifact.artifact_type)}</div>
                            <div className="mt-1 text-xs text-white/45">
                                {artifact.confirmed_diagnosis
                                    ? `Labeled against ${artifact.confirmed_diagnosis}`
                                    : 'Awaiting confirmed outcome'}
                            </div>
                        </div>
                        <div className="text-white/68">{formatLabelStatus(artifact.label_status)}</div>
                        <div className="sm:text-right">
                            <span className="rounded-full border border-white/10 px-2 py-1 text-xs text-white/68">
                                Quality {Math.round(artifact.evidence_quality_score * 100)}%
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function EvidenceMetric({ label, value }: { label: string; value: number | string }) {
    return (
        <div className="rounded-md border border-white/10 bg-white/[0.025] p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/48">{label}</div>
            <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
        </div>
    );
}

function EvidenceBlock({ title, empty, entries }: { title: string; empty: string; entries: Array<[string, unknown]> }) {
    return (
        <div className="rounded-md border border-white/10 bg-white/[0.025] p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/48">{title}</div>
            {entries.length > 0 ? (
                <div className="mt-3 divide-y divide-white/8">
                    {entries.slice(0, 8).map(([key, value]) => (
                        <div key={key} className="flex items-start justify-between gap-4 py-2 text-sm">
                            <span className="text-white/48">{formatClinicalLabel(key)}</span>
                            <span className="max-w-[60%] text-right text-white/76">{formatEvidenceValue(value)}</span>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="mt-3 text-sm text-white/54">{empty}</p>
            )}
        </div>
    );
}

function objectEntries(value: Record<string, unknown>): Array<[string, unknown]> {
    return Object.entries(value)
        .filter(([, entry]) => entry !== null && entry !== undefined && String(entry).trim().length > 0)
        .sort(([a], [b]) => a.localeCompare(b));
}

function formatEvidenceValue(value: unknown): string {
    if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(formatEvidenceValue).join(', ');
    if (typeof value === 'object' && value !== null) return JSON.stringify(value);
    return String(value);
}

function formatArtifactType(value: ClinicalMultimodalArtifact['artifact_type']): string {
    switch (value) {
        case 'lab_panel':
            return 'Laboratory panel';
        case 'vitals':
            return 'Vitals';
        case 'physical_exam':
            return 'Physical exam';
        case 'imaging_reference':
            return 'Imaging reference';
        case 'voice_transcript':
            return 'Voice capture';
        case 'document_reference':
            return 'Diagnostic document';
        default:
            return formatClinicalLabel(value);
    }
}

function formatLabelStatus(value: ClinicalMultimodalArtifact['label_status']): string {
    switch (value) {
        case 'labeled':
            return 'Outcome-labeled';
        case 'suppressed':
            return 'Suppressed';
        case 'unlabeled':
        default:
            return 'Awaiting outcome';
    }
}

function average(values: number[]): number | null {
    const finite = values.filter((value) => Number.isFinite(value));
    if (finite.length === 0) return null;
    return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
