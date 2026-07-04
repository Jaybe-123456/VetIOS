'use client';

import React, { useState } from 'react';
import { Plus, Search, FlaskConical } from 'lucide-react';
import { 
  TerminalLabel,
} from '@/components/ui/terminal';
import { 
  SPECIES_PANEL_MAP, 
  PANEL_TEST_DEFINITIONS,
  type Species, 
  type SystemType, 
  type SystemPanel 
} from '@vetios/inference-schema';
import { ActivePanelsBadgeBar } from './ActivePanelsBadgeBar';
import { PanelCard } from './PanelCard';

interface PanelSelectorProps {
  species: Species;
  onSpeciesChange: (species: Species) => void;
  activePanels: SystemPanel[];
  onChange: (panels: SystemPanel[]) => void;
}

export function PanelSelector({ 
  species, 
  onSpeciesChange, 
  activePanels, 
  onChange 
}: PanelSelectorProps) {
  const [isAddPanelOpen, setIsAddPanelOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedPanelIndex, setExpandedPanelIndex] = useState<number | null>(null);

  const allowedPanels = SPECIES_PANEL_MAP[species] || [];
  const speciesGuidance = SPECIES_PANEL_GUIDANCE[species];
  const populatedPanels = activePanels.filter(panelHasPopulatedTests);
  const availableToAdd = allowedPanels.filter(ap => 
    !activePanels.some(p => p.system === ap.system && p.panel === ap.panel)
  ).filter(ap => {
    const def = PANEL_TEST_DEFINITIONS[ap.panel];
    if (!def) return false;
    return def.label.toLowerCase().includes(searchTerm.toLowerCase()) || 
           ap.system.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const handleSpeciesChange = (nextSpecies: Species) => {
    onSpeciesChange(nextSpecies);
    const nextAllowed = SPECIES_PANEL_MAP[nextSpecies] || [];
    const filteredPanels = activePanels.filter(panel =>
      nextAllowed.some(entry => entry.system === panel.system && entry.panel === panel.panel)
    );
    if (filteredPanels.length !== activePanels.length) {
      onChange(filteredPanels);
      setExpandedPanelIndex(null);
    }
  };

  const handleAddPanel = (system: SystemType, panel: string) => {
    const newPanel: SystemPanel = {
      system,
      panel,
      tests: {}
    };
    
    // Initialize with 'not_done'
    const def = PANEL_TEST_DEFINITIONS[panel];
    if (def) {
      def.tests.forEach(t => {
        newPanel.tests[t.key] = 'not_done';
      });
    }

    const nextPanels = [...activePanels, newPanel];
    onChange(nextPanels);
    setIsAddPanelOpen(false);
    setSearchTerm('');
    setExpandedPanelIndex(nextPanels.length - 1);
  };

  const handleUpdatePanel = (index: number, updates: Partial<SystemPanel>) => {
    const nextPanels = [...activePanels];
    nextPanels[index] = { ...nextPanels[index], ...updates };
    onChange(nextPanels);
  };

  const handleRemovePanel = (index: number) => {
    const nextPanels = activePanels.filter((_, i) => i !== index);
    onChange(nextPanels);
    if (expandedPanelIndex === index) setExpandedPanelIndex(null);
    else if (expandedPanelIndex !== null && expandedPanelIndex > index) setExpandedPanelIndex(expandedPanelIndex - 1);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <TerminalLabel>Species Context</TerminalLabel>
          <select
            value={species}
            onChange={(e) => handleSpeciesChange(e.target.value as Species)}
            className="w-full bg-background border border-grid px-3 py-2.5 font-mono text-sm text-foreground focus:outline-none focus:border-accent/60 transition-colors"
          >
            <option value="canine">Canine (Dog)</option>
            <option value="feline">Feline (Cat)</option>
            <option value="equine">Equine (Horse)</option>
            <option value="bovine">Bovine (Cattle)</option>
            <option value="ovine">Ovine (Sheep)</option>
            <option value="avian">Avian (Bird)</option>
            <option value="reptile">Reptile</option>
            <option value="exotic">Exotic</option>
          </select>
          <div className="mt-3 border border-grid/70 bg-background/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
                {speciesGuidance.mode}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                {allowedPanels.length} panels
              </div>
            </div>
            <p className="mt-2 font-mono text-[11px] leading-relaxed text-muted">
              {speciesGuidance.description}
            </p>
          </div>
        </div>

        <div className="flex flex-col justify-end">
          <ActivePanelsBadgeBar 
            activePanels={populatedPanels.map(p => ({ system: p.system, panel: p.panel }))} 
            onRemove={(system, panel) => {
              const idx = activePanels.findIndex(p => p.system === system && p.panel === panel);
              if (idx !== -1) handleRemovePanel(idx);
            }}
          />
        </div>
      </div>

      <div className="space-y-4">
        {activePanels.length > 0 ? (
          <div className="space-y-3">
            {activePanels.map((panel, idx) => (
              <PanelCard 
                key={`${panel.system}-${panel.panel}`}
                panel={panel}
                onUpdate={(updates) => handleUpdatePanel(idx, updates)}
                onRemove={() => handleRemovePanel(idx)}
                isExpanded={expandedPanelIndex === idx}
                onToggleExpand={() => setExpandedPanelIndex(expandedPanelIndex === idx ? null : idx)}
              />
            ))}
          </div>
        ) : (
          <div className="p-8 border border-dashed border-grid bg-background/20 flex flex-col items-center justify-center gap-4 text-center">
            <FlaskConical className="w-8 h-8 text-muted/30" />
            <div className="space-y-1">
              <div className="font-mono text-xs uppercase tracking-widest text-muted">No Diagnostic Panels Selected</div>
            </div>
          </div>
        ) }

        <div className="relative">
          {!isAddPanelOpen ? (
            <button
              type="button"
              onClick={() => setIsAddPanelOpen(true)}
              className="w-full py-4 border border-dashed border-accent/30 bg-accent/5 hover:bg-accent/10 hover:border-accent/50 transition-all flex items-center justify-center gap-2 group"
            >
              <Plus className="w-4 h-4 text-accent group-hover:scale-110 transition-transform" />
              <span className="font-mono text-xs uppercase tracking-[0.2em] text-accent">Add Diagnostic Panel</span>
            </button>
          ) : (
            <div className="border border-accent/40 bg-[hsl(0_0%_7%)] p-4 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center gap-2 mb-4">
                <Search className="w-4 h-4 text-muted" />
                <input 
                  type="text"
                  autoFocus
                  placeholder="SEARCH PANELS (CBC, RENAL, ADRENAL...)"
                  className="bg-transparent border-none outline-none font-mono text-xs w-full uppercase tracking-wider text-foreground placeholder:text-muted/40"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
                <button 
                  type="button"
                  onClick={() => setIsAddPanelOpen(false)}
                  className="font-mono text-[10px] uppercase text-muted hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[300px] overflow-y-auto pr-2 scrollbar-thin">
                {availableToAdd.length > 0 ? (
                  availableToAdd.map(ap => (
                    <button
                      key={`${ap.system}-${ap.panel}`}
                      type="button"
                      onClick={() => handleAddPanel(ap.system, ap.panel)}
                      className="text-left p-2.5 border border-grid bg-background hover:border-accent/40 hover:bg-accent/5 transition-colors group"
                    >
                      <div className="font-mono text-[10px] text-accent/70 uppercase tracking-tighter mb-0.5">{ap.system}</div>
                      <div className="font-mono text-xs text-foreground uppercase tracking-wider font-bold">{PANEL_TEST_DEFINITIONS[ap.panel]?.label || ap.panel}</div>
                      <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.16em] text-muted">
                        {(PANEL_TEST_DEFINITIONS[ap.panel]?.species_scope ?? ['all']).join(' / ')}
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="col-span-full py-4 text-center font-mono text-[10px] text-muted uppercase tracking-widest italic">
                    {searchTerm ? 'No matching panels found' : 'No more panels available for this species'}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

function panelHasPopulatedTests(panel: SystemPanel): boolean {
  return Object.values(panel.tests).some((value) => {
    if (value === 'not_done') return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'number') return Number.isFinite(value);
    return value != null;
  });
}

const SPECIES_PANEL_GUIDANCE: Record<Species, { mode: string; description: string }> = {
  canine: {
    mode: 'Companion animal mode',
    description: 'Canine panels prioritize CBC/chemistry, tick-borne, heartworm, endocrine, imaging, cytology, parasitology, and small-animal infectious workups.',
  },
  feline: {
    mode: 'Companion animal mode',
    description: 'Feline panels remove canine-only heartworm-first defaults and emphasize feline infectious, renal, endocrine, imaging, cytology, and parasite evidence.',
  },
  equine: {
    mode: 'Equine mode',
    description: 'Equine panels emphasize CBC/chemistry, SAA, Coggins/EIA, abdominal or thoracic imaging, culture, molecular diagnostics, and parasite surveillance.',
  },
  bovine: {
    mode: 'Ruminant herd mode',
    description: 'Bovine panels are cattle-specific: metabolic/mineral disease, mastitis and milk quality, herd infectious screens, rumen/abdominal findings, neonatal calf workups, AMR culture, and One Health signals. Small-animal heartworm/adrenal/tick panels are excluded.',
  },
  ovine: {
    mode: 'Small ruminant mode',
    description: 'Ovine panels focus on flock-level infectious disease, parasitology, mineral/metabolic disease, neonatal lamb signals, culture/AMR, and ruminant abdominal assessment.',
  },
  avian: {
    mode: 'Avian mode',
    description: 'Avian panels use heterophil/thrombocyte-oriented hematology, cytology, molecular tests, culture, electrolytes, and parasite workups instead of mammalian defaults.',
  },
  reptile: {
    mode: 'Reptile mode',
    description: 'Reptile panels use avian/reptile hematology and cytology, culture, molecular tests, electrolytes, and parasitology rather than canine/feline panels.',
  },
  exotic: {
    mode: 'Exotic triage mode',
    description: 'Exotic panels blend avian/reptile screening with limited mammalian diagnostics until a narrower species family is selected in a later ontology build.',
  },
};
