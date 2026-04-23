'use client';

import { Activity, ChevronRight, Clock } from 'lucide-react';
import { motion } from 'framer-motion';

// ── Recent Cases ──

const cases = [
  { name: 'Canine Gastroenteritis', date: '2 mins ago', status: 'Inferred' },
  { name: 'Feline Respiratory Distress', date: '15 mins ago', status: 'Processing' },
  { name: 'Bovine Mastitis', date: '1 hour ago', status: 'Completed' },
  { name: 'Equine Lameness', date: '3 hours ago', status: 'Flagged' },
  { name: 'Avian Disease Screening', date: 'Today', status: 'Inferred' },
];

export function RecentCases() {
  return (
    <div className="bg-white/5 border border-white/10 flex flex-col h-full">
      <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/50">Recent Analyses</span>
        <button className="text-[9px] font-mono text-accent hover:underline uppercase tracking-widest">View All</button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {cases.map((caseItem, index) => (
          <div 
            key={index}
            className="px-5 py-4 flex items-center justify-between border-b border-white/5 hover:bg-white/[0.02] transition-all group cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              <div className="flex flex-col">
                <span className="font-mono text-xs text-white/80 group-hover:text-white transition-colors uppercase tracking-tight">
                  {caseItem.name}
                </span>
                <div className="flex items-center gap-2 mt-1">
                   <Clock className="w-2.5 h-2.5 text-white/20" />
                   <span className="font-mono text-[9px] text-white/30 lowercase">{caseItem.date}</span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <span className="font-mono text-[9px] text-muted-foreground uppercase opacity-0 group-hover:opacity-100 transition-opacity">
                {caseItem.status}
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-white/10 group-hover:text-accent transition-colors" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Typing Indicator ──

export function TypingIndicator() {
  return (
    <div className="flex items-center gap-3 p-6 bg-panel/40 border-y border-white/5">
        <div className="w-8 h-8 flex items-center justify-center rounded-sm border border-accent/20 bg-accent/5">
            <Activity className="w-4 h-4 text-accent/50 animate-pulse" />
        </div>
        <div className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
                <motion.div
                    key={i}
                    animate={{ 
                        opacity: [0.2, 1, 0.2],
                        scale: [1, 1.2, 1]
                    }}
                    transition={{ 
                        duration: 1, 
                        repeat: Infinity, 
                        delay: i * 0.2 
                    }}
                    className="w-1.5 h-1.5 bg-accent"
                />
            ))}
        </div>
        <span className="font-mono text-[10px] text-accent/40 uppercase tracking-widest ml-2">
            AI_ASSISTANT is thinking...
        </span>
    </div>
  );
}
