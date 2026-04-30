'use client';

import { useMemo, useState } from 'react';
import { Eye, Flame } from 'lucide-react';
import { detectSpeciesFromTexts, type VetiosSpecies } from '@/lib/askVetios/context';

type Species = VetiosSpecies;
type BodySystem = 'neurological' | 'gi' | 'respiratory' | 'dermatological' | 'musculoskeletal';
type RegionKey = 'head' | 'thorax' | 'abdomen' | 'forelimb' | 'hindlimb' | 'spine' | 'skin';

interface ClinicalSignsAtlasProps {
    messageContent: string;
    queryText?: string;
}

interface AtlasSignDefinition {
    id: string;
    label: string;
    system: BodySystem;
    region: RegionKey;
    patterns: RegExp[];
    explanation: string;
}

interface AtlasSign extends AtlasSignDefinition {
    severity: 1 | 2 | 3;
    snippet: string;
}

interface MarkerPoint {
    x: number;
    y: number;
}

const SYSTEM_STYLES: Record<BodySystem, { color: string; label: string }> = {
    neurological: { color: '#B05CFF', label: 'Neurological' },
    gi: { color: '#FF9F43', label: 'GI' },
    respiratory: { color: '#35D8FF', label: 'Respiratory' },
    dermatological: { color: '#FFD84D', label: 'Dermatological' },
    musculoskeletal: { color: '#00FF88', label: 'Musculoskeletal' },
};

const SIGN_CATALOG: AtlasSignDefinition[] = [
    {
        id: 'vomiting',
        label: 'Vomiting',
        system: 'gi',
        region: 'abdomen',
        patterns: [/\bvomit(?:ing|ed)?\b/i, /\bemesis\b/i],
        explanation: 'Upper GI irritation, enteric inflammation, or toxin-mediated gastric signaling can trigger emesis.',
    },
    {
        id: 'diarrhea',
        label: 'Diarrhea',
        system: 'gi',
        region: 'abdomen',
        patterns: [/\bdiarrh(?:ea|eic)\b/i, /\bloose stool\b/i],
        explanation: 'Enterocyte injury, malabsorption, secretion, or dysbiosis can accelerate fluid-rich intestinal transit.',
    },
    {
        id: 'abdominal-pain',
        label: 'Abdominal Pain',
        system: 'gi',
        region: 'abdomen',
        patterns: [/\babdominal pain\b/i, /\btense abdomen\b/i, /\bcranial abdominal discomfort\b/i],
        explanation: 'Visceral inflammation, distension, or ischemia stimulates nociceptive pathways within the abdomen.',
    },
    {
        id: 'anorexia',
        label: 'Anorexia',
        system: 'gi',
        region: 'abdomen',
        patterns: [/\banorexia\b/i, /\binappetence\b/i, /\bdecreased appetite\b/i],
        explanation: 'Systemic cytokine signaling and visceral discomfort suppress appetite drive and feeding behavior.',
    },
    {
        id: 'cough',
        label: 'Cough',
        system: 'respiratory',
        region: 'thorax',
        patterns: [/\bcough(?:ing)?\b/i],
        explanation: 'Airway irritation or lower respiratory inflammation activates protective cough reflex arcs.',
    },
    {
        id: 'dyspnea',
        label: 'Dyspnea',
        system: 'respiratory',
        region: 'thorax',
        patterns: [/\bdyspn(?:ea|eic)\b/i, /\blabou?red breathing\b/i, /\brespiratory distress\b/i],
        explanation: 'Impaired gas exchange or airway restriction increases respiratory effort and recruitment.',
    },
    {
        id: 'nasal-discharge',
        label: 'Nasal Discharge',
        system: 'respiratory',
        region: 'head',
        patterns: [/\bnasal discharge\b/i, /\brhinorrhea\b/i],
        explanation: 'Inflammation of upper airway mucosa increases secretions and exudative drainage.',
    },
    {
        id: 'tachypnea',
        label: 'Tachypnea',
        system: 'respiratory',
        region: 'thorax',
        patterns: [/\btachypn(?:ea|eic)\b/i, /\bincreased respiratory rate\b/i],
        explanation: 'Compensatory respiratory drive rises in response to hypoxemia, acidosis, or thoracic pain.',
    },
    {
        id: 'seizures',
        label: 'Seizures',
        system: 'neurological',
        region: 'head',
        patterns: [/\bseizures?\b/i, /\bconvuls(?:ion|ing)\b/i],
        explanation: 'Cortical hyperexcitability reflects inflammatory, metabolic, toxic, or structural CNS disease.',
    },
    {
        id: 'ataxia',
        label: 'Ataxia',
        system: 'neurological',
        region: 'spine',
        patterns: [/\bataxia\b/i, /\bincoordination\b/i],
        explanation: 'Disrupted cerebellar, vestibular, or proprioceptive pathways impair coordinated gait control.',
    },
    {
        id: 'tremors',
        label: 'Tremors',
        system: 'neurological',
        region: 'spine',
        patterns: [/\btremors?\b/i],
        explanation: 'Neuromuscular instability or central motor pathway irritation can generate involuntary oscillations.',
    },
    {
        id: 'head-tilt',
        label: 'Head Tilt',
        system: 'neurological',
        region: 'head',
        patterns: [/\bhead tilt\b/i],
        explanation: 'Vestibular asymmetry alters postural orientation and head positioning.',
    },
    {
        id: 'pruritus',
        label: 'Pruritus',
        system: 'dermatological',
        region: 'skin',
        patterns: [/\bpruritus\b/i, /\bitch(?:ing|y)\b/i, /\bscratching\b/i],
        explanation: 'Cutaneous inflammation and peripheral itch mediators drive pruritic behavior.',
    },
    {
        id: 'alopecia',
        label: 'Alopecia',
        system: 'dermatological',
        region: 'skin',
        patterns: [/\balopecia\b/i, /\bhair loss\b/i],
        explanation: 'Follicular injury or chronic inflammatory self-trauma disrupts normal hair growth cycles.',
    },
    {
        id: 'skin-lesions',
        label: 'Skin Lesions',
        system: 'dermatological',
        region: 'skin',
        patterns: [/\blesions?\b/i, /\bcrusting\b/i, /\bpustules?\b/i, /\bdermatitis\b/i],
        explanation: 'Barrier breakdown, infection, or immune-mediated injury produces visible inflammatory lesions.',
    },
    {
        id: 'lameness',
        label: 'Lameness',
        system: 'musculoskeletal',
        region: 'forelimb',
        patterns: [/\blameness\b/i, /\blimp(?:ing)?\b/i],
        explanation: 'Painful loading, joint inflammation, or structural instability alters normal weight-bearing gait.',
    },
    {
        id: 'joint-swelling',
        label: 'Joint Swelling',
        system: 'musculoskeletal',
        region: 'forelimb',
        patterns: [/\bjoint swelling\b/i, /\bjoint effusion\b/i],
        explanation: 'Synovial inflammation and effusion expand periarticular soft tissues.',
    },
    {
        id: 'stiffness',
        label: 'Stiffness',
        system: 'musculoskeletal',
        region: 'hindlimb',
        patterns: [/\bstiffness\b/i, /\breluctance to move\b/i],
        explanation: 'Pain, inflammation, or neuromuscular dysfunction reduces fluidity of movement.',
    },
    {
        id: 'paresis',
        label: 'Paresis',
        system: 'musculoskeletal',
        region: 'hindlimb',
        patterns: [/\bparesis\b/i, /\bweakness\b/i],
        explanation: 'Motor unit weakness or spinal pathway injury reduces force generation and limb support.',
    },
];

const QUADRUPED_POINTS: Record<RegionKey, MarkerPoint> = {
    head: { x: 122, y: 124 },
    thorax: { x: 224, y: 158 },
    abdomen: { x: 304, y: 176 },
    forelimb: { x: 228, y: 242 },
    hindlimb: { x: 334, y: 246 },
    spine: { x: 262, y: 120 },
    skin: { x: 258, y: 144 },
};

const AVIAN_POINTS: Record<RegionKey, MarkerPoint> = {
    head: { x: 134, y: 134 },
    thorax: { x: 238, y: 162 },
    abdomen: { x: 278, y: 186 },
    forelimb: { x: 236, y: 186 },
    hindlimb: { x: 288, y: 248 },
    spine: { x: 228, y: 142 },
    skin: { x: 228, y: 172 },
};

function extractSnippet(content: string, match: RegExpMatchArray): string {
    const index = match.index ?? 0;
    const start = Math.max(0, index - 48);
    const end = Math.min(content.length, index + (match[0]?.length ?? 0) + 56);
    return content.slice(start, end).replace(/\s+/g, ' ').trim();
}

function inferSeverity(snippet: string): 1 | 2 | 3 {
    const lower = snippet.toLowerCase();
    if (/\bsevere|marked|profound|critical|refractory|acute distress\b/.test(lower)) return 3;
    if (/\bmoderate|persistent|progressive|frequent\b/.test(lower)) return 2;
    return 1;
}

function extractSigns(content: string): AtlasSign[] {
    const seen = new Set<string>();
    const results: AtlasSign[] = [];

    for (const sign of SIGN_CATALOG) {
        for (const pattern of sign.patterns) {
            const match = content.match(pattern);
            if (!match || seen.has(sign.id)) continue;
            seen.add(sign.id);
            const snippet = extractSnippet(content, match);
            results.push({
                ...sign,
                severity: inferSeverity(snippet),
                snippet,
            });
        }
    }

    return results.sort((a, b) => b.severity - a.severity || a.label.localeCompare(b.label));
}

function getSilhouette(species: Species) {
    switch (species) {
        case 'feline':
            return {
                label: 'Feline Atlas',
                points: QUADRUPED_POINTS,
                paths: [
                    'M98 166 C114 132,148 110,194 112 L286 110 C322 110,356 120,394 150 L426 160 L452 148 L462 156 L442 170 L440 194 L426 246 L408 246 L400 194 L364 190 L340 246 L322 246 L316 190 L212 192 L186 248 L168 248 L174 190 L130 188 L104 248 L86 248 L96 186 L78 178 L82 166 Z',
                    'M92 164 C96 138,112 122,124 118 L130 128 C120 132,110 144,108 160 Z',
                    'M438 152 C452 144,470 138,486 146 L490 156 C474 160,462 164,448 166 Z',
                    'M148 122 L130 92 L136 90 L162 118 Z',
                    'M174 120 L166 88 L174 86 L188 116 Z',
                ],
            };
        case 'equine':
            return {
                label: 'Equine Atlas',
                points: QUADRUPED_POINTS,
                paths: [
                    'M88 168 C114 132,170 104,248 104 L352 106 C410 108,466 132,520 170 L550 178 L548 192 L528 198 L516 252 L496 252 L490 198 L422 196 L398 252 L378 252 L374 196 L268 196 L244 252 L224 252 L228 194 L164 192 L144 252 L124 252 L130 188 L94 182 L90 170 Z',
                    'M82 168 C90 142,106 124,128 116 L138 122 C122 136,112 148,108 166 Z',
                    'M520 172 C536 164,556 162,574 170 L578 182 C560 186,542 186,528 184 Z',
                    'M128 118 L108 82 L118 76 L150 116 Z',
                ],
            };
        case 'bovine':
            return {
                label: 'Bovine Atlas',
                points: QUADRUPED_POINTS,
                paths: [
                    'M92 170 C116 136,160 112,234 112 L346 112 C404 112,450 126,500 164 L540 170 L542 188 L520 194 L510 252 L490 252 L482 196 L414 194 L392 252 L372 252 L368 194 L252 194 L234 252 L214 252 L218 194 L154 194 L134 252 L114 252 L120 192 L90 188 L88 174 Z',
                    'M84 168 C90 144,102 126,122 118 L130 124 C118 136,110 148,106 166 Z',
                    'M502 164 C520 150,542 144,566 148 L572 160 C554 168,532 172,512 172 Z',
                    'M126 118 L118 88 L126 86 L136 114 Z',
                    'M150 118 L152 86 L160 88 L160 116 Z',
                ],
            };
        case 'avian':
            return {
                label: 'Avian Atlas',
                points: AVIAN_POINTS,
                paths: [
                    'M110 170 C122 136,168 112,226 114 C284 118,334 138,380 176 L326 182 L268 230 L214 220 L180 246 L160 246 L172 214 L146 198 L118 194 Z',
                    'M106 168 L86 154 L104 146 L118 160 Z',
                    'M212 122 C242 96,282 92,332 116 L356 146 L300 154 L246 146 Z',
                    'M250 232 L258 270 L246 270 L238 236 Z',
                    'M286 230 L294 268 L282 268 L274 234 Z',
                ],
            };
        case 'porcine':
            return {
                label: 'Porcine Atlas',
                points: QUADRUPED_POINTS,
                paths: [
                    'M94 174 C114 140,152 118,214 116 L332 116 C392 118,438 132,484 164 L526 170 L532 190 L510 196 L500 250 L480 250 L472 196 L404 194 L386 250 L366 250 L362 194 L252 194 L236 250 L216 250 L220 194 L158 194 L138 250 L118 250 L126 194 L96 190 L92 176 Z',
                    'M88 170 C92 148,106 130,124 120 L134 126 C122 138,112 150,110 168 Z',
                    'M488 164 C504 156,524 154,542 162 L548 174 C532 176,510 176,494 172 Z',
                ],
            };
        case 'ovine':
            return {
                label: 'Ovine Atlas',
                points: QUADRUPED_POINTS,
                paths: [
                    'M98 174 C116 140,156 118,220 118 L330 118 C388 118,436 134,482 168 L516 174 L520 190 L500 196 L492 248 L474 248 L468 198 L402 194 L382 248 L364 248 L360 194 L252 194 L236 248 L218 248 L220 194 L158 194 L140 248 L122 248 L128 194 L98 190 L94 178 Z',
                    'M92 172 C98 146,112 126,128 118 L138 124 C126 138,116 150,112 170 Z',
                    'M482 166 C496 154,516 148,536 152 L542 164 C526 172,504 174,488 174 Z',
                    'M132 116 C142 104,154 100,166 102 L168 114 C154 114,144 116,134 120 Z',
                ],
            };
        default:
            return {
                label: 'Canine Atlas',
                points: QUADRUPED_POINTS,
                paths: [
                    'M96 168 C114 134,156 110,222 110 L330 110 C386 112,434 128,482 162 L520 168 L526 186 L506 194 L498 248 L478 248 L470 194 L402 192 L384 248 L364 248 L360 192 L252 192 L236 248 L216 248 L220 192 L158 192 L138 248 L118 248 L124 192 L96 188 L92 172 Z',
                    'M90 166 C96 142,108 124,126 116 L136 122 C124 136,114 148,110 164 Z',
                    'M484 162 C500 150,520 144,542 148 L548 160 C532 168,508 172,490 172 Z',
                    'M126 118 L120 86 L128 84 L138 116 Z',
                ],
            };
    }
}

export default function ClinicalSignsAtlas({ messageContent, queryText }: ClinicalSignsAtlasProps) {
    const species = useMemo(
        () => {
            const detected = detectSpeciesFromTexts([queryText, messageContent]);
            return detected === 'unknown' ? 'canine' : detected;
        },
        [messageContent, queryText],
    );
    const signs = useMemo(() => extractSigns(messageContent), [messageContent]);
    const silhouette = useMemo(() => getSilhouette(species), [species]);
    const [heatmapMode, setHeatmapMode] = useState(false);
    const [selectedSignId, setSelectedSignId] = useState<string | null>(signs[0]?.id ?? null);

    const selectedSign = useMemo(
        () => signs.find((sign) => sign.id === selectedSignId) ?? signs[0] ?? null,
        [selectedSignId, signs],
    );

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <Eye className="h-4 w-4 text-[#00ff88]" />
                        <h3 className="font-mono text-xs uppercase tracking-[0.22em] text-[#00ff88]">
                            {silhouette.label}
                        </h3>
                    </div>
                    <p className="max-w-2xl font-mono text-[11px] leading-relaxed text-white/58">
                        Species-aware clinical sign mapping extracted directly from the current case response. Hover or tap a marker to inspect the active sign and pathophysiology.
                    </p>
                </div>

                <button
                    type="button"
                    onClick={() => setHeatmapMode((current) => !current)}
                    className={`inline-flex items-center gap-2 border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors ${
                        heatmapMode
                            ? 'border-[#00ff88]/35 bg-[#00ff88]/12 text-[#00ff88]'
                            : 'border-white/10 bg-white/[0.02] text-white/66 hover:border-white/20 hover:text-white'
                    }`}
                >
                    <Flame className="h-3 w-3" />
                    {heatmapMode ? 'Heatmap On' : 'Heatmap Off'}
                </button>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(260px,0.85fr)]">
                <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                        <div className="border border-white/10 bg-white/[0.02] px-3 py-2">
                            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/34">Species</div>
                            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-white/76">{species}</div>
                        </div>
                        <div className="border border-white/10 bg-white/[0.02] px-3 py-2">
                            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/34">Active Signs</div>
                            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-white/76">{signs.length}</div>
                        </div>
                        <div className="border border-white/10 bg-white/[0.02] px-3 py-2">
                            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/34">Top Severity</div>
                            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-white/76">
                                {signs[0] ? `L${signs[0].severity}` : 'n/a'}
                            </div>
                        </div>
                    </div>

                    <div className="overflow-hidden border border-white/10 bg-[#050505] p-3">
                        <svg viewBox="0 0 620 320" className="h-auto w-full" role="img" aria-label={`${species} clinical signs atlas`}>
                            <rect x="0" y="0" width="620" height="320" fill="#050505" />
                            <rect x="18" y="18" width="584" height="284" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.06)" />
                            <g fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.18)" strokeWidth="2">
                                {silhouette.paths.map((path) => (
                                    <path key={path} d={path} />
                                ))}
                            </g>

                            {signs.map((sign) => {
                                const point = silhouette.points[sign.region];
                                const style = SYSTEM_STYLES[sign.system];
                                const radius = sign.severity === 3 ? 16 : sign.severity === 2 ? 12 : 9;
                                const duration = sign.severity === 3 ? '0.8s' : sign.severity === 2 ? '1.2s' : '1.7s';

                                return (
                                    <g key={sign.id} onMouseEnter={() => setSelectedSignId(sign.id)} onClick={() => setSelectedSignId(sign.id)} className="cursor-pointer">
                                        {heatmapMode ? (
                                            <>
                                                <circle cx={point.x} cy={point.y} r={radius * 3.8} fill={style.color} fillOpacity={0.08 * sign.severity}>
                                                    <animate attributeName="opacity" values={`${0.16 * sign.severity};${0.28 * sign.severity};${0.16 * sign.severity}`} dur={duration} repeatCount="indefinite" />
                                                </circle>
                                                <circle cx={point.x} cy={point.y} r={radius * 2.2} fill={style.color} fillOpacity={0.13 * sign.severity}>
                                                    <animate attributeName="r" values={`${radius * 2};${radius * 2.6};${radius * 2}`} dur={duration} repeatCount="indefinite" />
                                                </circle>
                                            </>
                                        ) : null}
                                        <circle cx={point.x} cy={point.y} r={radius} fill={style.color} fillOpacity="0.16" stroke={style.color} strokeWidth="1.8">
                                            <animate attributeName="r" values={`${radius};${radius + 4};${radius}`} dur={duration} repeatCount="indefinite" />
                                            <animate attributeName="opacity" values="0.7;1;0.7" dur={duration} repeatCount="indefinite" />
                                        </circle>
                                        <circle cx={point.x} cy={point.y} r="3.6" fill={style.color} />
                                    </g>
                                );
                            })}

                            <text x="44" y="54" fontSize="11" fill="#00FF88" className="font-mono uppercase tracking-[0.24em]">
                                Anatomical Sign Overlay
                            </text>
                            <text x="44" y="72" fontSize="10" fill="rgba(255,255,255,0.42)" className="font-mono uppercase tracking-[0.16em]">
                                {heatmapMode ? 'Severity heatmap mode' : 'Marker pulse mode'}
                            </text>
                        </svg>
                    </div>

                    <div className="border border-white/10 bg-white/[0.02] p-3">
                        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/36">Body System Legend</div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {Object.entries(SYSTEM_STYLES).map(([system, style]) => {
                                const count = signs.filter((sign) => sign.system === system).length;
                                return (
                                    <div key={system} className="flex items-center justify-between border border-white/8 bg-black/30 px-3 py-2">
                                        <div className="flex items-center gap-2">
                                            <div className="h-2.5 w-2.5 rounded-full" style={{ background: style.color, boxShadow: `0 0 12px ${style.color}55` }} />
                                            <span className="font-mono text-[11px] text-white/74">{style.label}</span>
                                        </div>
                                        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/34">{count}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="space-y-3">
                    <div className="border border-white/10 bg-white/[0.02] p-3">
                        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/36">Selected Sign</div>
                        {selectedSign ? (
                            <div className="mt-3 space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                    <span className="font-mono text-[11px] uppercase tracking-[0.14em]" style={{ color: SYSTEM_STYLES[selectedSign.system].color }}>
                                        {selectedSign.label}
                                    </span>
                                    <span className="border border-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/54">
                                        Severity {selectedSign.severity}
                                    </span>
                                </div>
                                <p className="font-mono text-[11px] leading-relaxed text-white/74">
                                    {selectedSign.explanation}
                                </p>
                                <div>
                                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/34">Detected Context</div>
                                    <p className="mt-1 font-mono text-[11px] leading-relaxed text-white/56">
                                        {selectedSign.snippet}
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <p className="mt-3 font-mono text-[11px] leading-relaxed text-white/48">
                                No canonical clinical signs were detected in the current response. The atlas will activate as soon as system-linked findings appear in the case narrative.
                            </p>
                        )}
                    </div>

                    <div className="border border-white/10 bg-white/[0.02] p-3">
                        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/36">Active Signs</div>
                        <div className="mt-3 max-h-[300px] space-y-2 overflow-y-auto pr-1">
                            {signs.length > 0 ? (
                                signs.map((sign) => {
                                    const style = SYSTEM_STYLES[sign.system];
                                    const active = sign.id === selectedSign?.id;

                                    return (
                                        <button
                                            key={sign.id}
                                            type="button"
                                            onClick={() => setSelectedSignId(sign.id)}
                                            className={`w-full border px-3 py-2 text-left transition-colors ${
                                                active
                                                    ? 'border-[#00ff88]/24 bg-[#00ff88]/8'
                                                    : 'border-white/8 bg-black/25 hover:border-white/16'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="font-mono text-[11px] uppercase tracking-[0.14em]" style={{ color: style.color }}>
                                                    {sign.label}
                                                </span>
                                                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/36">
                                                    {style.label}
                                                </span>
                                            </div>
                                        </button>
                                    );
                                })
                            ) : (
                                <p className="font-mono text-[11px] leading-relaxed text-white/48">
                                    No atlas markers activated for this response yet.
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
