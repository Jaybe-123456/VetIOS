'use client';

import React from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  FlaskConical,
  Trash2,
} from 'lucide-react';
import { TerminalInput } from '@/components/ui/terminal';
import {
  PANEL_TEST_DEFINITIONS,
  type PanelTestDefinition,
  type SystemPanel,
  type TestValue,
} from '@vetios/inference-schema';

interface PanelCardProps {
  panel: SystemPanel;
  onUpdate: (updates: Partial<SystemPanel>) => void;
  onRemove: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export function PanelCard({
  panel,
  onUpdate,
  onRemove,
  isExpanded,
  onToggleExpand,
}: PanelCardProps) {
  const definition = PANEL_TEST_DEFINITIONS[panel.panel];

  if (!definition) {
    return (
      <div className="p-4 border border-danger/30 bg-danger/5 rounded-sm flex items-center gap-3">
        <AlertCircle className="w-5 h-5 text-danger" />
        <div className="font-mono text-xs text-danger uppercase tracking-wider">
          Error: Definition for panel "{panel.panel}" not found.
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="ml-auto text-muted hover:text-danger p-1"
          title="Remove panel"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    );
  }

  const handleTestChange = (key: string, value: TestValue) => {
    onUpdate({
      tests: {
        ...panel.tests,
        [key]: value,
      },
    });
  };

  const activeTestCount = Object.values(panel.tests).filter(isPopulatedValue).length;

  return (
    <div
      className={`border transition-all duration-200 ${
        isExpanded
          ? 'border-accent/40 bg-accent/5'
          : 'border-grid bg-background/40 hover:border-grid-bright'
      }`}
    >
      <div
        className="flex items-center justify-between p-3 cursor-pointer select-none"
        onClick={onToggleExpand}
      >
        <div className="flex items-center gap-3">
          <div
            className={`p-2 rounded-sm ${
              isExpanded ? 'bg-accent/20 text-accent' : 'bg-muted/10 text-muted'
            }`}
          >
            <FlaskConical className="w-4 h-4" />
          </div>
          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-foreground font-bold">
              {definition.label}
            </div>
            <div className="font-mono text-[9px] uppercase tracking-tighter text-muted">
              System: {panel.system} / {activeTestCount} tests populated
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            onClick={onRemove}
            className="p-2 text-muted hover:text-danger hover:bg-danger/10 rounded-sm transition-colors"
            title="Remove panel"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-4 bg-grid mx-1" />
          <button
            type="button"
            onClick={onToggleExpand}
            className="p-2 text-muted hover:text-foreground rounded-sm transition-colors"
            title={isExpanded ? 'Collapse panel' : 'Expand panel'}
          >
            {isExpanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="p-4 pt-0 border-t border-grid/50 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            {definition.tests.map((test) => (
              <TestField
                key={test.key}
                definition={test}
                value={panel.tests[test.key]}
                onChange={(value) => handleTestChange(test.key, value)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TestField({
  definition,
  value,
  onChange,
}: {
  definition: PanelTestDefinition;
  value: TestValue | undefined;
  onChange: (value: TestValue) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground mb-2">
        {definition.label} {definition.unit ? `(${definition.unit})` : ''}
      </label>

      {definition.type === 'select' && (
        <select
          value={value ?? 'not_done'}
          onChange={(event) => onChange(event.target.value as TestValue)}
          className="w-full bg-background border border-grid px-2 py-1.5 font-mono text-xs text-foreground focus:outline-none focus:border-accent/60 transition-colors rounded-none"
        >
          {definition.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}

      {definition.type === 'numeric' && (
        <TerminalInput
          type="number"
          step="any"
          value={value === 'not_done' ? '' : value ?? ''}
          onChange={(event) => {
            const rawValue = event.target.value;
            const parsed = Number(rawValue);
            onChange(rawValue === '' || !Number.isFinite(parsed) ? 'not_done' : parsed);
          }}
          placeholder="Not done"
          className="h-8 py-1"
        />
      )}

      {definition.type === 'text' && (
        <TerminalInput
          type="text"
          value={value === 'not_done' ? '' : String(value ?? '')}
          onChange={(event) => onChange(event.target.value === '' ? 'not_done' : event.target.value)}
          placeholder="Not done"
          className="h-8 py-1"
        />
      )}
    </div>
  );
}

function isPopulatedValue(value: TestValue): boolean {
  if (value === 'not_done') return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  return true;
}
