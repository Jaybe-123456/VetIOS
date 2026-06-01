import { createHash } from 'crypto';

export interface AMRScreenResult {
    sequence_hash: string;
    resistance_genes: string[];
    resistance_classes: string[];
    novel_pattern_score: number;
    quantum_backend: string | null;
    card_db_version: string;
    latency_ms: number;
}

export interface AMRSurveillanceRow {
    species: string | null;
    pathogen_label: string | null;
    region: string | null;
    resistance_genes: string[] | null;
    resistance_classes: string[] | null;
    novel_pattern_score?: number | null;
    created_at?: string | null;
}

export interface AMRPatternSummary {
    species: string;
    pathogen_label: string;
    region: string;
    sample_count: number;
    resistance_genes: Array<{ gene: string; count: number }>;
    resistance_classes: Array<{ class_name: string; count: number }>;
    average_novel_pattern_score: number | null;
}

const KNOWN_AMR_GENES: Record<string, { className: string; markers: string[] }> = {
    'blaCTX-M-15': {
        className: 'beta_lactam',
        markers: ['BLACTXM15', 'CTXM15', 'ATGGTTAAAAAATCACTGCG'],
    },
    'mcr-1': {
        className: 'colistin',
        markers: ['MCR1', 'ATGATGCAGCATACTTCTGT'],
    },
    mecA: {
        className: 'methicillin',
        markers: ['MECA', 'ATGAAAAAGATAAAAATTGTTCC'],
    },
    vanA: {
        className: 'vancomycin',
        markers: ['VANA', 'ATGAATAGAATAAAAGTTGC'],
    },
    tetA: {
        className: 'tetracycline',
        markers: ['TETA', 'ATGAAATTGCTTAACACCGG'],
    },
    sul1: {
        className: 'sulfonamide',
        markers: ['SUL1', 'ATGGTGACGGTGTTCGGCAT'],
    },
};

export function screenSequenceLocally(sequence: string): AMRScreenResult {
    const startedAt = Date.now();
    const normalized = normalizeFasta(sequence);
    const rawUpper = sequence.toUpperCase();
    const resistanceGenes = Object.entries(KNOWN_AMR_GENES)
        .filter(([, meta]) => meta.markers.some((marker) => normalized.includes(marker) || rawUpper.includes(marker)))
        .map(([gene]) => gene);
    const resistanceClasses = Array.from(new Set(resistanceGenes.map((gene) => KNOWN_AMR_GENES[gene]!.className))).sort();

    return {
        sequence_hash: createHash('sha256').update(normalized).digest('hex'),
        resistance_genes: resistanceGenes,
        resistance_classes: resistanceClasses,
        novel_pattern_score: estimateNoveltyScore(normalized),
        quantum_backend: 'local_entropy_fallback',
        card_db_version: 'local-marker-v1',
        latency_ms: Date.now() - startedAt,
    };
}

export function normalizeFasta(sequence: string): string {
    const body = sequence
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('>'))
        .join('')
        .toUpperCase()
        .replace(/[^ATCGN]/g, '');
    if (body.length > 0) return body;
    return sequence.toUpperCase().replace(/[^ATCGN]/g, '');
}

export function aggregateAMRPatterns(rows: AMRSurveillanceRow[]): AMRPatternSummary[] {
    const groups = new Map<string, {
        species: string;
        pathogen_label: string;
        region: string;
        sample_count: number;
        geneCounts: Map<string, number>;
        classCounts: Map<string, number>;
        noveltyTotal: number;
        noveltyCount: number;
    }>();

    for (const row of rows) {
        const species = normalizeBucket(row.species, 'unknown_species');
        const pathogen = normalizeBucket(row.pathogen_label, 'unknown_pathogen');
        const region = normalizeBucket(row.region, 'unknown_region');
        const key = `${species}|${pathogen}|${region}`;
        const group = groups.get(key) ?? {
            species,
            pathogen_label: pathogen,
            region,
            sample_count: 0,
            geneCounts: new Map<string, number>(),
            classCounts: new Map<string, number>(),
            noveltyTotal: 0,
            noveltyCount: 0,
        };

        group.sample_count += 1;
        for (const gene of row.resistance_genes ?? []) {
            group.geneCounts.set(gene, (group.geneCounts.get(gene) ?? 0) + 1);
        }
        for (const className of row.resistance_classes ?? []) {
            group.classCounts.set(className, (group.classCounts.get(className) ?? 0) + 1);
        }
        if (typeof row.novel_pattern_score === 'number' && Number.isFinite(row.novel_pattern_score)) {
            group.noveltyTotal += row.novel_pattern_score;
            group.noveltyCount += 1;
        }
        groups.set(key, group);
    }

    return Array.from(groups.values())
        .map((group) => ({
            species: group.species,
            pathogen_label: group.pathogen_label,
            region: group.region,
            sample_count: group.sample_count,
            resistance_genes: countMapToSortedArray(group.geneCounts, 'gene'),
            resistance_classes: countMapToSortedArray(group.classCounts, 'class_name'),
            average_novel_pattern_score: group.noveltyCount > 0
                ? round(group.noveltyTotal / group.noveltyCount)
                : null,
        }))
        .sort((left, right) => right.sample_count - left.sample_count);
}

function estimateNoveltyScore(sequence: string): number {
    if (sequence.length === 0) return 0;
    const counts = new Map<string, number>();
    for (let index = 0; index <= sequence.length - 4; index += 1) {
        const kmer = sequence.slice(index, index + 4);
        if (kmer.length === 4 && /^[ATCG]+$/.test(kmer)) {
            counts.set(kmer, (counts.get(kmer) ?? 0) + 1);
        }
    }
    const total = Array.from(counts.values()).reduce((sum, count) => sum + count, 0);
    if (total === 0) return 0;
    const entropy = Array.from(counts.values())
        .map((count) => count / total)
        .reduce((sum, p) => sum - p * Math.log2(p), 0);
    return round(Math.min(1, entropy / 8));
}

function countMapToSortedArray<TName extends 'gene' | 'class_name'>(
    map: Map<string, number>,
    nameKey: TName,
): Array<Record<TName, string> & { count: number }> {
    return Array.from(map.entries())
        .map(([name, count]) => ({ [nameKey]: name, count }) as Record<TName, string> & { count: number })
        .sort((left, right) => right.count - left.count);
}

function normalizeBucket(value: string | null | undefined, fallback: string): string {
    const trimmed = value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return trimmed || fallback;
}

function round(value: number): number {
    return Math.round(value * 1000) / 1000;
}
