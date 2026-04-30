'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { Download, Dna } from 'lucide-react';

type OrganismType = 'virus' | 'bacteria' | 'parasite' | 'fungus' | 'prion';
type GenomeLayout = 'circular' | 'linear' | 'segmented' | 'bacterial' | 'parasite' | 'prion';
type RegionCategory = 'structural' | 'virulence' | 'regulatory' | 'replication';

interface GenomicVisualizerProps {
    messageContent: string;
    topic?: string;
}

interface GenomeRegion {
    id: string;
    label: string;
    category: RegionCategory;
    start: number;
    end: number;
    function: string;
    mutationSites: string[];
    drugTargets: string[];
}

interface SerotypeProfile {
    id: string;
    label: string;
    genomeSize: string;
    gcContent: string;
    layers: string[];
    regions: GenomeRegion[];
}

interface GenomeProfile {
    title: string;
    organismType: OrganismType;
    layout: GenomeLayout;
    familyLabel: string;
    summary: string;
    virulenceFocus: string;
    labels: string[];
    serotypes: SerotypeProfile[];
}

interface HoveredRegion {
    region: GenomeRegion;
    x: number;
    y: number;
}

const CATEGORY_STYLES: Record<RegionCategory, { color: string; glow: string; label: string }> = {
    structural: { color: '#00FF88', glow: 'rgba(0,255,136,0.25)', label: 'Structural Proteins' },
    virulence: { color: '#FF9F43', glow: 'rgba(255,159,67,0.24)', label: 'Virulence Factors' },
    regulatory: { color: '#4DA3FF', glow: 'rgba(77,163,255,0.22)', label: 'Regulatory Regions' },
    replication: { color: '#35D8FF', glow: 'rgba(53,216,255,0.22)', label: 'Replication Machinery' },
};

const COMMON_VIRAL_SEROTYPES: SerotypeProfile[] = [
    {
        id: 'wild-type',
        label: 'Wild Type',
        genomeSize: '4.8 kb',
        gcContent: '43%',
        layers: ['capsid shell', 'surface loop motifs', 'host receptor footprint'],
        regions: [
            {
                id: 'cap',
                label: 'VP2',
                category: 'structural',
                start: 0.08,
                end: 0.33,
                function: 'Major capsid protein driving receptor binding and serotype identity.',
                mutationSites: ['loop 3', 'capsid shoulder', 'neutralization ridge'],
                drugTargets: ['capsid assembly blockers', 'neutralizing antibody epitope'],
            },
            {
                id: 'rep',
                label: 'NS1',
                category: 'replication',
                start: 0.34,
                end: 0.62,
                function: 'Replication initiator coordinating helicase activity and genome packaging.',
                mutationSites: ['ATPase pocket', 'nickase domain'],
                drugTargets: ['replication helicase inhibitors'],
            },
            {
                id: 'vir',
                label: 'Tropism Loop',
                category: 'virulence',
                start: 0.63,
                end: 0.8,
                function: 'Host range and tissue tropism determinant linked to virulence shifts.',
                mutationSites: ['host-switch hotspot', 'surface charge cluster'],
                drugTargets: ['entry blockade peptides'],
            },
            {
                id: 'ltr',
                label: 'UTR',
                category: 'regulatory',
                start: 0.81,
                end: 0.98,
                function: 'Regulatory termini controlling replication timing and transcript yield.',
                mutationSites: ['promoter hairpin', 'origin loop'],
                drugTargets: ['antisense regulatory probes'],
            },
        ],
    },
    {
        id: 'variant-a',
        label: 'Variant A',
        genomeSize: '5.1 kb',
        gcContent: '46%',
        layers: ['capsid shell', 'accessory envelope domain', 'fusion trigger'],
        regions: [
            {
                id: 'gag',
                label: 'Gag',
                category: 'structural',
                start: 0.05,
                end: 0.24,
                function: 'Core structural scaffold for virion assembly.',
                mutationSites: ['matrix domain', 'capsid linker'],
                drugTargets: ['assembly inhibitors'],
            },
            {
                id: 'pol',
                label: 'Pol',
                category: 'replication',
                start: 0.25,
                end: 0.56,
                function: 'Polymerase block encoding polymerase, protease, and integrative machinery.',
                mutationSites: ['active site triad', 'proofreading loop'],
                drugTargets: ['polymerase inhibitors', 'protease inhibitors'],
            },
            {
                id: 'env',
                label: 'Env',
                category: 'virulence',
                start: 0.57,
                end: 0.82,
                function: 'Surface glycoprotein mediating host cell entry and immune escape.',
                mutationSites: ['fusion peptide', 'glycan shield'],
                drugTargets: ['fusion inhibitors', 'entry antibodies'],
            },
            {
                id: 'ltr',
                label: 'LTR',
                category: 'regulatory',
                start: 0.83,
                end: 0.98,
                function: 'Terminal repeats regulating transcription initiation and latency.',
                mutationSites: ['promoter enhancer', 'splice acceptor'],
                drugTargets: ['transcription silencers'],
            },
        ],
    },
    {
        id: 'variant-b',
        label: 'Variant B',
        genomeSize: '13.2 kb',
        gcContent: '38%',
        layers: ['envelope', 'matrix shell', 'nucleocapsid'],
        regions: [
            {
                id: 'np',
                label: 'N',
                category: 'structural',
                start: 0.04,
                end: 0.22,
                function: 'Nucleocapsid complex binding genomic RNA.',
                mutationSites: ['RNA clamp', 'oligomerization helix'],
                drugTargets: ['ribonucleoprotein disruptors'],
            },
            {
                id: 'p',
                label: 'P/L',
                category: 'replication',
                start: 0.23,
                end: 0.54,
                function: 'Polymerase cofactor and replicase complex responsible for transcription.',
                mutationSites: ['polymerase finger loop', 'cofactor docking face'],
                drugTargets: ['polymerase inhibitors'],
            },
            {
                id: 'f',
                label: 'F/H',
                category: 'virulence',
                start: 0.55,
                end: 0.77,
                function: 'Fusion and attachment proteins controlling syncytia formation and host spread.',
                mutationSites: ['cleavage site', 'fusion stalk'],
                drugTargets: ['fusion blockers', 'attachment antibodies'],
            },
            {
                id: 'leader',
                label: 'Leader',
                category: 'regulatory',
                start: 0.78,
                end: 0.96,
                function: 'Leader and trailer regions shape replication polarity and packaging.',
                mutationSites: ['transcription gradient motif'],
                drugTargets: ['transcription attenuation'],
            },
        ],
    },
];

const COMMON_BACTERIAL_SEROTYPES: SerotypeProfile[] = [
    {
        id: 'core-genome',
        label: 'Core Genome',
        genomeSize: '4.7 Mb',
        gcContent: '51%',
        layers: ['circular chromosome', 'virulence plasmid', 'surface antigen island'],
        regions: [
            {
                id: 'omp',
                label: 'Omp Cluster',
                category: 'structural',
                start: 0.04,
                end: 0.18,
                function: 'Outer membrane structural proteins anchoring the cell envelope.',
                mutationSites: ['porin loop', 'beta barrel gate'],
                drugTargets: ['membrane destabilizers'],
            },
            {
                id: 't3ss',
                label: 'T3SS',
                category: 'virulence',
                start: 0.22,
                end: 0.38,
                function: 'Secretion island delivering effector proteins into host cells.',
                mutationSites: ['needle tip', 'effector promoter'],
                drugTargets: ['secretion ATPase blockers'],
            },
            {
                id: 'ori',
                label: 'oriC',
                category: 'regulatory',
                start: 0.44,
                end: 0.56,
                function: 'Chromosomal origin coordinating bidirectional replication timing.',
                mutationSites: ['DnaA box cluster'],
                drugTargets: ['replication initiation inhibitors'],
            },
            {
                id: 'gyr',
                label: 'gyrA/parC',
                category: 'replication',
                start: 0.62,
                end: 0.86,
                function: 'Topoisomerase and replication fidelity machinery.',
                mutationSites: ['quinolone resistance hotspot'],
                drugTargets: ['fluoroquinolone site', 'topoisomerase inhibitors'],
            },
        ],
    },
    {
        id: 'plasmid-rich',
        label: 'Plasmid Rich',
        genomeSize: '5.2 Mb',
        gcContent: '48%',
        layers: ['circular chromosome', 'resistance plasmid A', 'virulence plasmid B'],
        regions: [
            {
                id: 'fim',
                label: 'Fimbriae',
                category: 'structural',
                start: 0.08,
                end: 0.21,
                function: 'Adhesion organelle assembly genes controlling attachment strength.',
                mutationSites: ['tip adhesin', 'shaft repeat'],
                drugTargets: ['anti-adhesion compounds'],
            },
            {
                id: 'tox',
                label: 'Toxin Cassette',
                category: 'virulence',
                start: 0.29,
                end: 0.41,
                function: 'Toxin and invasion cassette driving tissue damage.',
                mutationSites: ['toxin promoter', 'secretion signal'],
                drugTargets: ['toxin neutralizers'],
            },
            {
                id: 'reg',
                label: 'QS Operon',
                category: 'regulatory',
                start: 0.45,
                end: 0.58,
                function: 'Quorum sensing locus coordinating density-dependent virulence expression.',
                mutationSites: ['autoinducer receptor'],
                drugTargets: ['quorum sensing antagonists'],
            },
            {
                id: 'replicon',
                label: 'Replicon',
                category: 'replication',
                start: 0.64,
                end: 0.9,
                function: 'Replicase and partition genes maintaining plasmid inheritance.',
                mutationSites: ['partition ATPase'],
                drugTargets: ['plasmid curing agents'],
            },
        ],
    },
];

const COMMON_PARASITE_SEROTYPES: SerotypeProfile[] = [
    {
        id: 'merozoite',
        label: 'Merozoite Phase',
        genomeSize: '23 Mb',
        gcContent: '34%',
        layers: ['nuclear genome', 'mitochondrion', 'apicoplast-like organelle'],
        regions: [
            {
                id: 'surface',
                label: 'Surface Ag',
                category: 'structural',
                start: 0.08,
                end: 0.22,
                function: 'Stage-specific surface antigens exposed to host immunity.',
                mutationSites: ['epitope repeat block'],
                drugTargets: ['surface antibody target'],
            },
            {
                id: 'adhesin',
                label: 'Invasion Ligand',
                category: 'virulence',
                start: 0.24,
                end: 0.42,
                function: 'Host cell invasion ligand controlling tropism and disease severity.',
                mutationSites: ['binding loop', 'shedding motif'],
                drugTargets: ['receptor blockade peptide'],
            },
            {
                id: 'switch',
                label: 'Variant Switch',
                category: 'regulatory',
                start: 0.48,
                end: 0.64,
                function: 'Epigenetic switching region underlying antigenic variation.',
                mutationSites: ['silencer repeat'],
                drugTargets: ['epigenetic silencing modulators'],
            },
            {
                id: 'apico',
                label: 'Organelle Rep',
                category: 'replication',
                start: 0.66,
                end: 0.9,
                function: 'Mitochondrial and organellar replication machinery for survival.',
                mutationSites: ['cytochrome b hotspot'],
                drugTargets: ['electron transport inhibitors'],
            },
        ],
    },
    {
        id: 'tissue-cyst',
        label: 'Tissue Cyst',
        genomeSize: '27 Mb',
        gcContent: '31%',
        layers: ['nuclear genome', 'mitochondrion', 'cyst wall program'],
        regions: [
            {
                id: 'wall',
                label: 'Wall Protein',
                category: 'structural',
                start: 0.1,
                end: 0.24,
                function: 'Cyst wall architecture supporting persistence.',
                mutationSites: ['repeat-rich wall segment'],
                drugTargets: ['cyst wall synthesis disruptors'],
            },
            {
                id: 'effector',
                label: 'Effector',
                category: 'virulence',
                start: 0.28,
                end: 0.46,
                function: 'Secreted effector altering host transcription and immune tone.',
                mutationSites: ['export signal', 'host-binding groove'],
                drugTargets: ['secretion inhibition'],
            },
            {
                id: 'brady',
                label: 'Stage Switch',
                category: 'regulatory',
                start: 0.5,
                end: 0.66,
                function: 'Differentiation switch between tachyzoite and cyst persistence states.',
                mutationSites: ['stress response promoter'],
                drugTargets: ['differentiation blockers'],
            },
            {
                id: 'mito',
                label: 'Mito Program',
                category: 'replication',
                start: 0.68,
                end: 0.92,
                function: 'Oxidative metabolism and mitochondrial maintenance machinery.',
                mutationSites: ['Qo site'],
                drugTargets: ['cytochrome bc1 inhibitors'],
            },
        ],
    },
];

const COMMON_FUNGAL_SEROTYPES: SerotypeProfile[] = [
    {
        id: 'spore-form',
        label: 'Spore Form',
        genomeSize: '31 Mb',
        gcContent: '49%',
        layers: ['nuclear chromosomes', 'mitochondrial genome', 'cell-wall biosynthesis network'],
        regions: [
            {
                id: 'wall',
                label: 'Wall Synthase',
                category: 'structural',
                start: 0.12,
                end: 0.28,
                function: 'Cell wall synthase complex shaping the fungal shell.',
                mutationSites: ['beta-glucan synthase pocket'],
                drugTargets: ['echinocandins'],
            },
            {
                id: 'protease',
                label: 'Protease',
                category: 'virulence',
                start: 0.31,
                end: 0.46,
                function: 'Secreted proteases facilitating tissue invasion.',
                mutationSites: ['substrate cleft'],
                drugTargets: ['protease blockers'],
            },
            {
                id: 'stress',
                label: 'Stress Hubs',
                category: 'regulatory',
                start: 0.51,
                end: 0.68,
                function: 'Stress response and morphogenesis regulators.',
                mutationSites: ['heat shock promoter'],
                drugTargets: ['Hsp90 network inhibitors'],
            },
            {
                id: 'erg',
                label: 'Ergosterol',
                category: 'replication',
                start: 0.7,
                end: 0.9,
                function: 'Sterol synthesis enzymes required for membrane replication.',
                mutationSites: ['azole resistance site'],
                drugTargets: ['azoles', 'allylamines'],
            },
        ],
    },
];

const COMMON_PRION_SEROTYPES: SerotypeProfile[] = [
    {
        id: 'misfolded-seed',
        label: 'Seeded Isoform',
        genomeSize: 'Protein-only',
        gcContent: 'n/a',
        layers: ['alpha-helical host form', 'beta-sheet prion core', 'templating front'],
        regions: [
            {
                id: 'n-term',
                label: 'Flexible Tail',
                category: 'regulatory',
                start: 0.08,
                end: 0.28,
                function: 'N-terminal region influencing metal binding and conversion susceptibility.',
                mutationSites: ['octapeptide repeat'],
                drugTargets: ['stabilizing ligands'],
            },
            {
                id: 'core',
                label: 'Amyloid Core',
                category: 'structural',
                start: 0.31,
                end: 0.58,
                function: 'Beta-sheet rich structural core of the pathogenic isoform.',
                mutationSites: ['hydrophobic segment'],
                drugTargets: ['aggregation disruptors'],
            },
            {
                id: 'template',
                label: 'Template Edge',
                category: 'virulence',
                start: 0.6,
                end: 0.82,
                function: 'Growth face templating host protein misfolding and fibril extension.',
                mutationSites: ['seed amplification face'],
                drugTargets: ['seed-capping antibodies'],
            },
            {
                id: 'conversion',
                label: 'Conversion Loop',
                category: 'replication',
                start: 0.84,
                end: 0.96,
                function: 'Conformational propagation zone enabling self-amplification.',
                mutationSites: ['conversion nucleus'],
                drugTargets: ['conformation stabilizers'],
            },
        ],
    },
];

function detectOrganismType(topic: string, messageContent: string): OrganismType {
    const lower = `${topic} ${messageContent}`.toLowerCase();

    if (/\bprion|transmissible spongiform|scrapie|bse\b/.test(lower)) return 'prion';
    if (/\bfung(al|us|i)|dermatophyte|aspergillus|candida|ringworm|mycosis\b/.test(lower)) return 'fungus';
    if (/\bparasite|protozo|helminth|babesia|toxoplasma|trypanosom|giardia|coccidia|plasmodium\b/.test(lower)) return 'parasite';
    if (/\bbacteri|salmonella|leptospira|staphyl|strept|clostrid|brucella|e\.?\s?coli\b/.test(lower)) return 'bacteria';
    return 'virus';
}

function buildGenomeProfile(topic: string, messageContent: string): GenomeProfile {
    const organismType = detectOrganismType(topic, messageContent);

    switch (organismType) {
        case 'bacteria':
            return {
                title: topic || 'Bacterial Genome',
                organismType,
                layout: 'bacterial',
                familyLabel: 'Chromosome + plasmid architecture',
                summary: 'Circular chromosome with accessory plasmids, pathogenicity islands, and replication landmarks.',
                virulenceFocus: 'Virulence islands and plasmid-borne resistance modules are highlighted.',
                labels: ['chromosome', 'plasmid', 'pathogenicity island', 'outer membrane'],
                serotypes: COMMON_BACTERIAL_SEROTYPES,
            };
        case 'parasite':
            return {
                title: topic || 'Parasitic Genome',
                organismType,
                layout: 'parasite',
                familyLabel: 'Nuclear + mitochondrial program',
                summary: 'Dual-compartment genome model showing nuclear, mitochondrial, and stage-switching regions.',
                virulenceFocus: 'Invasion ligands and antigenic switching hubs are emphasized.',
                labels: ['nucleus', 'mitochondrion', 'surface antigen', 'stage switch'],
                serotypes: COMMON_PARASITE_SEROTYPES,
            };
        case 'fungus':
            return {
                title: topic || 'Fungal Genome',
                organismType,
                layout: 'parasite',
                familyLabel: 'Chromosomal fungal architecture',
                summary: 'Nuclear chromosomes paired with mitochondrial and cell-wall biosynthesis programs.',
                virulenceFocus: 'Cell-wall synthesis and stress-response determinants are highlighted.',
                labels: ['nucleus', 'mitochondrion', 'cell wall', 'stress hub'],
                serotypes: COMMON_FUNGAL_SEROTYPES,
            };
        case 'prion':
            return {
                title: topic || 'Prion Structural Map',
                organismType,
                layout: 'prion',
                familyLabel: 'Protein conformational topology',
                summary: 'Protein-only architecture mapping fold conversion, templating surface, and amyloid core.',
                virulenceFocus: 'Template edge and conversion loop are highlighted as propagation drivers.',
                labels: ['host fold', 'amyloid core', 'templating edge', 'conversion loop'],
                serotypes: COMMON_PRION_SEROTYPES,
            };
        default:
            return {
                title: topic || 'Viral Genome',
                organismType,
                layout: topic.toLowerCase().includes('segmented') ? 'segmented' : 'linear',
                familyLabel: 'Genome and envelope architecture',
                summary: 'Viral genomic scaffold with structural proteins, virulence loops, and replication machinery.',
                virulenceFocus: 'Surface proteins and host-tropism domains are highlighted.',
                labels: ['capsid', 'envelope', 'surface protein', 'replication complex'],
                serotypes: COMMON_VIRAL_SEROTYPES,
            };
    }
}

function polarToCartesian(cx: number, cy: number, radius: number, angle: number) {
    return {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
    };
}

function describeType(type: OrganismType) {
    switch (type) {
        case 'bacteria':
            return 'Bacterial';
        case 'parasite':
            return 'Parasitic';
        case 'fungus':
            return 'Fungal';
        case 'prion':
            return 'Prion';
        default:
            return 'Viral';
    }
}

export default function GenomicVisualizer({ messageContent, topic }: GenomicVisualizerProps) {
    const svgRef = useRef<SVGSVGElement | null>(null);
    const gradientId = useId().replace(/:/g, '_');
    const profile = useMemo(() => buildGenomeProfile(topic ?? '', messageContent), [messageContent, topic]);
    const [selectedSerotype, setSelectedSerotype] = useState(profile.serotypes[0]?.id ?? '');
    const [hoveredRegion, setHoveredRegion] = useState<HoveredRegion | null>(null);

    const activeSerotype = useMemo(
        () => profile.serotypes.find((item) => item.id === selectedSerotype) ?? profile.serotypes[0],
        [profile.serotypes, selectedSerotype],
    );

    const handleExport = () => {
        if (!svgRef.current || !activeSerotype) return;
        const serialized = new XMLSerializer().serializeToString(svgRef.current);
        const blob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${(profile.title || 'genome').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-map.svg`;
        anchor.click();
        URL.revokeObjectURL(url);
    };

    const showTooltip = (region: GenomeRegion, event: React.MouseEvent<SVGElement>) => {
        const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
        if (!bounds) return;
        setHoveredRegion({
            region,
            x: event.clientX - bounds.left + 10,
            y: event.clientY - bounds.top + 10,
        });
    };

    const hideTooltip = () => setHoveredRegion(null);

    if (!activeSerotype) return null;

    const renderLinearGenome = () => (
        <>
            <rect x="80" y="150" width="560" height="24" rx="12" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.1)" />
            {activeSerotype.regions.map((region) => {
                const x = 80 + region.start * 560;
                const width = Math.max(18, (region.end - region.start) * 560);
                const style = CATEGORY_STYLES[region.category];

                return (
                    <g key={region.id}>
                        <rect
                            x={x}
                            y="148"
                            width={width}
                            height="28"
                            rx="8"
                            fill={style.color}
                            fillOpacity="0.14"
                            stroke={style.color}
                            strokeWidth="1.5"
                            onMouseMove={(event) => showTooltip(region, event)}
                            onMouseLeave={hideTooltip}
                            onClick={(event) => showTooltip(region, event)}
                            className="cursor-pointer"
                        />
                        <circle cx={x + width / 2} cy="135" r="4" fill={style.color}>
                            <animate attributeName="r" values="4;6;4" dur="1.8s" repeatCount="indefinite" />
                            <animate attributeName="opacity" values="0.5;1;0.5" dur="1.8s" repeatCount="indefinite" />
                        </circle>
                        <text
                            x={x + width / 2}
                            y="118"
                            textAnchor="middle"
                            fontSize="11"
                            fill={style.color}
                            className="font-mono tracking-[0.14em]"
                        >
                            {region.label}
                        </text>
                    </g>
                );
            })}
            <text x="80" y="206" fontSize="10" fill="rgba(255,255,255,0.34)" className="font-mono uppercase tracking-[0.22em]">
                5&apos; regulatory terminus
            </text>
            <text x="640" y="206" textAnchor="end" fontSize="10" fill="rgba(255,255,255,0.34)" className="font-mono uppercase tracking-[0.22em]">
                3&apos; packaging terminus
            </text>
        </>
    );

    const renderCircularGenome = () => {
        const cx = 360;
        const cy = 165;
        const outerRadius = 96;
        const innerRadius = 66;

        return (
            <g>
                <circle cx={cx} cy={cy} r={outerRadius + 28} fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.06)" />
                <g>
                    <animateTransform attributeName="transform" attributeType="XML" type="rotate" from={`0 ${cx} ${cy}`} to={`360 ${cx} ${cy}`} dur="38s" repeatCount="indefinite" />
                    {activeSerotype.regions.map((region) => {
                        const style = CATEGORY_STYLES[region.category];
                        const startAngle = region.start * Math.PI * 2 - Math.PI / 2;
                        const endAngle = region.end * Math.PI * 2 - Math.PI / 2;
                        const startOuter = polarToCartesian(cx, cy, outerRadius, startAngle);
                        const endOuter = polarToCartesian(cx, cy, outerRadius, endAngle);
                        const startInner = polarToCartesian(cx, cy, innerRadius, endAngle);
                        const endInner = polarToCartesian(cx, cy, innerRadius, startAngle);
                        const largeArcFlag = region.end - region.start > 0.5 ? 1 : 0;
                        const path = [
                            `M ${startOuter.x} ${startOuter.y}`,
                            `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${endOuter.x} ${endOuter.y}`,
                            `L ${startInner.x} ${startInner.y}`,
                            `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${endInner.x} ${endInner.y}`,
                            'Z',
                        ].join(' ');
                        const labelAngle = (startAngle + endAngle) / 2;
                        const labelPoint = polarToCartesian(cx, cy, outerRadius + 44, labelAngle);

                        return (
                            <g key={region.id}>
                                <path
                                    d={path}
                                    fill={style.color}
                                    fillOpacity="0.16"
                                    stroke={style.color}
                                    strokeWidth="1.4"
                                    onMouseMove={(event) => showTooltip(region, event)}
                                    onMouseLeave={hideTooltip}
                                    onClick={(event) => showTooltip(region, event)}
                                    className="cursor-pointer"
                                />
                                <circle cx={labelPoint.x} cy={labelPoint.y - 8} r="4" fill={style.color}>
                                    <animate attributeName="r" values="4;6;4" dur="1.6s" repeatCount="indefinite" />
                                </circle>
                                <text
                                    x={labelPoint.x}
                                    y={labelPoint.y + 10}
                                    textAnchor="middle"
                                    fontSize="10"
                                    fill={style.color}
                                    className="font-mono uppercase tracking-[0.16em]"
                                >
                                    {region.label}
                                </text>
                            </g>
                        );
                    })}
                </g>
                <circle cx={cx} cy={cy} r={54} fill="rgba(13,13,13,0.95)" stroke="rgba(0,255,136,0.18)" />
                <text x={cx} y={cy - 4} textAnchor="middle" fontSize="12" fill="#00FF88" className="font-mono uppercase tracking-[0.22em]">
                    {describeType(profile.organismType)}
                </text>
                <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.48)" className="font-mono uppercase tracking-[0.16em]">
                    genome core
                </text>
            </g>
        );
    };

    const renderBacterialGenome = () => (
        <g>
            <g>
                <animateTransform attributeName="transform" attributeType="XML" type="rotate" from="0 250 165" to="360 250 165" dur="55s" repeatCount="indefinite" />
                <circle cx="250" cy="165" r="102" fill="rgba(255,255,255,0.03)" stroke="rgba(0,255,136,0.18)" strokeWidth="18" />
                {activeSerotype.regions.map((region) => {
                    const style = CATEGORY_STYLES[region.category];
                    const startAngle = region.start * Math.PI * 2 - Math.PI / 2;
                    const endAngle = region.end * Math.PI * 2 - Math.PI / 2;
                    const start = polarToCartesian(250, 165, 112, startAngle);
                    const end = polarToCartesian(250, 165, 112, endAngle);
                    const arc = region.end - region.start > 0.5 ? 1 : 0;
                    const labelPoint = polarToCartesian(250, 165, 148, (startAngle + endAngle) / 2);

                    return (
                        <g key={region.id}>
                            <path
                                d={`M ${start.x} ${start.y} A 112 112 0 ${arc} 1 ${end.x} ${end.y}`}
                                fill="none"
                                stroke={style.color}
                                strokeWidth="18"
                                strokeLinecap="round"
                                onMouseMove={(event) => showTooltip(region, event)}
                                onMouseLeave={hideTooltip}
                                onClick={(event) => showTooltip(region, event)}
                                className="cursor-pointer"
                            />
                            <text x={labelPoint.x} y={labelPoint.y} textAnchor="middle" fontSize="10" fill={style.color} className="font-mono uppercase tracking-[0.14em]">
                                {region.label}
                            </text>
                        </g>
                    );
                })}
            </g>
            <circle cx="470" cy="120" r="42" fill="rgba(255,255,255,0.02)" stroke="rgba(255,159,67,0.22)" strokeWidth="10">
                <animateTransform attributeName="transform" attributeType="XML" type="rotate" from="0 470 120" to="360 470 120" dur="18s" repeatCount="indefinite" />
            </circle>
            <circle cx="560" cy="198" r="28" fill="rgba(255,255,255,0.02)" stroke="rgba(53,216,255,0.22)" strokeWidth="10">
                <animateTransform attributeName="transform" attributeType="XML" type="rotate" from="360 560 198" to="0 560 198" dur="14s" repeatCount="indefinite" />
            </circle>
            <text x="470" y="120" textAnchor="middle" fontSize="10" fill="#FF9F43" className="font-mono uppercase tracking-[0.18em]">
                pVIR
            </text>
            <text x="560" y="198" textAnchor="middle" fontSize="10" fill="#35D8FF" className="font-mono uppercase tracking-[0.18em]">
                pRES
            </text>
        </g>
    );

    const renderParasiteGenome = () => (
        <g>
            <ellipse cx="250" cy="164" rx="120" ry="74" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" />
            <ellipse cx="250" cy="164" rx="70" ry="44" fill="rgba(0,255,136,0.08)" stroke="rgba(0,255,136,0.25)" />
            <ellipse cx="470" cy="128" rx="54" ry="28" fill="rgba(53,216,255,0.08)" stroke="rgba(53,216,255,0.28)">
                <animateTransform attributeName="transform" attributeType="XML" type="rotate" from="0 470 128" to="360 470 128" dur="28s" repeatCount="indefinite" />
            </ellipse>
            <rect x="420" y="185" width="118" height="44" rx="22" fill="rgba(77,163,255,0.07)" stroke="rgba(77,163,255,0.25)" />
            {activeSerotype.regions.map((region, index) => {
                const style = CATEGORY_STYLES[region.category];
                const points = [
                    { x: 220, y: 120 },
                    { x: 282, y: 150 },
                    { x: 250, y: 195 },
                    { x: 470, y: 128 },
                ];
                const point = points[index] ?? points[0];

                return (
                    <g key={region.id}>
                        <circle
                            cx={point.x}
                            cy={point.y}
                            r="12"
                            fill={style.color}
                            fillOpacity="0.18"
                            stroke={style.color}
                            onMouseMove={(event) => showTooltip(region, event)}
                            onMouseLeave={hideTooltip}
                            onClick={(event) => showTooltip(region, event)}
                            className="cursor-pointer"
                        >
                            <animate attributeName="r" values="11;15;11" dur={`${1.6 + index * 0.25}s`} repeatCount="indefinite" />
                        </circle>
                        <text x={point.x} y={point.y - 18} textAnchor="middle" fontSize="10" fill={style.color} className="font-mono uppercase tracking-[0.14em]">
                            {region.label}
                        </text>
                    </g>
                );
            })}
            <text x="250" y="166" textAnchor="middle" fontSize="11" fill="#00FF88" className="font-mono uppercase tracking-[0.18em]">
                nuclear program
            </text>
            <text x="470" y="130" textAnchor="middle" fontSize="10" fill="#35D8FF" className="font-mono uppercase tracking-[0.18em]">
                mitochondrion
            </text>
            <text x="479" y="212" textAnchor="middle" fontSize="10" fill="#4DA3FF" className="font-mono uppercase tracking-[0.18em]">
                stage switch
            </text>
        </g>
    );

    const renderPrionGenome = () => (
        <g>
            <path d="M120 180 C180 90, 240 250, 305 145 S430 70, 560 170" fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="10" strokeLinecap="round" />
            <path d="M132 180 C198 100, 248 228, 312 156 S440 86, 548 164" fill="none" stroke="#00FF88" strokeOpacity="0.28" strokeWidth="18" strokeLinecap="round" />
            {activeSerotype.regions.map((region, index) => {
                const style = CATEGORY_STYLES[region.category];
                const anchors = [
                    { x: 176, y: 156 },
                    { x: 286, y: 166 },
                    { x: 394, y: 126 },
                    { x: 514, y: 162 },
                ];
                const anchor = anchors[index] ?? anchors[0];

                return (
                    <g key={region.id}>
                        <circle
                            cx={anchor.x}
                            cy={anchor.y}
                            r="15"
                            fill={style.color}
                            fillOpacity="0.12"
                            stroke={style.color}
                            strokeWidth="1.4"
                            onMouseMove={(event) => showTooltip(region, event)}
                            onMouseLeave={hideTooltip}
                            onClick={(event) => showTooltip(region, event)}
                            className="cursor-pointer"
                        >
                            <animate attributeName="r" values="15;18;15" dur={`${1.8 + index * 0.2}s`} repeatCount="indefinite" />
                        </circle>
                        <text x={anchor.x} y={anchor.y - 24} textAnchor="middle" fontSize="10" fill={style.color} className="font-mono uppercase tracking-[0.16em]">
                            {region.label}
                        </text>
                    </g>
                );
            })}
            <text x="355" y="228" textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.42)" className="font-mono uppercase tracking-[0.22em]">
                conformational propagation front
            </text>
        </g>
    );

    const renderGenome = () => {
        switch (profile.layout) {
            case 'circular':
                return renderCircularGenome();
            case 'bacterial':
                return renderBacterialGenome();
            case 'parasite':
                return renderParasiteGenome();
            case 'prion':
                return renderPrionGenome();
            default:
                return renderLinearGenome();
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <Dna className="h-4 w-4 text-[#00ff88]" />
                        <h3 className="font-mono text-xs uppercase tracking-[0.22em] text-[#00ff88]">
                            {profile.title}
                        </h3>
                    </div>
                    <p className="max-w-2xl font-mono text-[11px] leading-relaxed text-white/58">
                        {profile.summary} {profile.virulenceFocus}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={handleExport}
                    className="inline-flex items-center gap-2 border border-[#00ff88]/20 bg-[#00ff88]/6 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#00ff88] transition-colors hover:bg-[#00ff88]/12"
                >
                    <Download className="h-3 w-3" />
                    Export SVG
                </button>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(260px,0.8fr)]">
                <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                        <div className="border border-white/10 bg-white/[0.02] px-3 py-2">
                            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/34">Organism Type</div>
                            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-white/74">
                                {describeType(profile.organismType)}
                            </div>
                        </div>
                        <div className="border border-white/10 bg-white/[0.02] px-3 py-2">
                            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/34">Genome Size</div>
                            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-white/74">
                                {activeSerotype.genomeSize}
                            </div>
                        </div>
                        <div className="border border-white/10 bg-white/[0.02] px-3 py-2">
                            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/34">GC Content</div>
                            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-white/74">
                                {activeSerotype.gcContent}
                            </div>
                        </div>
                        <div className="border border-white/10 bg-white/[0.02] px-3 py-2">
                            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/34">Architecture</div>
                            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-white/74">
                                {profile.familyLabel}
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {profile.serotypes.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => setSelectedSerotype(item.id)}
                                className={`border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors ${
                                    item.id === activeSerotype.id
                                        ? 'border-[#00ff88]/40 bg-[#00ff88]/12 text-[#00ff88]'
                                        : 'border-white/10 bg-white/[0.02] text-white/56 hover:border-white/20 hover:text-white/82'
                                }`}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>

                    <div className="relative overflow-hidden border border-white/10 bg-[#050505] p-3">
                        <svg
                            ref={svgRef}
                            viewBox="0 0 720 320"
                            className="h-auto w-full"
                            role="img"
                            aria-label={`${profile.title} genomic structure`}
                        >
                            <defs>
                                <linearGradient id={gradientId} x1="0%" x2="100%" y1="0%" y2="100%">
                                    <stop offset="0%" stopColor="rgba(0,255,136,0.18)" />
                                    <stop offset="100%" stopColor="rgba(53,216,255,0.08)" />
                                </linearGradient>
                            </defs>
                            <rect x="0" y="0" width="720" height="320" fill="#050505" />
                            <rect x="18" y="18" width="684" height="284" fill={`url(#${gradientId})`} stroke="rgba(255,255,255,0.05)" />
                            {renderGenome()}
                        </svg>

                        {hoveredRegion && (
                            <div
                                className="pointer-events-none absolute z-10 max-w-[260px] border border-white/12 bg-[#111111]/96 p-3 shadow-[0_0_24px_rgba(0,0,0,0.35)]"
                                style={{ left: Math.min(hoveredRegion.x, 420), top: Math.min(hoveredRegion.y, 220) }}
                            >
                                <div className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: CATEGORY_STYLES[hoveredRegion.region.category].color }}>
                                    {hoveredRegion.region.label}
                                </div>
                                <p className="mt-2 font-mono text-[11px] leading-relaxed text-white/78">
                                    {hoveredRegion.region.function}
                                </p>
                                <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-white/34">Mutation Sites</div>
                                <p className="mt-1 font-mono text-[11px] text-white/62">
                                    {hoveredRegion.region.mutationSites.join(' • ')}
                                </p>
                                <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-white/34">Drug Targets</div>
                                <p className="mt-1 font-mono text-[11px] text-white/62">
                                    {hoveredRegion.region.drugTargets.join(' • ')}
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                <div className="space-y-3">
                    <div className="border border-white/10 bg-white/[0.02] p-3">
                        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/36">Key Layers</div>
                        <div className="mt-3 space-y-2">
                            {activeSerotype.layers.map((layer) => (
                                <div key={layer} className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-white/72">
                                    <div className="h-1.5 w-1.5 bg-[#00ff88]" />
                                    {layer}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="border border-white/10 bg-white/[0.02] p-3">
                        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/36">Feature Legend</div>
                        <div className="mt-3 space-y-2">
                            {Object.entries(CATEGORY_STYLES).map(([key, value]) => (
                                <div key={key} className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2">
                                        <div className="h-2.5 w-2.5 rounded-full" style={{ background: value.color, boxShadow: `0 0 12px ${value.glow}` }} />
                                        <span className="font-mono text-[11px] text-white/74">{value.label}</span>
                                    </div>
                                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/32">
                                        {activeSerotype.regions.filter((item) => item.category === key).length}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="border border-white/10 bg-white/[0.02] p-3">
                        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/36">Visible Labels</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                            {profile.labels.map((label) => (
                                <span
                                    key={label}
                                    className="border border-white/10 bg-black/40 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/56"
                                >
                                    {label}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
