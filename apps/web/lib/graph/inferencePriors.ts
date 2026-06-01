import type { SupabaseClient } from '@supabase/supabase-js';
import { queryGraphPriors, type GraphQueryResult } from '@/lib/graph/query';
import type { InputSignature } from '@/lib/vetios-inference';

const GRAPH_PRIOR_TIMEOUT_MS = 500;

export async function enrichInputWithGraphPriors(
    supabase: SupabaseClient,
    inputSignature: InputSignature,
): Promise<InputSignature> {
    const startedAt = Date.now();

    try {
        const result = await Promise.race([
            queryGraphPriors(supabase, {
                species: inputSignature.species,
                symptoms: inputSignature.symptoms,
                age_months: readAgeMonths(inputSignature),
                modifiers: readModifiers(inputSignature),
            }),
            new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('GRAPH_PRIOR_TIMEOUT')), GRAPH_PRIOR_TIMEOUT_MS);
            }),
        ]);

        console.log(JSON.stringify({
            event: 'graph_enrichment_completed',
            matched_disease_count: result.matched_diseases.length,
            matched_edge_count: result.matched_edge_count,
            latency_ms: Date.now() - startedAt,
        }));

        if (result.matched_diseases.length === 0) {
            return inputSignature;
        }

        return attachGraphPriors(inputSignature, result);
    } catch (error) {
        console.log(JSON.stringify({
            event: 'graph_enrichment_failed',
            error: error instanceof Error ? error.message : 'unknown',
            latency_ms: Date.now() - startedAt,
        }));
        return inputSignature;
    }
}

function attachGraphPriors(inputSignature: InputSignature, result: GraphQueryResult): InputSignature {
    return {
        ...inputSignature,
        metadata: {
            ...inputSignature.metadata,
            graph_priors: result.matched_diseases.slice(0, 5).map((disease) => ({
                id: disease.id,
                label: disease.label,
                display_name: disease.display_name,
                score: disease.score,
                urgency: disease.urgency,
                matched_symptoms: disease.matched_symptoms,
            })),
            graph_query_version: result.query_version,
            graph_matched_edge_count: result.matched_edge_count,
        },
    };
}

function readAgeMonths(inputSignature: InputSignature): number | null {
    const metadata = inputSignature.metadata ?? {};
    const directMonths = readNumber(metadata.age_months);
    if (directMonths != null) return directMonths;
    const years = readNumber(metadata.age_years);
    return years == null ? null : Math.max(0, Math.round(years * 12));
}

function readModifiers(inputSignature: InputSignature): string[] {
    const metadata = inputSignature.metadata ?? {};
    const raw = metadata.modifiers;
    return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === 'string') : [];
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
