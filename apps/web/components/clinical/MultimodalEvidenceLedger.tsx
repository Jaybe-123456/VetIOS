import type { CaseDetail } from '@/lib/cases/caseWorkflow';
import { formatClinicalLabel } from './clinicalTypes';

export function MultimodalEvidenceLedger({ clinicalCase }: { clinicalCase: CaseDetail }) {
    const voice = asRecord(clinicalCase.patient_metadata.voice_context);
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

    return (
        <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <EvidenceMetric label="Evidence types" value={evidenceCount} />
                <EvidenceMetric label="Lab values" value={labEntries.length} />
                <EvidenceMetric label="Vitals" value={vitalEntries.length} />
                <EvidenceMetric label="Exam facts" value={examEntries.length} />
                <EvidenceMetric label="Images" value={imageCount} />
            </div>

            {evidenceCount === 0 ? (
                <div className="rounded-md border border-white/10 bg-white/[0.025] p-4 text-sm leading-relaxed text-white/62">
                    No structured multimodal evidence is attached yet. Add labs, vitals, imaging references, or voice context to strengthen the dataset value of this case.
                </div>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-2">
                <EvidenceBlock title="Laboratory Evidence" empty="No lab values attached." entries={labEntries} />
                <EvidenceBlock title="Vitals" empty="No vitals attached." entries={vitalEntries} />
                <EvidenceBlock title="Physical Exam" empty="No structured exam facts attached." entries={examEntries} />
                <div className="rounded-md border border-white/10 bg-white/[0.025] p-4">
                    <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/48">Voice and imaging</div>
                    <div className="mt-3 space-y-3 text-sm text-white/72">
                        <div className="flex items-start justify-between gap-4 border-b border-white/8 pb-3">
                            <span className="text-white/48">Voice transcript</span>
                            <span className="max-w-[70%] text-right">{voiceTranscript ?? 'Not captured'}</span>
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

function EvidenceMetric({ label, value }: { label: string; value: number }) {
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
