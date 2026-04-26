/**
 * VetIOS RAG Pipeline — Retrieval-Augmented Clinical Evidence
 *
 * Grounds inference answers in actual network cases rather than model weights.
 * Integrates embedding retrieval + VKG traversal + constitutional safety
 * into a unified evidence-grounded inference context.
 *
 * Before: "This looks like parvovirus" (from model weights)
 * After:  "In 23 similar canine cases with haemorrhagic diarrhoea + leucopenia,
 *          19 were confirmed parvovirus. Here are 3 confirmed cases from the
 *          VetIOS network."
 */

import { embedQuery } from '@/lib/embeddings/vetEmbeddingEngine';
import { getVectorStore } from '@/lib/vectorStore/vetVectorStore';
import { getVKG } from '@/lib/vkg/veterinaryKnowledgeGraph';
import type { VetClinicalCase } from '@/lib/embeddings/vetEmbeddingEngine';
import type { StoredCaseVector } from '@/lib/vectorStore/vetVectorStore';

// ─── Types ───────────────────────────────────────────────────

export interface RAGContext {
  retrievedCases: StoredCaseVector[];
  vkgDifferentials: VKGDifferential[];
  evidenceBlocks: EvidenceBlock[];
  retrievalStats: RetrievalStats;
  promptContext: string;         // Formatted text injected into the LLM prompt
  calibrationStatement: string;  // "VetIOS is X% accurate for this diagnosis tuple"
}

export interface VKGDifferential {
  diagnosis: string;
  matchedSymptoms: string[];
  vkgScore: number;
  associatedLabs: string[];
  contraindications: string[];
}

export interface EvidenceBlock {
  caseId: string;
  species: string;
  breed: string | null;
  ageYears: number | null;
  symptoms: string[];
  diagnosis: string;
  similarity: number;
  outcomeConfirmed: boolean;
  clinicalSummary: string;
}

export interface RetrievalStats {
  totalRetrieved: number;
  confirmedOutcomes: number;
  topDiagnosis: string | null;
  topDiagnosisPrevalence: number;
  avgSimilarity: number;
  retrievalTimeMs: number;
}

// ─── RAG Pipeline ─────────────────────────────────────────────

export class RAGPipeline {
  private vectorStore = getVectorStore();
  private vkg = getVKG();

  /**
   * Build a full RAG context for a clinical case.
   * This is injected into the LLM prompt before inference.
   */
  async buildContext(clinicalCase: VetClinicalCase): Promise<RAGContext> {
    const t0 = Date.now();

    // ── Step 1: Generate embedding for the query case ──
    const embedding = await embedQuery(
      [
        clinicalCase.species,
        clinicalCase.breed ?? '',
        clinicalCase.symptoms.join(' '),
        clinicalCase.biomarkers ? Object.entries(clinicalCase.biomarkers).map(([k, v]) => `${k}:${v}`).join(' ') : '',
      ].filter(Boolean).join(' '),
      clinicalCase
    );

    // ── Step 2: Retrieve similar cases from pgvector ──
    const { cases, topDiagnosis, topDiagnosisCount } = await this.vectorStore.findSimilar({
      embedding,
      species: clinicalCase.species,
      limit: 8,
      minSimilarity: 0.72,
      confirmedOnly: false,
    });

    const retrievalTimeMs = Date.now() - t0;

    // ── Step 3: VKG traversal for differentials ──
    const vkgDifferentials = this.buildVKGDifferentials(clinicalCase);

    // ── Step 4: Build evidence blocks ──
    const evidenceBlocks = cases.map((c) => this.buildEvidenceBlock(c));

    // ── Step 5: Get calibration statement ──
    const calibrationStatement = await this.getCalibrationStatement(
      topDiagnosis,
      clinicalCase.species
    );

    // ── Step 6: Format prompt context ──
    const promptContext = this.formatPromptContext(
      clinicalCase,
      evidenceBlocks,
      vkgDifferentials,
      calibrationStatement
    );

    const confirmedOutcomes = cases.filter((c) => c.outcome_confirmed).length;
    const avgSimilarity = cases.length > 0
      ? cases.reduce((s, c) => s + c.similarity, 0) / cases.length
      : 0;

    return {
      retrievedCases: cases,
      vkgDifferentials,
      evidenceBlocks,
      retrievalStats: {
        totalRetrieved: cases.length,
        confirmedOutcomes,
        topDiagnosis,
        topDiagnosisPrevalence: cases.length > 0 ? topDiagnosisCount / cases.length : 0,
        avgSimilarity,
        retrievalTimeMs,
      },
      promptContext,
      calibrationStatement,
    };
  }

  // ─── VKG Differential Builder ────────────────────────────

  private buildVKGDifferentials(clinicalCase: VetClinicalCase): VKGDifferential[] {
    const diseaseCandidates = this.vkg.getDiseasesForSymptoms(
      clinicalCase.symptoms,
      clinicalCase.species
    );

    return diseaseCandidates.slice(0, 5).map(({ disease, matchedSymptoms, score }) => {
      // Get associated labs
      const labNodes = this.vkg.neighbours(disease.id, 'associated_lab');

      // Get contraindications for top treatments
      const treatmentNodes = this.vkg.neighbours(disease.id, 'treated_by');
      const contraindicationLabels: string[] = [];
      for (const t of treatmentNodes.slice(0, 2)) {
        const drugNodes = this.vkg.neighbours(t.id, 'uses_drug');
        for (const d of drugNodes.slice(0, 2)) {
          const ci = this.vkg.getDrugContraindications(d.id.replace('drug:', ''), clinicalCase.species);
          contraindicationLabels.push(...ci.map((c) => `${d.label}: ${c.label}`));
        }
      }

      return {
        diagnosis: disease.label,
        matchedSymptoms,
        vkgScore: score,
        associatedLabs: labNodes.map((l) => l.label),
        contraindications: [...new Set(contraindicationLabels)].slice(0, 3),
      };
    });
  }

  // ─── Evidence Block Builder ──────────────────────────────

  private buildEvidenceBlock(c: StoredCaseVector): EvidenceBlock {
    const parts: string[] = [];
    if (c.breed) parts.push(`${c.species} (${c.breed})`);
    else parts.push(c.species);
    if (c.age_years) parts.push(`${c.age_years}y`);
    parts.push(`presenting: ${c.symptoms.slice(0, 3).join(', ')}`);
    if (c.diagnosis) parts.push(`→ ${c.outcome_confirmed ? 'confirmed' : 'suspected'}: ${c.diagnosis}`);

    return {
      caseId: c.id,
      species: c.species,
      breed: c.breed,
      ageYears: c.age_years,
      symptoms: c.symptoms,
      diagnosis: c.diagnosis ?? 'unconfirmed',
      similarity: c.similarity,
      outcomeConfirmed: c.outcome_confirmed,
      clinicalSummary: parts.join(', '),
    };
  }

  // ─── Calibration Statement ───────────────────────────────

  private async getCalibrationStatement(
    diagnosis: string | null,
    species: string
  ): Promise<string> {
    if (!diagnosis) return '';

    try {
      const stats = await this.vectorStore.getCalibrationStats(species, diagnosis);
      if (stats.totalCases < 5) return '';

      const pct = (stats.accuracyRate * 100).toFixed(0);
      return `VetIOS network accuracy for ${species} ${diagnosis}: ${pct}% (${stats.confirmedCases}/${stats.totalCases} confirmed outcomes, avg confidence ${(stats.avgConfidence * 100).toFixed(0)}%).`;
    } catch {
      return '';
    }
  }

  // ─── Prompt Context Formatter ────────────────────────────

  private formatPromptContext(
    clinicalCase: VetClinicalCase,
    evidenceBlocks: EvidenceBlock[],
    vkgDifferentials: VKGDifferential[],
    calibrationStatement: string
  ): string {
    const lines: string[] = [];

    lines.push('=== VetIOS NETWORK EVIDENCE CONTEXT ===');
    lines.push('');

    // ── Retrieved Cases ──
    if (evidenceBlocks.length > 0) {
      const confirmed = evidenceBlocks.filter((b) => b.outcomeConfirmed);
      lines.push(`SIMILAR NETWORK CASES (${evidenceBlocks.length} retrieved, ${confirmed.length} outcome-confirmed):`);

      for (const block of evidenceBlocks.slice(0, 5)) {
        lines.push(`  • ${block.clinicalSummary} [similarity: ${(block.similarity * 100).toFixed(1)}%${block.outcomeConfirmed ? ', CONFIRMED' : ''}]`);
      }
      lines.push('');
    }

    // ── VKG Differentials ──
    if (vkgDifferentials.length > 0) {
      lines.push('VETERINARY KNOWLEDGE GRAPH DIFFERENTIALS:');
      for (const diff of vkgDifferentials) {
        lines.push(`  • ${diff.diagnosis} (VKG match: ${(diff.vkgScore * 100).toFixed(0)}%)`);
        if (diff.matchedSymptoms.length > 0) {
          lines.push(`    Matched signs: ${diff.matchedSymptoms.join(', ')}`);
        }
        if (diff.associatedLabs.length > 0) {
          lines.push(`    Expected labs: ${diff.associatedLabs.join(', ')}`);
        }
      }
      lines.push('');
    }

    // ── Calibration ──
    if (calibrationStatement) {
      lines.push('CALIBRATION:');
      lines.push(`  ${calibrationStatement}`);
      lines.push('');
    }

    // ── Species/breed context from VKG ──
    lines.push('INSTRUCTIONS:');
    lines.push('- Ground your diagnosis in the evidence above when available.');
    lines.push('- Reference the number of similar confirmed cases to support your confidence.');
    lines.push('- If network evidence conflicts with your assessment, explicitly note the discrepancy.');
    lines.push('- Always surface uncertainty appropriate to the confidence level.');
    lines.push('=== END EVIDENCE CONTEXT ===');

    return lines.join('\n');
  }
}

// ─── Singleton ───────────────────────────────────────────────

let _pipeline: RAGPipeline | null = null;

export function getRAGPipeline(): RAGPipeline {
  if (!_pipeline) _pipeline = new RAGPipeline();
  return _pipeline;
}
