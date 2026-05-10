'use client';

import { useMemo } from 'react';
import { LineChart, Line, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { GitBranch, Download } from 'lucide-react';

interface RankedDiagnosis {
    name: string;
    confidence: number;
    probability?: number;
    reasoning?: string;
}

interface ConversationMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    metadata?: {
        mode?: string;
        diagnosis_ranked?: RankedDiagnosis[];
    };
}

interface DifferentialDriftPanelProps {
    messageId: string;
    messageTimestamp: number;
    conversationMessages: ConversationMessage[];
}

interface DriftPoint {
    turn: number;
    label: string;
    trigger: string;
    diagnoses: RankedDiagnosis[];
    signature: CaseSignature;
}

const LINE_COLORS = ['#00FF88', '#35D8FF', '#FF9F43', '#B05CFF', '#FFD84D'];

interface CaseSignature {
    species: string | null;
    domain: string | null;
}

function summarizePrompt(prompt: string) {
    const compact = prompt.replace(/\s+/g, ' ').trim();
    if (compact.length <= 72) return compact;
    return `${compact.slice(0, 72)}...`;
}

function buildDriftPoints(messages: ConversationMessage[], messageTimestamp: number, messageId: string): DriftPoint[] {
    const scopedMessages = messages.filter((message) => message.timestamp < messageTimestamp || message.id === messageId);

    const points = scopedMessages.flatMap((message, index) => {
        if (message.role !== 'assistant' || message.metadata?.mode !== 'clinical' || !message.metadata.diagnosis_ranked?.length) {
            return [];
        }

        const previousUser = [...scopedMessages.slice(0, index)].reverse().find((entry) => entry.role === 'user');
        const trigger = previousUser ? summarizePrompt(previousUser.content) : 'Initial case framing';
        const diagnoses = normalizeRankedDiagnoses(message.metadata.diagnosis_ranked);
        return [{
            turn: index + 1,
            label: `T${index + 1}`,
            trigger,
            diagnoses,
            signature: buildCaseSignature(trigger, diagnoses),
        }];
    });

    const currentPoint = points.find((point) => point.turn === scopedMessages.findIndex((message) => message.id === messageId) + 1)
        ?? points[points.length - 1];
    if (!currentPoint) return [];
    return points.filter((point) => point === currentPoint || sameCaseSignature(point.signature, currentPoint.signature));
}

function normalizeRankedDiagnoses(diagnoses: RankedDiagnosis[]): RankedDiagnosis[] {
    return diagnoses.map((diagnosis) => ({
        ...diagnosis,
        confidence: Number.isFinite(diagnosis.confidence)
            ? diagnosis.confidence
            : Number.isFinite(diagnosis.probability)
                ? Number(diagnosis.probability)
                : 0,
    }));
}

function buildCaseSignature(trigger: string, diagnoses: RankedDiagnosis[]): CaseSignature {
    const text = `${trigger} ${diagnoses.map((diagnosis) => diagnosis.name).join(' ')}`.toLowerCase();
    return {
        species: detectCaseSpecies(text),
        domain: detectCaseDomain(text),
    };
}

function detectCaseSpecies(text: string): string | null {
    if (/\b(cat|cats|kitten|feline)\b/.test(text) || /feline/.test(text)) return 'feline';
    if (/\b(dog|dogs|puppy|canine)\b/.test(text) || /canine/.test(text)) return 'canine';
    if (/\b(horse|horses|equine|glanders|equine influenza)\b/.test(text)) return 'equine';
    if (/\b(cow|cattle|calf|bovine|east coast fever)\b/.test(text)) return 'bovine';
    return null;
}

function detectCaseDomain(text: string): string | null {
    if (/nasal|sneez|respiratory|rhinitis|sinusitis|cough|airway|herpesvirus|calicivirus|glanders|equine influenza/.test(text)) return 'respiratory';
    if (/vomit|diarrh|gastroenteritis|abdominal|fecal|faecal/.test(text)) return 'gastrointestinal';
    if (/east coast fever|tick|vector|hemoparasite|piroplasm/.test(text)) return 'vector_borne';
    if (/urinary|urinat|polyuria|polydipsia/.test(text)) return 'urinary';
    return null;
}

function sameCaseSignature(left: CaseSignature, right: CaseSignature): boolean {
    if (left.species && right.species && left.species !== right.species) return false;
    if (left.domain && right.domain && left.domain !== right.domain) return false;
    if (right.species && !left.species) return false;
    if (right.domain && !left.domain) return false;
    return true;
}

function buildReasoningShift(previous: DriftPoint | null, current: DriftPoint, trackedDiagnoses: string[]) {
    if (!previous) {
        const top = current.diagnoses[0];
        return top
            ? `Initial inference opened with ${top.name} at ${Math.round(top.confidence * 100)}% confidence.`
            : 'Initial inference recorded.';
    }

    const previousMap = new Map(previous.diagnoses.map((item) => [item.name, item.confidence]));
    const currentMap = new Map(current.diagnoses.map((item) => [item.name, item.confidence]));

    let strongestName = trackedDiagnoses[0] ?? current.diagnoses[0]?.name ?? 'Top differential';
    let strongestDelta = -1;

    for (const name of trackedDiagnoses) {
        const delta = Math.abs((currentMap.get(name) ?? 0) - (previousMap.get(name) ?? 0));
        if (delta > strongestDelta) {
            strongestName = name;
            strongestDelta = delta;
        }
    }

    const currentValue = currentMap.get(strongestName) ?? 0;
    const previousValue = previousMap.get(strongestName) ?? 0;
    const direction = currentValue >= previousValue ? 'increased' : 'decreased';

    return `${current.trigger} ${direction} ${strongestName} by ${Math.round(Math.abs(currentValue - previousValue) * 100)} points.`;
}

export default function DifferentialDriftPanel({
    messageId,
    messageTimestamp,
    conversationMessages,
}: DifferentialDriftPanelProps) {
    const driftPoints = useMemo(
        () => buildDriftPoints(conversationMessages, messageTimestamp, messageId),
        [conversationMessages, messageId, messageTimestamp],
    );

    const trackedDiagnoses = useMemo(() => {
        const maxByDiagnosis = new Map<string, number>();
        for (const point of driftPoints) {
            for (const diagnosis of point.diagnoses) {
                maxByDiagnosis.set(
                    diagnosis.name,
                    Math.max(maxByDiagnosis.get(diagnosis.name) ?? 0, diagnosis.confidence),
                );
            }
        }

        return [...maxByDiagnosis.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name]) => name);
    }, [driftPoints]);

    const chartData = useMemo(() => {
        return driftPoints.map((point) => {
            const diagnosisMap = new Map(point.diagnoses.map((item) => [item.name, item.confidence]));
            return trackedDiagnoses.reduce<Record<string, number | string>>(
                (accumulator, diagnosis) => {
                    accumulator[diagnosis] = Math.round((diagnosisMap.get(diagnosis) ?? 0) * 100);
                    return accumulator;
                },
                { turn: point.label },
            );
        });
    }, [driftPoints, trackedDiagnoses]);

    const reasoningTimeline = useMemo(() => {
        return driftPoints.map((point, index) => ({
            point,
            note: buildReasoningShift(index > 0 ? driftPoints[index - 1] : null, point, trackedDiagnoses),
        }));
    }, [driftPoints, trackedDiagnoses]);

    const handleExport = () => {
        const lines = [
            '# VetIOS Differential Drift Note',
            '',
            ...reasoningTimeline.map(({ point, note }) => `## ${point.label}\nTrigger: ${point.trigger}\n${note}\n`),
        ];
        const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'vetios-differential-drift.md';
        anchor.click();
        URL.revokeObjectURL(url);
    };

    if (driftPoints.length === 0) {
        return (
            <div className="border border-white/10 bg-white/[0.02] px-4 py-4 font-mono text-[11px] text-white/48">
                No clinical differential history is available for this message yet.
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <GitBranch className="h-4 w-4 text-[#00ff88]" />
                        <h3 className="font-mono text-xs uppercase tracking-[0.22em] text-[#00ff88]">
                            Differential Probability Drift
                        </h3>
                    </div>
                    <p className="max-w-2xl font-mono text-[11px] leading-relaxed text-white/58">
                        Confidence shifts are reconstructed only from related case turns in this chat, so older unrelated diseases do not contaminate the current trajectory.
                    </p>
                </div>

                <button
                    type="button"
                    onClick={handleExport}
                    className="inline-flex items-center gap-2 border border-[#00ff88]/20 bg-[#00ff88]/6 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#00ff88] transition-colors hover:bg-[#00ff88]/12"
                >
                    <Download className="h-3 w-3" />
                    Export Note
                </button>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.85fr)]">
                <div className="space-y-3">
                    <div className="border border-white/10 bg-white/[0.02] p-3">
                        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/36">Confidence Over Turns</div>
                        <div className="mt-4 h-[280px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={chartData} margin={{ top: 10, right: 14, left: -14, bottom: 0 }}>
                                    <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                                    <XAxis dataKey="turn" tick={{ fill: 'rgba(255,255,255,0.42)', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} tickLine={false} />
                                    <YAxis
                                        domain={[0, 100]}
                                        tick={{ fill: 'rgba(255,255,255,0.42)', fontSize: 11 }}
                                        axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                                        tickLine={false}
                                        width={40}
                                    />
                                    <Tooltip
                                        contentStyle={{
                                            background: '#111111',
                                            border: '1px solid rgba(255,255,255,0.12)',
                                            borderRadius: 0,
                                            color: 'white',
                                            fontFamily: 'JetBrains Mono, monospace',
                                            fontSize: '11px',
                                        }}
                                    />
                                    {trackedDiagnoses.map((diagnosis, index) => (
                                        <Line
                                            key={diagnosis}
                                            type="monotone"
                                            dataKey={diagnosis}
                                            stroke={LINE_COLORS[index % LINE_COLORS.length]}
                                            strokeWidth={2}
                                            dot={{ r: 3 }}
                                            activeDot={{ r: 5 }}
                                        />
                                    ))}
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>

                <div className="space-y-3">
                    <div className="border border-white/10 bg-white/[0.02] p-3">
                        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/36">Tracked Differentials</div>
                        <div className="mt-3 space-y-2">
                            {trackedDiagnoses.map((diagnosis, index) => (
                                <div key={diagnosis} className="flex items-center gap-2 font-mono text-[11px] text-white/76">
                                    <div className="h-2.5 w-2.5 rounded-full" style={{ background: LINE_COLORS[index % LINE_COLORS.length] }} />
                                    {diagnosis}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="border border-white/10 bg-white/[0.02] p-3">
                        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/36">Reasoning Path</div>
                        <div className="mt-3 max-h-[300px] space-y-3 overflow-y-auto pr-1">
                            {reasoningTimeline.map(({ point, note }) => (
                                <div key={point.label} className="border border-white/8 bg-black/25 px-3 py-3">
                                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#00ff88]">
                                        {point.label}
                                    </div>
                                    <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/34">
                                        Trigger
                                    </div>
                                    <p className="mt-1 font-mono text-[11px] leading-relaxed text-white/64">
                                        {point.trigger}
                                    </p>
                                    <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-white/34">
                                        Shift
                                    </div>
                                    <p className="mt-1 font-mono text-[11px] leading-relaxed text-white/74">
                                        {note}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
