'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTransition, useRouter } from 'next/navigation';
import type { DatasetExportMode } from '@/lib/dataset/clinicalDataset';

interface ExportControlsProps {
  onExport: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  selectedExportMode: DatasetExportMode;
  setSelectedExportMode: (mode: DatasetExportMode) => void;
}

export function ExportControls({
  onExport,
  onRefresh,
  isRefreshing,
  selectedExportMode,
  setSelectedExportMode,
}: ExportControlsProps) {
  const router = useRouter();
  const [, startRefreshTransition] = useTransition();

  const handleRefresh = () => {
    startRefreshTransition(() => {
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={selectedExportMode}
        onChange={(event) => setSelectedExportMode(event.target.value as DatasetExportMode)}
        className="border border-grid bg-black/20 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-muted"
      >
        <option value="clean_labeled_cases">Clean Labeled</option>
        <option value="severity_training_set">Severity Set</option>
        <option value="adversarial_benchmark_set">Adversarial Set</option>
        <option value="calibration_audit_set">Calibration Set</option>
        <option value="quarantined_invalid_cases">Quarantined</option>
      </select>
      <button
        onClick={onRefresh || handleRefresh}
        className="flex items-center gap-2 border border-grid px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted transition-colors hover:border-accent hover:text-foreground"
      >
        <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
        Refresh
      </button>
      <button
        onClick={onExport}
        className="flex items-center gap-2 border border-grid px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted transition-colors hover:border-accent hover:text-foreground"
      >
        Export
      </button>
    </div>
  );
}
