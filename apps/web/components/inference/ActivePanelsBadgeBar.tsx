'use client';

import React from 'react';
import { X, Layers } from 'lucide-react';
import type { SystemType } from '@vetios/inference-schema';

interface ActivePanelsBadgeBarProps {
  activePanels: Array<{ system: SystemType; panel: string }>;
  onRemove: (system: SystemType, panel: string) => void;
}

export function ActivePanelsBadgeBar({ activePanels, onRemove }: ActivePanelsBadgeBarProps) {
  if (activePanels.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 border border-dashed border-grid bg-background/30 rounded-sm">
        <Layers className="w-3.5 h-3.5 text-muted" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted">No active diagnostic panels</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {activePanels.map((p) => (
        <span
          key={`${p.system}-${p.panel}`}
          className="bg-accent/5 border border-accent/30 hover:bg-accent/10 transition-colors py-1 pl-2 pr-1 flex items-center gap-1.5 group"
        >
          <span className="font-mono text-[10px] uppercase tracking-tighter text-accent/80">{p.system}:</span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-foreground">{p.panel}</span>
          <button
            type="button"
            onClick={() => onRemove(p.system, p.panel)}
            className="p-0.5 rounded-full hover:bg-accent/20 text-muted group-hover:text-accent transition-colors"
            title="Remove panel"
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
