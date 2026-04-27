/**
 * VKG Differential Ranker
 *
 * Re-ranks LLM-generated differentials using VKG graph scores.
 *
 * Pipeline:
 *   Symptoms → VKG traversal → Graph scoring → Blend with LLM confidence → Re-ranked differentials
 *
 * Blend formula:
 *   final_score = (llm_confidence × LLM_WEIGHT) + (vkg_score × VKG_WEIGHT)
 *
 * LLM weight starts high (0.65) so VKG enriches rather than overrides.
 * As the VKG corpus grows, VKG_WEIGHT increases.
 */

import { getVKG } from './veterinaryKnowledgeGraph';

const LLM_WEIGHT = 0.60;
const VKG_WEIGHT = 0.40;

export interface RawDifferential {
    name?: string;
    diagnosis?: string;
    condition?: string;
    confidence?: number;
    probability?: number;
    [key: string]: unknown;
}

export interface RankedDifferential extends RawDifferential {
    name: string;
    llm_confidence: number;
    vkg_score: number;
    final_score: number;
    vkg_matched_symptoms: string[];
    vkg_related_diseases: string[];
    vkg_lab_signals: string[];
    ranking_source: 'vkg_promoted' | 'llm_primary' | 'vkg_demoted' | 'unranked';
}

export interface VKGRankingResult {
    ranked_differentials: RankedDifferential[];
    vkg_pre_rank: Array<{ disease: string; score: number }>;
    symptom_coverage: number;   // 0-1: how many symptoms matched VKG nodes
    ranking_confidence: 'high' | 'moderate' | 'low';
    graph_nodes_traversed: number;
}

// ── Normalise differential name ────────────────────────────────────────────

function normaliseName(diff: RawDifferential): string {
    return String(diff.name ?? diff.diagnosis ?? diff.condition ?? 'unknown').trim();
}

function normaliseConfidence(diff: RawDifferential): number {
    const raw = diff.confidence ?? diff.probability ?? 0.5;
    return Math.min(1.0, Math.max(0.0, Number(raw)));
}

// ── Fuzzy disease match ────────────────────────────────────────────────────
// VKG uses ids like "disease:feline_ckd", LLM outputs "Feline CKD" or "CKD"

function fuzzyMatchDiseaseScore(
    llmName: string,
    vkgId: string,
    vkgLabel: string,
): number {
    const a = llmName.toLowerCase().replace(/[^a-z0-9]/g, ' ');
    const b = (vkgLabel + ' ' + vkgId).toLowerCase().replace(/[^a-z0-9]/g, ' ');

    const aTokens = new Set(a.split(/\s+/).filter(t => t.length > 2));
    const bTokens = new Set(b.split(/\s+/).filter(t => t.length > 2));

    let matches = 0;
    for (const token of aTokens) {
        if (bTokens.has(token)) matches++;
    }

    return aTokens.size > 0 ? matches / aTokens.size : 0;
}

// ── Core ranker ────────────────────────────────────────────────────────────

export function rankDifferentialsWithVKG(
    rawDifferentials: RawDifferential[],
    symptoms: string[],
    species: string,
    labFindings?: string[],
): VKGRankingResult {
    const vkg = getVKG();

    // 1. VKG symptom traversal — get disease candidates scored by graph
    const vkgCandidates = vkg.getDiseasesForSymptoms(symptoms, species);
    const vkgScoreMap = new Map<string, { score: number; matchedSymptoms: string[]; nodeId: string }>();

    for (const candidate of vkgCandidates) {
        vkgScoreMap.set(candidate.disease.id, {
            score: candidate.score,
            matchedSymptoms: candidate.matchedSymptoms,
            nodeId: candidate.disease.id,
        });
    }

    // 2. Count matched symptom nodes for coverage metric
    const symptomNodeIds = symptoms.map(s => `symptom:${s.toLowerCase().replace(/\s+/g, '_')}`);
    const matchedSymptomCount = symptomNodeIds.filter(sid => vkg.getNode(sid) !== undefined).length;
    const symptomCoverage = symptoms.length > 0 ? matchedSymptomCount / symptoms.length : 0;

    // 3. For each LLM differential, find best VKG match and compute final score
    const ranked: RankedDifferential[] = rawDifferentials.map(diff => {
        const llmName = normaliseName(diff);
        const llmConf = normaliseConfidence(diff);

        // Find best matching VKG disease
        let bestVkgScore = 0;
        let bestMatchedSymptoms: string[] = [];
        let bestNodeId = '';

        for (const [nodeId, candidate] of vkgScoreMap.entries()) {
            const node = vkg.getNode(nodeId);
            if (!node) continue;

            const matchScore = fuzzyMatchDiseaseScore(llmName, nodeId, node.label);
            if (matchScore > 0.3) {
                // This VKG candidate matches this LLM differential
                const combinedScore = candidate.score * matchScore;
                if (combinedScore > bestVkgScore) {
                    bestVkgScore = combinedScore;
                    bestMatchedSymptoms = candidate.matchedSymptoms;
                    bestNodeId = nodeId;
                }
            }
        }

        // Lab finding bonus: check VKG lab associations
        const vkgLabSignals: string[] = [];
        if (bestNodeId && labFindings && labFindings.length > 0) {
            const node = vkg.getNode(bestNodeId);
            if (node) {
                const labNeighbours = vkg.neighbours(bestNodeId, 'associated_lab');
                for (const labNode of labNeighbours) {
                    const labKey = labNode.label.toLowerCase().replace(/\s+/g, '_');
                    const matched = labFindings.some(lf =>
                        lf.toLowerCase().includes(labKey) || labKey.includes(lf.toLowerCase())
                    );
                    if (matched) {
                        vkgLabSignals.push(labNode.label);
                        bestVkgScore = Math.min(1.0, bestVkgScore + 0.1); // lab bonus
                    }
                }
            }
        }

        // VKG related diseases (differentials from graph)
        const vkgRelated = bestNodeId
            ? vkg.getDifferentials(bestNodeId, species).slice(0, 3).map(n => n.label)
            : [];

        const finalScore = (llmConf * LLM_WEIGHT) + (bestVkgScore * VKG_WEIGHT);

        // Determine ranking source
        let rankingSource: RankedDifferential['ranking_source'];
        if (bestVkgScore === 0) {
            rankingSource = 'unranked';
        } else if (finalScore > llmConf) {
            rankingSource = 'vkg_promoted';
        } else if (finalScore < llmConf * 0.85) {
            rankingSource = 'vkg_demoted';
        } else {
            rankingSource = 'llm_primary';
        }

        return {
            ...diff,
            name: llmName,
            llm_confidence: llmConf,
            vkg_score: parseFloat(bestVkgScore.toFixed(4)),
            final_score: parseFloat(finalScore.toFixed(4)),
            vkg_matched_symptoms: bestMatchedSymptoms,
            vkg_related_diseases: vkgRelated,
            vkg_lab_signals: vkgLabSignals,
            ranking_source: rankingSource,
        };
    });

    // 4. Sort by final_score descending
    ranked.sort((a, b) => b.final_score - a.final_score);

    // 5. Ranking confidence
    const hasVkgMatches = ranked.some(d => d.vkg_score > 0);
    const rankingConfidence = !hasVkgMatches ? 'low'
        : symptomCoverage > 0.6 ? 'high'
        : 'moderate';

    return {
        ranked_differentials: ranked,
        vkg_pre_rank: vkgCandidates.slice(0, 10).map(c => ({
            disease: c.disease.label,
            score: parseFloat(c.score.toFixed(4)),
        })),
        symptom_coverage: parseFloat(symptomCoverage.toFixed(3)),
        ranking_confidence: rankingConfidence,
        graph_nodes_traversed: vkgCandidates.length,
    };
}