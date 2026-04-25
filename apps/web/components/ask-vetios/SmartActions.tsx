'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Activity, AlertTriangle, BookOpen, ChevronDown, ChevronUp,
    ClipboardList, Dna, FlaskConical, Play, Shield, Syringe, X, Microscope, Search
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MessageMetadata } from '@/store/useChatStore';

interface SmartActionsProps {
    metadata: MessageMetadata;
    messageContent: string;
    onFollowUp: (prompt: string) => void;
}

type ActivePanel = 'diagnosis' | 'tests' | 'research' | 'exam' | 'pathogenesis' | 'molecular' | 'prevention' | 'vaccine' | null;

// ── Confidence bar ─────────────────────────────────────────────────────────

function ConfidenceBar({ value }: { value: number }) {
    const pct = Math.round(value * 100);
    const color = pct >= 70 ? '#00ff66' : pct >= 40 ? '#ffcc00' : '#ff4444';
    return (
        <div className="flex items-center gap-3 w-full">
            <div className="flex-1 h-1 bg-white/10 overflow-hidden">
                <div className="h-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
            </div>
            <span className="font-mono text-[10px] w-8 text-right" style={{ color }}>{pct}%</span>
        </div>
    );
}

// ── Urgency badge ──────────────────────────────────────────────────────────

function UrgencyBadge({ level }: { level: string }) {
    const cfg: Record<string, { label: string; color: string; bg: string; border: string }> = {
        low:       { label: 'LOW',       color: '#00ff66', bg: 'rgba(0,255,102,0.05)',  border: 'rgba(0,255,102,0.2)' },
        moderate:  { label: 'MODERATE',  color: '#ffcc00', bg: 'rgba(255,204,0,0.05)',  border: 'rgba(255,204,0,0.2)' },
        high:      { label: 'HIGH',      color: '#ff8800', bg: 'rgba(255,136,0,0.05)',  border: 'rgba(255,136,0,0.2)' },
        emergency: { label: 'EMERGENCY', color: '#ff3333', bg: 'rgba(255,51,51,0.08)',  border: 'rgba(255,51,51,0.3)' },
        medium:    { label: 'MODERATE',  color: '#ffcc00', bg: 'rgba(255,204,0,0.05)',  border: 'rgba(255,204,0,0.2)' },
        critical:  { label: 'CRITICAL',  color: '#ff3333', bg: 'rgba(255,51,51,0.08)',  border: 'rgba(255,51,51,0.3)' },
    };
    const c = cfg[level] ?? cfg.moderate;
    return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 font-mono text-[9px] uppercase tracking-widest border"
            style={{ color: c.color, background: c.bg, borderColor: c.border }}>
            <AlertTriangle className="w-2.5 h-2.5" />
            {c.label}
        </span>
    );
}

// ── Panel container ────────────────────────────────────────────────────────

function Panel({ title, icon: Icon, onClose, children }: {
    title: string; icon: React.ElementType; onClose: () => void; children: React.ReactNode;
}) {
    return (
        <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="border border-white/10 bg-[#0d0d0d] overflow-hidden"
        >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                <div className="flex items-center gap-2">
                    <Icon className="w-3.5 h-3.5 text-accent" />
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">{title}</span>
                </div>
                <button onClick={onClose} className="text-white/30 hover:text-white transition-colors p-1">
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>
            <div className="p-4">{children}</div>
        </motion.div>
    );
}

// ── Action button ──────────────────────────────────────────────────────────

function ActionBtn({
    icon: Icon, label, active, primary, onClick
}: {
    icon: React.ElementType; label: string; active?: boolean; primary?: boolean; onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider border transition-all duration-150',
                primary && !active && 'bg-accent/10 border-accent/30 text-accent hover:bg-accent/20 shadow-[0_0_12px_rgba(0,255,102,0.1)]',
                !primary && !active && 'bg-white/5 border-white/10 text-white/60 hover:border-white/20 hover:text-white/90',
                active && 'bg-accent/15 border-accent/50 text-accent shadow-[0_0_14px_rgba(0,255,102,0.15)]',
            )}
        >
            <Icon className="w-3 h-3 shrink-0" />
            {label}
        </button>
    );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function SmartActions({ metadata, messageContent, onFollowUp }: SmartActionsProps) {
    const [activePanel, setActivePanel] = useState<ActivePanel>(null);

    const toggle = (panel: ActivePanel) => setActivePanel(prev => prev === panel ? null : panel);

    const isClinical = metadata.mode === 'clinical';
    const isEducational = metadata.mode === 'educational';
    const topic = metadata.topic ?? extractTopicFromContent(messageContent);

    // ── Follow-up prompt builders ──────────────────────────────────────────
    const ask = (prompt: string) => {
        setActivePanel(null);
        onFollowUp(prompt);
    };

    return (
        <div className="space-y-4 pt-3">

            {/* ── Clinical panels ─────────────────────────────────────── */}
            {isClinical && (
                <>
                    {/* Differentials */}
                    {metadata.diagnosis_ranked && metadata.diagnosis_ranked.length > 0 && (
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-accent/80">
                                <Activity className="w-3 h-3" />
                                Ranked Differentials
                            </div>
                            <div className="space-y-1.5">
                                {metadata.diagnosis_ranked.map((d, i) => (
                                    <div key={i} className="p-3 bg-white/[0.03] border border-white/8 hover:border-accent/20 transition-all group">
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className="font-mono text-xs text-white/80 group-hover:text-white transition-colors">
                                                {i + 1}. {'name' in d ? d.name : (d as { disease?: string }).disease ?? 'Unknown'}
                                            </span>
                                            {'urgency_level' in metadata && i === 0 && metadata.urgency_level && (
                                                <UrgencyBadge level={metadata.urgency_level} />
                                            )}
                                        </div>
                                        <ConfidenceBar value={'confidence' in d ? d.confidence : (d as { probability?: number }).probability ?? 0} />
                                        {'reasoning' in d && d.reasoning && (
                                            <p className="mt-1.5 font-mono text-[10px] text-white/40 leading-relaxed">{d.reasoning}</p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Red flags */}
                    {metadata.red_flags && metadata.red_flags.length > 0 && (
                        <div className="p-3 border border-red-500/20 bg-red-500/5 space-y-2">
                            <div className="flex items-center gap-2 text-[9px] uppercase tracking-widest text-red-400">
                                <AlertTriangle className="w-3 h-3" />
                                Red Flags
                            </div>
                            <ul className="space-y-1">
                                {metadata.red_flags.map((f, i) => (
                                    <li key={i} className="font-mono text-[11px] text-red-300/80 flex items-center gap-2">
                                        <div className="w-1 h-1 bg-red-500 shrink-0" />
                                        {f}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Tests */}
                    {metadata.recommended_tests && metadata.recommended_tests.length > 0 && (
                        <div className="p-3 bg-white/[0.03] border border-white/8 space-y-2">
                            <div className="flex items-center gap-2 text-[9px] uppercase tracking-widest text-white/50">
                                <ClipboardList className="w-3 h-3" />
                                Recommended Diagnostics
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                {metadata.recommended_tests.map((t, i) => (
                                    <div key={i} className="font-mono text-[11px] text-white/70 flex items-center gap-2">
                                        <div className="w-1 h-1 bg-accent/40 shrink-0" />
                                        {t}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {metadata.explanation && (
                        <p className="font-mono text-[11px] text-white/40 italic leading-relaxed border-l-2 border-accent/20 pl-3">
                            {metadata.explanation}
                        </p>
                    )}
                </>
            )}

            {/* ── Expandable panels (shared) ──────────────────────────── */}
            <AnimatePresence>
                {activePanel === 'research' && (
                    <Panel key="research" title="Research Mode" icon={Search} onClose={() => setActivePanel(null)}>
                        <div className="space-y-3">
                            <p className="font-mono text-[11px] text-white/60 leading-relaxed">
                                Querying VetIOS knowledge base for: <span className="text-accent">{topic}</span>
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {[
                                    { label: 'Full Overview', prompt: `Give me a comprehensive research-level overview of ${topic} including classification, epidemiology, pathogenesis, clinical signs, diagnosis, treatment and prevention.` },
                                    { label: 'Latest Research', prompt: `What are the most important recent research findings and clinical advances for ${topic}?` },
                                    { label: 'Compare Differentials', prompt: `How does ${topic} compare to its main differentials? What distinguishes each?` },
                                    { label: 'Case Studies', prompt: `Describe typical case presentations and outcomes for ${topic} in clinical practice.` },
                                ].map((item) => (
                                    <button key={item.label} onClick={() => ask(item.prompt)}
                                        className="p-3 text-left border border-white/10 bg-white/[0.02] hover:border-accent/30 hover:bg-accent/5 transition-all group">
                                        <span className="font-mono text-[10px] uppercase tracking-widest text-white/60 group-hover:text-accent transition-colors">
                                            {item.label}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </Panel>
                )}

                {activePanel === 'exam' && (
                    <Panel key="exam" title="Exam Notes" icon={BookOpen} onClose={() => setActivePanel(null)}>
                        <div className="space-y-3">
                            <p className="font-mono text-[11px] text-white/60 leading-relaxed mb-3">
                                Generate structured exam-ready notes for: <span className="text-accent">{topic}</span>
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {[
                                    { label: 'Key Facts Summary', prompt: `Summarize the most important exam-ready facts about ${topic}: definition, key features, diagnosis and treatment in a concise structured format.` },
                                    { label: 'DAMNIT-V Approach', prompt: `Apply the DAMNIT-V framework to ${topic}: Degenerative, Anomalous, Metabolic, Neoplastic, Inflammatory/Infectious, Traumatic, Vascular.` },
                                    { label: 'Clinical Signs Table', prompt: `Create a structured table of clinical signs for ${topic} organized by body system.` },
                                    { label: 'Diagnostic Algorithm', prompt: `Walk me through a step-by-step diagnostic algorithm for suspected ${topic}.` },
                                ].map((item) => (
                                    <button key={item.label} onClick={() => ask(item.prompt)}
                                        className="p-3 text-left border border-white/10 bg-white/[0.02] hover:border-accent/30 hover:bg-accent/5 transition-all group">
                                        <span className="font-mono text-[10px] uppercase tracking-widest text-white/60 group-hover:text-accent transition-colors">
                                            {item.label}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </Panel>
                )}

                {activePanel === 'pathogenesis' && (
                    <Panel key="pathogenesis" title="Pathogenesis" icon={FlaskConical} onClose={() => setActivePanel(null)}>
                        <div className="space-y-3">
                            <p className="font-mono text-[11px] text-white/60 leading-relaxed mb-3">
                                Deep pathogenesis analysis for: <span className="text-accent">{topic}</span>
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {[
                                    { label: 'Step-by-Step Mechanism', prompt: `Explain the complete step-by-step pathogenesis of ${topic}: from initial exposure through cellular mechanisms to clinical disease.` },
                                    { label: 'Host-Pathogen Interaction', prompt: `Describe how ${topic} interacts with host cells and tissues, including receptor binding, immune evasion and tissue tropism.` },
                                    { label: 'Immune Response', prompt: `Explain the innate and adaptive immune responses to ${topic} and how the immune system attempts to control the disease.` },
                                    { label: 'Disease Progression Stages', prompt: `Describe the distinct stages of ${topic} disease progression from subclinical to acute, chronic and end-stage phases.` },
                                ].map((item) => (
                                    <button key={item.label} onClick={() => ask(item.prompt)}
                                        className="p-3 text-left border border-white/10 bg-white/[0.02] hover:border-accent/30 hover:bg-accent/5 transition-all group">
                                        <span className="font-mono text-[10px] uppercase tracking-widest text-white/60 group-hover:text-accent transition-colors">
                                            {item.label}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </Panel>
                )}

                {activePanel === 'molecular' && (
                    <Panel key="molecular" title="Molecular Basis" icon={Dna} onClose={() => setActivePanel(null)}>
                        <div className="space-y-3">
                            <p className="font-mono text-[11px] text-white/60 leading-relaxed mb-3">
                                Molecular and genetic analysis for: <span className="text-accent">{topic}</span>
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {[
                                    { label: 'Genome & Structure', prompt: `Describe the genomic organization and structural biology of ${topic}: genome type, key proteins and their functions.` },
                                    { label: 'Virulence Factors', prompt: `What are the key virulence factors of ${topic} and how do they contribute to pathogenicity?` },
                                    { label: 'Genetic Variation & Strains', prompt: `Explain the genetic diversity, known strains or serotypes of ${topic} and how variation affects virulence and vaccine efficacy.` },
                                    { label: 'Molecular Diagnostics', prompt: `What PCR targets, molecular markers and genomic regions are used for laboratory diagnosis of ${topic}?` },
                                ].map((item) => (
                                    <button key={item.label} onClick={() => ask(item.prompt)}
                                        className="p-3 text-left border border-white/10 bg-white/[0.02] hover:border-accent/30 hover:bg-accent/5 transition-all group">
                                        <span className="font-mono text-[10px] uppercase tracking-widest text-white/60 group-hover:text-accent transition-colors">
                                            {item.label}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </Panel>
                )}

                {activePanel === 'prevention' && (
                    <Panel key="prevention" title="Prevention & Control" icon={Shield} onClose={() => setActivePanel(null)}>
                        <div className="space-y-3">
                            <p className="font-mono text-[11px] text-white/60 leading-relaxed mb-3">
                                Prevention protocols for: <span className="text-accent">{topic}</span>
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {[
                                    { label: 'Prevention Strategies', prompt: `What are the evidence-based prevention and control strategies for ${topic} including biosecurity, management and environmental measures?` },
                                    { label: 'Treatment Protocols', prompt: `Describe current treatment protocols for ${topic}: supportive care, specific therapies, drug options and monitoring parameters.` },
                                    { label: 'Herd/Population Control', prompt: `How is ${topic} managed at the population or herd level? Include quarantine protocols, surveillance and eradication strategies.` },
                                    { label: 'Prognosis & Outcomes', prompt: `What is the prognosis for ${topic}? Describe factors that influence outcome and long-term sequelae.` },
                                ].map((item) => (
                                    <button key={item.label} onClick={() => ask(item.prompt)}
                                        className="p-3 text-left border border-white/10 bg-white/[0.02] hover:border-accent/30 hover:bg-accent/5 transition-all group">
                                        <span className="font-mono text-[10px] uppercase tracking-widest text-white/60 group-hover:text-accent transition-colors">
                                            {item.label}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </Panel>
                )}

                {activePanel === 'vaccine' && (
                    <Panel key="vaccine" title="Vaccine Information" icon={Syringe} onClose={() => setActivePanel(null)}>
                        <div className="space-y-3">
                            <p className="font-mono text-[11px] text-white/60 leading-relaxed mb-3">
                                Vaccination data for: <span className="text-accent">{topic}</span>
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {[
                                    { label: 'Available Vaccines', prompt: `What vaccines are available for ${topic}? Describe each type (modified live, killed, subunit, etc.), manufacturers and core vs non-core status.` },
                                    { label: 'Vaccination Protocols', prompt: `Describe complete vaccination protocols for ${topic}: puppy/kitten series, adult boosters, maternal antibody interference and timing.` },
                                    { label: 'Vaccine Efficacy & Duration', prompt: `What is the vaccine efficacy and duration of immunity for ${topic} vaccines? Include data on protection against different strains.` },
                                    { label: 'Adverse Effects', prompt: `What adverse reactions are associated with ${topic} vaccination? Describe incidence, risk factors and management.` },
                                ].map((item) => (
                                    <button key={item.label} onClick={() => ask(item.prompt)}
                                        className="p-3 text-left border border-white/10 bg-white/[0.02] hover:border-accent/30 hover:bg-accent/5 transition-all group">
                                        <span className="font-mono text-[10px] uppercase tracking-widest text-white/60 group-hover:text-accent transition-colors">
                                            {item.label}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </Panel>
                )}

                {activePanel === 'diagnosis' && isClinical && (
                    <Panel key="diagnosis" title="Run Diagnosis" icon={Play} onClose={() => setActivePanel(null)}>
                        <div className="space-y-3">
                            <p className="font-mono text-[11px] text-white/60 leading-relaxed mb-3">
                                Deepen the clinical analysis
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {[
                                    { label: 'Expand Differentials', prompt: `Expand the differential diagnosis list for this case. Include less common and exotic differentials, especially those that could be missed.` },
                                    { label: 'Rule-Out Protocol', prompt: `Create a systematic rule-out protocol for the top differentials in this case. Order tests by priority, cost and diagnostic yield.` },
                                    { label: 'Emergency Assessment', prompt: `Is this case potentially life-threatening? Identify any emergency conditions and describe immediate stabilization priorities.` },
                                    { label: 'Specialist Referral', prompt: `Would specialist referral be appropriate for this case? Which specialty and what information should I relay?` },
                                ].map((item) => (
                                    <button key={item.label} onClick={() => ask(item.prompt)}
                                        className="p-3 text-left border border-white/10 bg-white/[0.02] hover:border-accent/30 hover:bg-accent/5 transition-all group">
                                        <span className="font-mono text-[10px] uppercase tracking-widest text-white/60 group-hover:text-accent transition-colors">
                                            {item.label}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </Panel>
                )}

                {activePanel === 'tests' && isClinical && (
                    <Panel key="tests" title="View Diagnostics" icon={Microscope} onClose={() => setActivePanel(null)}>
                        <div className="space-y-3">
                            <p className="font-mono text-[11px] text-white/60 leading-relaxed mb-3">
                                Diagnostic test guidance for this case
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {[
                                    { label: 'Interpret CBC/Chem', prompt: `What CBC and chemistry panel findings would you expect for each differential in this case, and how would you interpret them?` },
                                    { label: 'Imaging Guidance', prompt: `What imaging studies are indicated for this case? Describe expected findings on radiograph, ultrasound or other modalities for each differential.` },
                                    { label: 'Point-of-Care Tests', prompt: `What in-clinic point-of-care tests should be run first for this case? List by priority with expected results for each differential.` },
                                    { label: 'Lab Reference Ranges', prompt: `What are the key laboratory values and reference ranges relevant to this case presentation?` },
                                ].map((item) => (
                                    <button key={item.label} onClick={() => ask(item.prompt)}
                                        className="p-3 text-left border border-white/10 bg-white/[0.02] hover:border-accent/30 hover:bg-accent/5 transition-all group">
                                        <span className="font-mono text-[10px] uppercase tracking-widest text-white/60 group-hover:text-accent transition-colors">
                                            {item.label}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </Panel>
                )}
            </AnimatePresence>

            {/* ── Action buttons row ───────────────────────────────────── */}
            <div className="flex flex-wrap gap-2 pt-1">
                {isClinical && (
                    <>
                        <ActionBtn icon={Play}         label="Run Diagnosis"    primary active={activePanel === 'diagnosis'} onClick={() => toggle('diagnosis')} />
                        <ActionBtn icon={Microscope}   label="View Diagnostics" active={activePanel === 'tests'}      onClick={() => toggle('tests')} />
                    </>
                )}
                <ActionBtn icon={Search}       label="Research Mode"   active={activePanel === 'research'}    onClick={() => toggle('research')} />
                <ActionBtn icon={BookOpen}     label="Exam Notes"      active={activePanel === 'exam'}        onClick={() => toggle('exam')} />
                <ActionBtn icon={FlaskConical} label="Pathogenesis"    active={activePanel === 'pathogenesis'} onClick={() => toggle('pathogenesis')} />
                <ActionBtn icon={Dna}          label="Molecular Basis" active={activePanel === 'molecular'}   onClick={() => toggle('molecular')} />
                <ActionBtn icon={Shield}       label="Prevention"      active={activePanel === 'prevention'}  onClick={() => toggle('prevention')} />
                <ActionBtn icon={Syringe}      label="Vaccine Info"    active={activePanel === 'vaccine'}     onClick={() => toggle('vaccine')} />
            </div>
        </div>
    );
}

function extractTopicFromContent(content: string): string {
    // Try to extract a real disease/condition name from the response content.
    // The first sentence usually follows patterns like "X is a...", "X, also known as..."
    const firstSentence = content.split(/[.!?]/)[0] ?? '';

    // Pattern: "Disease Name is a..." or "Disease Name, also known as..."
    const namedMatch = firstSentence.match(/^([A-Z][^,.(]{2,60}?)(?:\s+(?:is|are|also|refers|belongs|commonly|primarily)\b)/);
    if (namedMatch?.[1]) {
        const candidate = namedMatch[1].trim();
        const genericOpeners = ['The ', 'This ', 'In ', 'It ', 'There ', 'These '];
        if (candidate.length >= 3 && !genericOpeners.some(p => candidate.startsWith(p))) {
            return candidate;
        }
    }

    // Pattern: leading capitalised multi-word phrase (e.g. "Canine Distemper Virus is...")
    const capsMatch = firstSentence.match(/^((?:[A-Z][a-z]+\s+){1,4}[A-Z][a-z]+)/);
    if (capsMatch?.[1] && capsMatch[1].trim().split(' ').length <= 5) {
        return capsMatch[1].trim();
    }

    // Fallback: first 4 words
    return content.split(/\s+/).slice(0, 4).join(' ') || 'this topic';
}
