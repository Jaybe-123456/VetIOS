'use client';

import { motion } from 'framer-motion';
import { Activity, AlertTriangle, ClipboardList, Info, Play, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SmartActionsProps {
  metadata: {
    diagnosis_ranked?: { disease: string; probability: number }[];
    urgency_level?: 'low' | 'medium' | 'high' | 'critical';
    recommended_tests?: string[];
    explanation?: string;
  };
}

export default function SmartActions({ metadata }: SmartActionsProps) {
  return (
    <div className="space-y-6 pt-2 animate-in fade-in slide-in-from-top-2 duration-500">
      {/* ── Differential Diagnoses ── */}
      {metadata.diagnosis_ranked && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-accent">
            <Activity className="w-3 h-3" />
            Ranked Differentials
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {metadata.diagnosis_ranked.map((diag, index) => (
              <div 
                key={index}
                className="p-3 bg-white/5 border border-white/10 hover:border-accent/30 transition-all group flex items-center justify-between"
              >
                <span className="font-mono text-xs text-white/80 group-hover:text-white">{diag.disease}</span>
                <span className="font-mono text-[10px] text-accent">{(diag.probability * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tests & Explanation ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {metadata.recommended_tests && (
           <div className="p-4 bg-white/5 border border-white/10 space-y-3">
             <div className="flex items-center gap-2 text-[9px] uppercase tracking-widest text-muted-foreground">
               <ClipboardList className="w-3 h-3" />
               Recommended Tests
             </div>
             <ul className="space-y-1">
               {metadata.recommended_tests.map((test, index) => (
                 <li key={index} className="font-mono text-[11px] text-white/70 flex items-center gap-2">
                   <div className="w-1 h-1 bg-accent/50" />
                   {test}
                 </li>
               ))}
             </ul>
           </div>
        )}

        <div className={cn(
          "p-4 border",
          metadata.urgency_level === 'critical' ? "bg-red-500/5 border-red-500/20" : "bg-white/5 border-white/10"
        )}>
          <div className="flex items-center gap-2 text-[9px] uppercase tracking-widest text-muted-foreground">
            <AlertTriangle className="w-3 h-3" />
            Urgency: <span className={cn(
              "uppercase font-bold ml-1",
              metadata.urgency_level === 'critical' ? "text-red-500" : "text-accent"
            )}>{metadata.urgency_level}</span>
          </div>
          <p className="mt-2 font-mono text-[11px] text-white/60 leading-relaxed italic">
            &quot;{metadata.explanation}&quot;
          </p>
        </div>
      </div>

      {/* ── Smart Buttons ── */}
      <div className="flex flex-wrap gap-2 pt-2">
        <button className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider bg-accent/10 border border-accent/20 text-accent hover:bg-accent/20 transition-all flex items-center gap-2 shadow-[0_0_15px_rgba(0,255,102,0.1)]">
           <Play className="w-3 h-3" />
           Run Inference
        </button>
        <button className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 transition-all flex items-center gap-2">
           <Plus className="w-3 h-3" />
           Suggest Tests
        </button>
        <button className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 transition-all flex items-center gap-2">
           <Info className="w-3 h-3" />
           Explain Condition
        </button>
      </div>
    </div>
  );
}
