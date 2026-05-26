export interface GraphDiseaseNode {
  id: string;
  label: string;
  display_name: string;
  species: string;
  base_prior: number;
  urgency: 'high' | 'medium' | 'low';
}

export interface GraphSymptomNode {
  id: string;
  label: string;
  display_name: string;
  species: string;
  prevalence_weight: number;
}

export interface GraphEdgeRow {
  weight: number;
  modifier_key?: string | null;
  modifier_value?: string | null;
  age_range_min?: number | null;
  age_range_max?: number | null;
  vet_disease_nodes: GraphDiseaseNode | GraphDiseaseNode[];
  vet_symptom_nodes: GraphSymptomNode | GraphSymptomNode[];
}

export interface WeightedDisease {
  id: string;
  label: string;
  display_name: string;
  species: string;
  urgency: 'high' | 'medium' | 'low';
  score: number;
  base_prior: number;
  matched_symptoms: string[];
  edge_count: number;
}

interface DiseaseAccumulator {
  disease: GraphDiseaseNode;
  edgeWeightSum: number;
  matchedSymptoms: Set<string>;
  edgeCount: number;
}

export function aggregateDiseaseScores(
  edges: GraphEdgeRow[],
  symptomCount: number,
  ageMonths?: number | null,
  modifiers: string[] = [],
): WeightedDisease[] {
  const normalizedModifiers = new Set(modifiers.map((modifier) => modifier.trim().toLowerCase()).filter(Boolean));
  const grouped = new Map<string, DiseaseAccumulator>();

  for (const edge of edges) {
    if (!edgeAppliesToAge(edge, ageMonths)) continue;

    const disease = first(edge.vet_disease_nodes);
    const symptom = first(edge.vet_symptom_nodes);
    if (!disease || !symptom) continue;

    const modifierBoost = edgeHasModifier(edge, normalizedModifiers) ? 1.3 : 1;
    const weightedEdge = clampProbability(edge.weight * modifierBoost);
    const existing = grouped.get(disease.id) ?? {
      disease,
      edgeWeightSum: 0,
      matchedSymptoms: new Set<string>(),
      edgeCount: 0,
    };

    existing.edgeWeightSum += weightedEdge;
    existing.matchedSymptoms.add(symptom.label);
    existing.edgeCount += 1;
    grouped.set(disease.id, existing);
  }

  const denominator = Math.max(1, symptomCount);

  return Array.from(grouped.values())
    .map(({ disease, edgeWeightSum, matchedSymptoms, edgeCount }) => ({
      id: disease.id,
      label: disease.label,
      display_name: disease.display_name,
      species: disease.species,
      urgency: disease.urgency,
      score: roundScore((disease.base_prior * edgeWeightSum) / denominator),
      base_prior: disease.base_prior,
      matched_symptoms: Array.from(matchedSymptoms).sort(),
      edge_count: edgeCount,
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 10);
}

function edgeAppliesToAge(edge: GraphEdgeRow, ageMonths?: number | null): boolean {
  if (ageMonths == null || !Number.isFinite(ageMonths)) return true;
  if (edge.age_range_min != null && ageMonths < edge.age_range_min) return false;
  if (edge.age_range_max != null && ageMonths > edge.age_range_max) return false;
  return true;
}

function edgeHasModifier(edge: GraphEdgeRow, modifiers: Set<string>): boolean {
  if (modifiers.size === 0) return false;
  const key = edge.modifier_key?.trim().toLowerCase();
  const value = edge.modifier_value?.trim().toLowerCase();
  if (!key && !value) return false;
  return Boolean(
    (key && modifiers.has(key))
    || (value && modifiers.has(value))
    || (key && value && modifiers.has(`${key}:${value}`)),
  );
}

function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function roundScore(value: number): number {
  return Math.round(value * 10000) / 10000;
}
