'use client';

import { motion } from 'framer-motion';
import {
  Activity, AlertTriangle, ClipboardList, Info,
  Play, Plus, BookOpen, FlaskConical, Microscope,
  Stethoscope, Brain, Dna, Shield, Syringe,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SmartActionType } from '@/hooks/useAskVetIOS';

interface SmartActionsProps {
  metadata: {
    query_type?: 'clinical' | 'educational' | 'general';
    diagnosis_ranked?: { disease: string; probability: number }[];
    urgency_level?: 'low' | 'medium' | 'high' | 'critical' | 'info';
    recommended_tests?: string[];
    explanation?: string;
  };
  onAction?: (action: SmartActionType) => void;
}

const urgencyConfig = {
  info:     { label: 'Informational',  color: 'text-blue-400',   bg: 'bg-blue-500/5',  border: 'border-blue-500/20' },
  low:      { label: 'Low Urgency',    color: 'text-accent',      bg: 'bg-accent/5',    border: 'border-accent/20'   },
  medium:   { label: 'Medium Urgency', color: 'text-yellow-400', bg: 'bg-yellow-500/5', border: 'border-yellow-500/20'},
  high:     { label: 'High Urgency',   color: 'text-orange-400', bg: 'bg-orange-500/5', border: 'border-orange-500/20'},
  critical: { label: 'Critical',       color: 'text-red-400',    bg: 'bg-red-500/8',   border: 'border-red-500/30'  },
};

const probabilityColor = (p: number) =>
  p >= 0.6 ? 'text-red-400' : p >= 0.35 ? 'text-yellow-400' : 'text-accent';

const probabilityBar = (p: number) =>
  p >= 0.6 ? 'bg-red-400' : p >= 0.35 ? 'bg-yellow-400' : 'bg-accent';

export default function SmartActions({ metadata, onAction }: SmartActionsProps) {
  const isEducational = metadata.query_type === 'educational' || metadata.query_type === 'general';
  const urgency = metadata.urgency_level ?? (isEducational ? 'info' : 'low');
  const uc = urgencyConfig[urgency as keyof typeof urgencyConfig] ?? urgencyConfig.low;
  const hasDifferentials = metadata.diagnosis_ranked && metadata.diagnosis_ranked.length > 0;
  const hasTests = metadata.recommended_tests && metadata.recommended_tests.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      className="space-y-4 pt-3 border-t border-white/6 mt-4"
    >
      {/* ── Clinical: Ranked Differentials ── */}
      {!isEducational && hasDifferentials && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-accent/80">
            <Activity className="w-3 h-3" />
            Ranked Differentials
          </div>
          <div className="space-y-1.5">
            {metadata.diagnosis_ranked!.map((diag, i) => (
              <div key={i} className="flex items-center gap-3 group">
                <span className="font-mono text-[10px] text-white/40 w-4 shrink-0">{i + 1}.</span>
                <div className="flex-1 flex items-center gap-2 min-w-0">
                  <div className="h-1 rounded-full bg-white/10 flex-1">
                    <div
                      className={cn('h-1 rounded-full transition-all', probabilityBar(diag.probability))}
                      style={{ width: `${Math.round(diag.probability * 100)}%` }}
                    />
                  </div>
                  <span className="font-mono text-[11px] text-white/80 group-hover:text-white transition-colors truncate min-w-0 max-w-[180px]">
                    {diag.disease}
                  </span>
                  <span className={cn('font-mono text-[11px] font-bold shrink-0', probabilityColor(diag.probability))}>
                    {Math.round(diag.probability * 100)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Clinical: Tests + Urgency ── */}
      {!isEducational && (hasTests || metadata.explanation) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {hasTests && (
            <div className="p-3 bg-white/[0.03] border border-white/8 rounded-sm space-y-2">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-white/50">
                <ClipboardList className="w-3 h-3" />
                Recommended Tests
              </div>
              <ul className="space-y-1">
                {metadata.recommended_tests!.map((test, i) => (
                  <li key={i} className="flex items-center gap-2 font-mono text-[11px] text-white/70">
                    <span className="w-1 h-1 rounded-full bg-accent/50 shrink-0" />
                    {test}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {metadata.explanation && (
            <div className={cn('p-3 border rounded-sm', uc.bg, uc.border)}>
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-white/50 mb-2">
                <AlertTriangle className="w-3 h-3" />
                Urgency:&nbsp;<span className={cn('font-bold', uc.color)}>{uc.label}</span>
              </div>
              <p className="font-mono text-[11px] text-white/60 leading-relaxed italic">
                &quot;{metadata.explanation}&quot;
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Educational: info badge ── */}
      {isEducational && metadata.explanation && (
        <div className={cn('flex items-center gap-2 px-3 py-2 rounded-sm border text-[11px] font-mono', uc.bg, uc.border, uc.color)}>
          <Info className="w-3 h-3 shrink-0" />
          {metadata.explanation}
        </div>
      )}

      {/* ── Smart Action Buttons ── */}
      <div className="flex flex-wrap gap-2 pt-1">
        {isEducational ? (
          <>
            <ActionBtn icon={<Stethoscope className="w-3 h-3" />} label="Run Diagnosis" primary onClick={() => onAction?.('run_diagnosis')} />
            <ActionBtn icon={<FlaskConical className="w-3 h-3" />} label="View Diagnostics" onClick={() => onAction?.('view_diagnostics')} />
            <ActionBtn icon={<Microscope className="w-3 h-3" />} label="Research Mode" onClick={() => onAction?.('research_mode')} />
            <ActionBtn icon={<BookOpen className="w-3 h-3" />} label="Exam Notes" onClick={() => onAction?.('exam_notes')} />
            <ActionBtn icon={<Brain className="w-3 h-3" />} label="Pathogenesis" onClick={() => onAction?.('pathogenesis')} />
            <ActionBtn icon={<Dna className="w-3 h-3" />} label="Molecular Basis" onClick={() => onAction?.('molecular_basis')} />
            <ActionBtn icon={<Shield className="w-3 h-3" />} label="Prevention" onClick={() => onAction?.('prevention')} />
            <ActionBtn icon={<Syringe className="w-3 h-3" />} label="Vaccine Info" onClick={() => onAction?.('vaccine_info')} />
          </>
        ) : (
          <>
            <ActionBtn icon={<Play className="w-3 h-3" />} label="Run Inference" primary onClick={() => onAction?.('run_inference')} />
            <ActionBtn icon={<Plus className="w-3 h-3" />} label="Suggest Tests" onClick={() => onAction?.('suggest_tests')} />
            <ActionBtn icon={<Info className="w-3 h-3" />} label="Explain Condition" onClick={() => onAction?.('explain_condition')} />
            <ActionBtn icon={<Brain className="w-3 h-3" />} label="Pathophysiology" onClick={() => onAction?.('pathophysiology')} />
            <ActionBtn icon={<FlaskConical className="w-3 h-3" />} label="Lab Interpretation" onClick={() => onAction?.('lab_interpretation')} />
          </>
        )}
      </div>
    </motion.div>
  );
}

function ActionBtn({
  icon, label, primary = false, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  primary?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider',
        'flex items-center gap-1.5 transition-all rounded-sm',
        'touch-manipulation min-h-[32px]',
        primary
          ? 'bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 shadow-[0_0_12px_hsl(142_76%_46%_/_0.12)]'
          : 'bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 hover:text-white/90'
      )}
    >
      {icon}
      {label}
    </button>
  );
}
