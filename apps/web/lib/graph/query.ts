import type { SupabaseClient } from '@supabase/supabase-js';
import {
    aggregateDiseaseScores,
    type GraphDiseaseNode,
    type GraphEdgeRow,
    type GraphSymptomNode,
    type WeightedDisease,
} from '@vetios/graph';

export interface GraphQueryInput {
    species: string;
    symptoms: string[];
    age_months?: number | null;
    modifiers?: string[];
}

export interface GraphQueryResult {
    matched_diseases: WeightedDisease[];
    subgraph_edges: GraphEdgeRow[];
    query_version: number;
    symptom_count: number;
    matched_edge_count: number;
}

interface SymptomRow {
    id: string;
    label: string;
    display_name: string;
    species: string;
    prevalence_weight: number;
}

interface EdgeRow {
    weight: number;
    modifier_key?: string | null;
    modifier_value?: string | null;
    age_range_min?: number | null;
    age_range_max?: number | null;
    vet_symptom_nodes?: GraphSymptomNode | GraphSymptomNode[];
    vet_disease_nodes?: GraphDiseaseNode | GraphDiseaseNode[];
}

export async function queryGraphPriors(
    supabase: SupabaseClient,
    input: GraphQueryInput,
): Promise<GraphQueryResult> {
    const species = normalizeSpecies(input.species);
    const symptoms = normalizeSymptoms(input.symptoms);
    if (!species || symptoms.length === 0) {
        return emptyGraphResult(symptoms.length);
    }

    const { data: symptomRows, error: symptomError } = await supabase
        .from('vet_symptom_nodes')
        .select('id,label,display_name,species,prevalence_weight')
        .in('label', symptoms)
        .in('species', [species, 'both']);

    if (symptomError) {
        throw new Error(`graph_symptom_query_failed: ${symptomError.message}`);
    }

    const matchedSymptoms = (Array.isArray(symptomRows) ? symptomRows as SymptomRow[] : [])
        .filter((row) => row.id && row.label);
    if (matchedSymptoms.length === 0) {
        return emptyGraphResult(symptoms.length);
    }

    const symptomIds = matchedSymptoms.map((row) => row.id);
    const { data: edgeRows, error: edgeError } = await supabase
        .from('vet_graph_edges')
        .select(`
            weight, modifier_key, modifier_value, age_range_min, age_range_max,
            vet_symptom_nodes!inner(id,label,display_name,species,prevalence_weight),
            vet_disease_nodes!inner(id,label,display_name,species,base_prior,urgency)
        `)
        .in('symptom_id', symptomIds);

    if (edgeError) {
        throw new Error(`graph_edge_query_failed: ${edgeError.message}`);
    }

    const subgraphEdges = (Array.isArray(edgeRows) ? edgeRows as EdgeRow[] : [])
        .filter((row) => row.weight >= 0.15)
        .filter((row): row is GraphEdgeRow => {
            const disease = first(row.vet_disease_nodes);
            const symptom = first(row.vet_symptom_nodes);
            return Boolean(
                disease
                && symptom
                && (disease.species === species || disease.species === 'both')
                && (symptom.species === species || symptom.species === 'both')
            );
        });

    const matchedDiseases = aggregateDiseaseScores(
        subgraphEdges,
        symptoms.length,
        input.age_months,
        input.modifiers ?? [],
    );

    return {
        matched_diseases: matchedDiseases,
        subgraph_edges: subgraphEdges,
        query_version: 1,
        symptom_count: symptoms.length,
        matched_edge_count: subgraphEdges.length,
    };
}

export function normalizeSymptoms(symptoms: string[]): string[] {
    return Array.from(new Set(symptoms
        .map((symptom) => symptom.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
        .filter(Boolean)));
}

function normalizeSpecies(species: string): string {
    return species.trim().toLowerCase();
}

function emptyGraphResult(symptomCount: number): GraphQueryResult {
    return {
        matched_diseases: [],
        subgraph_edges: [],
        query_version: 1,
        symptom_count: symptomCount,
        matched_edge_count: 0,
    };
}

function first<T>(value: T | T[] | null | undefined): T | null {
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
}
