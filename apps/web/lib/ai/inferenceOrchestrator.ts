import { normalizeInferenceInput } from '@/lib/input/inputNormalizer';
import type { InputMode } from '@/lib/input/inputNormalizer';
import { attachAntigravitySignal, buildAntigravityClinicalSignal } from '@/lib/ai/antigravitySignal';
import { extractClinicalSignals } from '@/lib/ai/clinicalSignals';
import { attachSignalWeightProfile, buildSignalWeightProfile } from '@/lib/clinicalSignal/signalWeightEngine';
import { runInference } from '@/lib/ai/provider';
import { applyDiagnosticSafetyLayer, buildSeverityFeatureImportance } from '@/lib/ai/diagnosticSafety';
import { evaluateEmergencyRules } from '@/lib/ai/emergencyRules';
import {
    buildCatastrophicRiskOutput,
    severityFloorFromAbdominalSignals,
} from '@/lib/ai/abdominalEmergency';
import { mlPredict } from '@/lib/ml/mlClient';
import { buildClinicalReasoningAlignmentSnapshot } from '@/lib/intelligence/clinicalAlignment';
import { getConstitutionalAI } from '@/lib/constitutionalAI/constitutionalAIEngine';
import { getVKG } from '@/lib/vkg/veterinaryKnowledgeGraph';
import { rankDifferentialsWithVKG } from '@/lib/vkg/vkgDifferentialRanker';
import { getDrugInteractionEngine } from '@/lib/drugInteraction/drugInteractionEngine';
import { getVectorStore } from '@/lib/vectorStore/vetVectorStore';
import { embedClinicalCase, embedQuery } from '@/lib/embeddings/vetEmbeddingEngine';
import { getCausalEngine } from '@/lib/causal/causalEngine';
import { getCounterfactualSimulator } from '@/lib/causal/counterfactualSimulator';
import { getLivingCaseMemory } from '@/lib/causal/livingCaseMemory';

export interface OrchestratorParams {
    model: string;
    rawInput: string | Record<string, unknown>;
    inputMode: InputMode;
    tenantId?: string | null;
    patientId?: string | null;
    inferenceEventId?: string | null;
}

interface InferencePipelineDiagnosis {
    primary_condition_class?: string;
    condition_class?: string;
    condition_class_probabilities?: Record<string, number>;
    top_differentials?: Array<{ name?: string; diagnosis?: string }>;
    confidence_score?: number;
    analysis?: string;
    top_diagnosis?: string;
    predicted_diagnosis?: string;
    [key: string]: unknown;
}

interface InferencePipelineRisk {
    severity_score?: number | string;
    emergency_level?: string;
    risk_definition?: string;
    catastrophic_deterioration_risk_6h?: number;
    operative_urgency_risk?: number;
    shock_risk?: number;
    legacy_ml_operational_risk?: number | null;
    [key: string]: unknown;
}

export async function runInferencePipeline({ model, rawInput, inputMode, tenantId, patientId, inferenceEventId }: OrchestratorParams) {
    const pipelineTrace: Array<{ stage: string; status: 'completed'; detail?: string }> = [];
    let normalizedSig: Record<string, unknown>;

    if (typeof rawInput === 'string') {
        normalizedSig = normalizeInferenceInput(rawInput, inputMode) as unknown as Record<string, unknown>;
    } else if (rawInput.input_signature && typeof rawInput.input_signature === 'object') {
        normalizedSig = rawInput.input_signature as Record<string, unknown>;
    } else {
        normalizedSig = rawInput;
    }
    normalizedSig = attachAntigravitySignal(normalizedSig);
    pipelineTrace.push({ stage: 'input_normalization', status: 'completed' });
    const antigravitySignal = buildAntigravityClinicalSignal(normalizedSig);
    pipelineTrace.push({ stage: 'clinical_signal_enrichment', status: 'completed' });
    normalizedSig = attachSignalWeightProfile(normalizedSig);
    pipelineTrace.push({ stage: 'signal_weighting', status: 'completed' });
    const runtimeContext = resolveRuntimeContext(normalizedSig, {
        tenantId,
        patientId,
        inferenceEventId,
    });

    // Phase 2: RAG Retrieval
    let ragContext = '';
    try {
        const vs = getVectorStore();
        const _species = typeof normalizedSig.species === 'string' ? normalizedSig.species : 'canine';
        const _symptoms = Array.isArray(normalizedSig.presenting_signs) ? normalizedSig.presenting_signs as string[] : [];
        const _qe = await embedQuery(_species + ' ' + _symptoms.join(' '), { species: _species });
        const _sim = await vs.findSimilar({ embedding: _qe, species: _species, limit: 8, minSimilarity: 0.72 });
        if (_sim.totalFound > 0) {
            ragContext = _sim.retrievalSummary;
            normalizedSig = { ...normalizedSig, rag_context: ragContext, rag_case_count: _sim.totalFound, rag_top_diagnosis: _sim.topDiagnosis };
        }
    } catch { /* RAG non-critical */ }
    pipelineTrace.push({ stage: 'rag_retrieval', status: 'completed', detail: ragContext || 'no similar cases' });

    const inferenceResult = await runInference({
        model,
        input_signature: normalizedSig,
    });
    pipelineTrace.push({ stage: 'provider_inference', status: 'completed' });

    const payload = inferenceResult.output_payload;
    const contradiction = inferenceResult.contradiction_analysis;
    normalizedSig = attachSignalWeightProfile(normalizedSig, { contradiction });
    const signalWeightProfile = buildSignalWeightProfile(normalizedSig, { contradiction });
    const signals = extractClinicalSignals(normalizedSig);

    if (!payload.diagnosis || typeof payload.diagnosis !== 'object') {
        payload.diagnosis = {
            primary_condition_class: 'Idiopathic / Unknown',
            condition_class_probabilities: {},
            top_differentials: [],
            confidence_score: inferenceResult.confidence_score ?? 0.45,
            analysis: 'Deterministic diagnostic safety layer supplied the differential because provider output was incomplete.',
        };
    }
    if (!payload.risk_assessment || typeof payload.risk_assessment !== 'object') {
        payload.risk_assessment = {
            severity_score: 0.5,
            emergency_level: 'MODERATE',
        };
    }

    const diagnosis = payload.diagnosis as InferencePipelineDiagnosis;
    const risk = payload.risk_assessment as InferencePipelineRisk;

    const species = typeof normalizedSig.species === 'string' ? normalizedSig.species : 'canine';
    const mlRisk = await mlPredict({
        decision_count: 1,
        override_count: 0,
        species,
    });

    const emergencyEval = evaluateEmergencyRules(normalizedSig);
    if (emergencyEval.emergency_rule_triggered) {
        const currentSeverity = typeof risk.severity_score === 'number' ? risk.severity_score : 0.5;
        risk.severity_score = Math.min(1.0, currentSeverity + emergencyEval.severity_boost);
        risk.emergency_level = elevateEmergencyLevel(String(risk.emergency_level), emergencyEval.emergency_level);
    }
    risk.severity_score = Math.max(
        typeof risk.severity_score === 'number' ? risk.severity_score : 0.5,
        severityFloorFromAbdominalSignals(signals, emergencyEval),
    );
    pipelineTrace.push({ stage: 'severity_computation', status: 'completed' });

    const safetyLayer = applyDiagnosticSafetyLayer({
        inputSignature: normalizedSig,
        diagnosis,
        contradiction,
        emergencyEval,
        modelVersion: model,
        existingDiagnosisFeatureImportance: payload.diagnosis_feature_importance as Record<string, unknown> | null,
        existingUncertaintyNotes: payload.uncertainty_notes,
    });
    pipelineTrace.push({ stage: 'contradiction_scoring', status: 'completed' });

    payload.diagnosis = safetyLayer.diagnosis;
    payload.inference_explanation = safetyLayer.inference_explanation ?? null;
    payload.differentials = (safetyLayer.diagnosis.top_differentials as unknown[]) ?? [];

    // ── VKG Differential Re-ranking ───────────────────────────────────────────
    // Pipeline: Symptoms → VKG traversal → Graph scoring → Blend with LLM → Re-ranked
    try {
        const _vkgSymptoms = Array.isArray(normalizedSig.presenting_signs)
            ? normalizedSig.presenting_signs as string[]
            : [];
        const _vkgSpecies = typeof normalizedSig.species === 'string' ? normalizedSig.species : 'canine';
        const _vkgLabs = Array.isArray(normalizedSig.lab_findings)
            ? normalizedSig.lab_findings as string[]
            : [];

        if (_vkgSymptoms.length > 0 && Array.isArray(payload.differentials) && payload.differentials.length > 0) {
            const _vkgRanking = rankDifferentialsWithVKG(
                payload.differentials as Array<Record<string, unknown>>,
                _vkgSymptoms,
                _vkgSpecies,
                _vkgLabs,
            );
            payload.differentials = _vkgRanking.ranked_differentials;
            payload.vkg_ranking = {
                pre_rank: _vkgRanking.vkg_pre_rank,
                symptom_coverage: _vkgRanking.symptom_coverage,
                ranking_confidence: _vkgRanking.ranking_confidence,
                graph_nodes_traversed: _vkgRanking.graph_nodes_traversed,
                llm_weight: 0.60,
                vkg_weight: 0.40,
            };
        }
    } catch { /* VKG re-ranking non-critical — fallback to LLM order */ }
    pipelineTrace.push({ stage: 'vkg_differential_reranking', status: 'completed' });
    payload.treatment_plans = safetyLayer.treatment_plans ?? {};
    payload.ground_truth_summary = safetyLayer.ground_truth_summary ?? null;
    payload.mechanism_class = safetyLayer.mechanism_class;
    payload.diagnosis_feature_importance = safetyLayer.diagnosis_feature_importance;
    payload.suppressed_signals = safetyLayer.suppressed_signals;
    payload.severity_feature_importance =
        payload.severity_feature_importance && typeof payload.severity_feature_importance === 'object'
            ? payload.severity_feature_importance
            : buildSeverityFeatureImportance(signals, signalWeightProfile);
    payload.uncertainty_notes = safetyLayer.uncertainty_notes;
    payload.contradiction_score = contradiction?.contradiction_score ?? 0;
    payload.contradiction_reasons = contradiction?.contradiction_reasons ?? [];
    payload.confidence_cap = safetyLayer.confidence_cap;
    payload.was_capped = safetyLayer.was_capped;
    payload.abstain_recommendation = safetyLayer.abstain_recommendation;
    payload.abstain_reason = safetyLayer.abstain_reason ?? null;
    payload.competitive_differential = safetyLayer.competitive_differential ?? false;
    payload.urgent_confirmatory_testing = safetyLayer.urgent_confirmatory_testing ?? false;
    payload.rule_overrides = safetyLayer.rule_overrides;
    payload.differential_spread = safetyLayer.differential_spread;
    payload.telemetry = safetyLayer.telemetry;
    payload.contradiction_analysis = {
        contradiction_score: contradiction?.contradiction_score ?? 0,
        contradiction_reasons: contradiction?.contradiction_reasons ?? [],
        contradiction_details: contradiction?.contradiction_details ?? [],
        matched_rule_ids: contradiction?.matched_rule_ids ?? [],
        score_band: contradiction?.score_band ?? 'none',
        is_plausible: contradiction?.is_plausible ?? true,
        confidence_cap: safetyLayer.confidence_cap,
        confidence_was_capped: safetyLayer.was_capped,
        original_confidence: contradiction?.original_confidence ?? inferenceResult.confidence_score ?? null,
        abstain: safetyLayer.abstain_recommendation,
    };
    payload.clinical_signal = antigravitySignal;
    payload.signal_quality_score = antigravitySignal.signal_quality_score;
    payload.signal_weight_profile = signalWeightProfile;
    payload.pathophysiology_prioritization = signalWeightProfile.system_dominance;
    payload.priority_signals = signalWeightProfile.weighted_signals.slice(0, 6);
    payload.reasoning_alignment = buildClinicalReasoningAlignmentSnapshot({
        inputSignature: normalizedSig,
        outputPayload: payload,
    });

    // ── Phase 1: VKG Differential Enrichment ─────────────────────────────────
    try {
        const vkg = getVKG();
        const topDiff = Array.isArray(payload.differentials) ? payload.differentials as Array<Record<string, unknown>> : [];
        if (topDiff.length > 0) {
            const topName = String(topDiff[0]?.name ?? topDiff[0]?.condition ?? '');
            if (topName) {
                const vkgDiffs = vkg.getDifferentials(topName);
                payload.vkg_related_differentials = vkgDiffs.map(d => ({
                    disease: d.id,
                    relationship: d.type,
                    weight: 1.0,
                }));
                const pathways = vkg.getDiseasesForSymptoms(
                    Array.isArray(normalizedSig.presenting_signs) ? normalizedSig.presenting_signs as string[] : []
                );
                payload.vkg_symptom_pathways = pathways.slice(0, 5);
            }
        }
        // Drug contraindication check from VKG
        const treatmentPlans = payload.treatment_plans as Record<string, unknown> | null;
        if (treatmentPlans) {
            const drugs = Object.values(treatmentPlans).flatMap((plan: unknown) => {
                const p = plan as Record<string, unknown>;
                return Array.isArray(p?.drugs) ? p.drugs as string[] : [];
            });
            const species = typeof normalizedSig.species === 'string' ? normalizedSig.species : 'canine';
            payload.vkg_drug_contraindications = drugs.flatMap(drug =>
                vkg.getDrugContraindications(drug, species).map(c => ({
                    drug,
                    contraindication: c.id,
                    weight: 1.0,
                }))
            );
        }
    } catch { /* VKG enrichment non-critical */ }
    pipelineTrace.push({ stage: 'vkg_enrichment', status: 'completed' });

    // ── Phase 1: Drug Interaction Safety ─────────────────────────────────────
    try {
        const die = getDrugInteractionEngine();
        const treatmentPlans = payload.treatment_plans as Record<string, unknown> | null;
        if (treatmentPlans) {
            const drugs = Object.values(treatmentPlans).flatMap((plan: unknown) => {
                const p = plan as Record<string, unknown>;
                return Array.isArray(p?.drugs) ? p.drugs as string[] : [];
            });
            const species = typeof normalizedSig.species === 'string' ? normalizedSig.species : 'canine';
            const conditions: string[] = [];
            if (Array.isArray(payload.differentials)) {
                (payload.differentials as Array<Record<string, unknown>>).slice(0, 3).forEach(d => {
                    const name = String(d?.name ?? d?.condition ?? '');
                    if (name) conditions.push(name);
                });
            }
            if (drugs.length > 1) {
                const interactions = die.check({ drugs, species, conditions });
                payload.drug_interaction_analysis = {
                    interactions: interactions.interactions.map(i => ({
                        drug_a: i.drug1,
                        drug_b: i.drug2,
                        severity: i.severity,
                        mechanism: i.mechanism,
                        clinical_effect: i.clinicalEffect,
                        clinical_note: i.clinicalEffect,
                    })),
                    overall_safety: interactions.overallRisk,
                    critical_alerts: [],
                };
            }
        }
    } catch { /* Drug interaction check non-critical */ }
    pipelineTrace.push({ stage: 'drug_interaction_check', status: 'completed' });

    // ── Phase 1: Constitutional AI Safety Gate ────────────────────────────────
    try {
        const constitutional = getConstitutionalAI();
        const species = typeof normalizedSig.species === 'string' ? normalizedSig.species : 'canine';
        const topDiff = Array.isArray(payload.differentials) ? payload.differentials as Array<Record<string, unknown>> : [];
        const primaryDiag = String(topDiff[0]?.name ?? topDiff[0]?.condition ?? '');
        const diagObj = payload.diagnosis as Record<string, unknown> | null;
        const confidence = typeof (diagObj?.confidence_score) === 'number' ? (diagObj.confidence_score as number) :
            typeof payload.confidence_score === 'number' ? payload.confidence_score : 0.5;
        const recommendations: string[] = [];
        if (payload.treatment_plans && typeof payload.treatment_plans === 'object') {
            Object.values(payload.treatment_plans as Record<string, unknown>).forEach((plan: unknown) => {
                const p = plan as Record<string, unknown>;
                if (Array.isArray(p?.drugs)) (p.drugs as string[]).forEach(d => recommendations.push(d));
                if (typeof p?.protocol === 'string') recommendations.push(p.protocol);
            });
        }
        const constitutionalEval = constitutional.evaluate(
            payload as Record<string, unknown>,
            {
                species,
                confidence_score: confidence,
                raw_output: payload as Record<string, unknown>,
            }
        );
        payload.constitutional_evaluation = {
            decision: constitutionalEval.decision,
            violations: constitutionalEval.violations,
            requires_hitl: constitutionalEval.requiresHITL,
            confidence_gate_passed: constitutionalEval.confidenceGate.passed,
            uncertainty_statement: constitutionalEval.uncertaintySurface.uncertaintyStatement,
        };
        // If blocked, surface the reason prominently
        if (constitutionalEval.decision === 'block') {
            payload.constitutional_block = true;
            payload.constitutional_block_reason = constitutionalEval.blockedReason;
            if (!Array.isArray(payload.uncertainty_notes)) payload.uncertainty_notes = [];
            (payload.uncertainty_notes as string[]).unshift(
                `SAFETY GATE: ${constitutionalEval.blockedReason ?? 'Constitutional AI blocked this output.'}`
            );
        }
    } catch { /* Constitutional AI non-critical */ }
    pipelineTrace.push({ stage: 'constitutional_ai_gate', status: 'completed' });

    try {
        const primaryDiagnosis = resolvePrimaryDiagnosisFromPayload(payload);
        const activeDiagnoses = extractActiveDiagnoses(payload, primaryDiagnosis);
        const treatmentLabels = extractTreatmentLabels(payload);
        const selectedTreatment = treatmentLabels[0] ?? null;

        if (primaryDiagnosis) {
            payload.causal_context = await getCausalEngine().getCausalContext(
                primaryDiagnosis,
                species,
                selectedTreatment,
            );

            if (runtimeContext.tenantId && treatmentLabels.length > 1) {
                const counterfactuals = [];
                for (const alternative of treatmentLabels.slice(1, 3)) {
                    counterfactuals.push(await getCounterfactualSimulator().simulate({
                        tenantId: runtimeContext.tenantId,
                        inferenceEventId: runtimeContext.inferenceEventId,
                        species,
                        breed: readText(normalizedSig.breed),
                        ageYears: readNumber(normalizedSig.age_years),
                        confirmedDiagnosis: primaryDiagnosis,
                        treatmentActual: selectedTreatment ?? treatmentLabels[0],
                        treatmentCounterfactual: alternative,
                        symptomVector: extractSymptomVector(normalizedSig),
                        biomarkers: extractBiomarkerSnapshot(normalizedSig),
                    }));
                }
                payload.causal_counterfactuals = counterfactuals;
            } else {
                payload.causal_counterfactuals = [];
            }

            if (runtimeContext.tenantId && runtimeContext.patientId) {
                const livingMemory = getLivingCaseMemory();
                await livingMemory.upsertNode({
                    tenantId: runtimeContext.tenantId,
                    patientId: runtimeContext.patientId,
                    inferenceEventId: runtimeContext.inferenceEventId,
                    species,
                    breed: readText(normalizedSig.breed),
                    activeDiagnoses,
                    lastSymptoms: extractSymptomVector(normalizedSig),
                    lastBiomarkers: extractBiomarkerSnapshot(normalizedSig),
                    lastTreatment: selectedTreatment,
                    lastOutcome: null,
                });
                payload.living_case_context = await livingMemory.getInsight({
                    tenantId: runtimeContext.tenantId,
                    patientId: runtimeContext.patientId,
                    species,
                    activeDiagnoses,
                    treatment: selectedTreatment,
                });
            } else {
                payload.living_case_context = null;
            }
        } else {
            payload.causal_context = null;
            payload.causal_counterfactuals = [];
            payload.living_case_context = null;
        }
        pipelineTrace.push({ stage: 'causal_clinical_memory', status: 'completed', detail: primaryDiagnosis ?? 'no primary diagnosis' });
    } catch (error) {
        payload.causal_context = {
            available: false,
            error: error instanceof Error ? error.message : 'Causal context unavailable',
        };
        payload.causal_counterfactuals = [];
        payload.living_case_context = null;
        pipelineTrace.push({ stage: 'causal_clinical_memory', status: 'completed', detail: 'unavailable' });
    }

    // ── Phase 1: Vector Store Upsert (async, non-blocking) ───────────────────
    const tenantIdForVector = runtimeContext.tenantId ?? (
        typeof (normalizedSig as Record<string, unknown>).tenant_id === 'string'
            ? (normalizedSig as Record<string, unknown>).tenant_id as string
            : 'platform'
    );
    const inferenceEventIdForVector = runtimeContext.inferenceEventId ?? (
        typeof (normalizedSig as Record<string, unknown>).inference_event_id === 'string'
            ? (normalizedSig as Record<string, unknown>).inference_event_id as string
            : ''
    );
    if (inferenceEventIdForVector) {
        const clinicalCaseForEmbed = {
            species: typeof normalizedSig.species === 'string' ? normalizedSig.species : 'canine',
            breed: typeof normalizedSig.breed === 'string' ? normalizedSig.breed : null,
            symptoms: Array.isArray(normalizedSig.presenting_signs) ? normalizedSig.presenting_signs as string[] : [],
            diagnosis: String(Array.isArray(payload.differentials) && payload.differentials.length > 0
                ? ((payload.differentials as Array<Record<string, unknown>>)[0]?.name ?? '')
                : ''),
        };
        embedClinicalCase(clinicalCaseForEmbed).then(embedding => {
            const vs = getVectorStore();
            return vs.upsert({
                inferenceEventId: inferenceEventIdForVector,
                tenantId: tenantIdForVector,
                clinicalCase: clinicalCaseForEmbed,
                embedding,
                diagnosis: clinicalCaseForEmbed.diagnosis || null,
                confidenceScore: typeof payload.confidence_score === 'number' ? payload.confidence_score : null,
            });
        }).catch(() => { /* non-critical */ });
    }
    pipelineTrace.push({ stage: 'vector_store_upsert', status: 'completed' });



    const finalDiagnosis = payload.diagnosis as InferencePipelineDiagnosis;
    finalDiagnosis.primary_condition_class = resolveConditionClass(finalDiagnosis);
    const resolvedSeverityScore = resolveSeverityScore(risk);
    const resolvedEmergencyLevel = resolveEmergencyLevel(risk);
    risk.severity_score = resolvedSeverityScore;
    risk.emergency_level = resolvedEmergencyLevel;
    payload.emergency_assessment = {
        emergency_level: resolvedEmergencyLevel,
        severity_score: resolvedSeverityScore,
        drivers: Object.entries(payload.severity_feature_importance as Record<string, number>)
            .map(([feature, weight]) => ({ feature, weight }))
            .sort((left, right) => Number(right.weight) - Number(left.weight))
            .slice(0, 5),
    };
    const riskModelOutput = buildCatastrophicRiskOutput({
        signals,
        emergencyEval,
        severityScore: resolvedSeverityScore,
        legacyOperationalRisk: !('_fallback' in mlRisk) ? mlRisk.risk_score : null,
    });
    payload.risk_model_output = riskModelOutput;
    risk.risk_definition = 'severity_score reflects current physiologic instability; catastrophic abdominal risk values estimate near-term deterioration, urgent operative need, and shock progression.';
    risk.catastrophic_deterioration_risk_6h = riskModelOutput.catastrophic_deterioration_risk_6h;
    risk.operative_urgency_risk = riskModelOutput.operative_urgency_risk;
    risk.shock_risk = riskModelOutput.shock_risk;
    risk.legacy_ml_operational_risk = riskModelOutput.legacy_ml_operational_risk;
    const systemGatingTelemetry = (safetyLayer.telemetry as Record<string, unknown>).system_gating as Record<string, unknown> | undefined;
    const dominantSystems = Array.isArray(systemGatingTelemetry?.dominant_systems)
        ? ((systemGatingTelemetry.dominant_systems as unknown[]).join(', ') || 'undifferentiated')
        : 'undifferentiated';
    const allowedSystems = Array.isArray(systemGatingTelemetry?.allowed_systems)
        ? ((systemGatingTelemetry.allowed_systems as unknown[]).join(', ') || 'open')
        : 'open';
    payload.pipeline_trace = [
        ...pipelineTrace,
        {
            stage: 'system_classification',
            status: 'completed',
            detail: String(dominantSystems),
        },
        {
            stage: 'candidate_restriction',
            status: 'completed',
            detail: String(allowedSystems),
        },
        { stage: 'condition_classification', status: 'completed', detail: String(finalDiagnosis.primary_condition_class ?? 'Undifferentiated') },
        { stage: 'mechanism_layering', status: 'completed', detail: String(safetyLayer.mechanism_class.label) },
        { stage: 'dataset_writeback_ready', status: 'completed' },
    ];
    (payload.telemetry as Record<string, unknown>).pipeline_stage_completion = payload.pipeline_trace;

    const finalConfidence = typeof finalDiagnosis.confidence_score === 'number' ? finalDiagnosis.confidence_score : null;

    const uncertaintyMetrics = {
        ...(inferenceResult.uncertainty_metrics ?? {}),
        contradiction_score: contradiction?.contradiction_score ?? 0,
        contradiction_triggers: contradiction?.contradiction_reasons ?? [],
        pre_cap_confidence: safetyLayer.telemetry.pre_cap_confidence ?? null,
        post_cap_confidence: safetyLayer.telemetry.post_cap_confidence ?? null,
        persistence_rule_triggers: safetyLayer.telemetry.persistence_rule_triggers ?? [],
        pipeline_stages: payload.pipeline_trace,
        signal_quality_score: antigravitySignal.signal_quality_score,
        signal_weight_profile: {
            applied_overrides: signalWeightProfile.applied_overrides,
            emergency_overrides: signalWeightProfile.emergency_overrides,
            category_totals: signalWeightProfile.category_totals,
            system_dominance: signalWeightProfile.system_dominance,
        },
        mechanism_class: payload.mechanism_class ?? null,
        risk_model_output: payload.risk_model_output ?? null,
        reasoning_alignment: payload.reasoning_alignment ?? null,
    };

    return {
        normalizedInput: normalizedSig,
        output_payload: payload,
        confidence_score: finalConfidence,
        uncertainty_metrics: uncertaintyMetrics,
        contradiction_analysis: payload.contradiction_analysis,
        mlRisk,
    };
}

function elevateEmergencyLevel(currentRaw: string, target: string): string {
    const levels = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];
    const current = currentRaw.toUpperCase();
    return levels.indexOf(target) > levels.indexOf(current) ? target : current;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function resolveRuntimeContext(
    normalizedSig: Record<string, unknown>,
    explicit: {
        tenantId?: string | null;
        patientId?: string | null;
        inferenceEventId?: string | null;
    },
): { tenantId: string | null; patientId: string | null; inferenceEventId: string | null } {
    const metadata = asRecord(normalizedSig.metadata);
    return {
        tenantId:
            explicit.tenantId ??
            readText(normalizedSig.tenant_id) ??
            readText(metadata.tenant_id) ??
            null,
        patientId:
            explicit.patientId ??
            readText(normalizedSig.patient_id) ??
            readText(normalizedSig.patientId) ??
            readText(normalizedSig.pet_id) ??
            readText(metadata.patient_id) ??
            readText(metadata.patientId) ??
            readText(metadata.pet_id) ??
            null,
        inferenceEventId:
            explicit.inferenceEventId ??
            readText(normalizedSig.inference_event_id) ??
            readText(metadata.inference_event_id) ??
            null,
    };
}

function resolvePrimaryDiagnosisFromPayload(payload: Record<string, unknown>): string | null {
    const diagnosis = asRecord(payload.diagnosis) as InferencePipelineDiagnosis;
    return extractTopDiagnosis(diagnosis);
}

function extractActiveDiagnoses(payload: Record<string, unknown>, primary: string | null): string[] {
    const values: string[] = [];
    if (primary) values.push(primary);
    const diagnosis = asRecord(payload.diagnosis);
    const topDifferentials = Array.isArray(diagnosis.top_differentials)
        ? diagnosis.top_differentials
        : Array.isArray(payload.differentials)
            ? payload.differentials
            : [];
    for (const entry of topDifferentials.slice(0, 3)) {
        if (typeof entry === 'string') values.push(entry);
        if (entry && typeof entry === 'object') {
            const record = entry as Record<string, unknown>;
            const label = readText(record.name) ?? readText(record.condition) ?? readText(record.diagnosis);
            if (label) values.push(label);
        }
    }
    return Array.from(new Set(values));
}

function extractTreatmentLabels(payload: Record<string, unknown>): string[] {
    const treatmentPlans = asRecord(payload.treatment_plans);
    const labels: string[] = [];
    for (const [key, value] of Object.entries(treatmentPlans)) {
        labels.push(...collectTreatmentLabels(value, key));
    }
    return Array.from(new Set(labels.map((label) => label.trim()).filter(Boolean))).slice(0, 5);
}

function collectTreatmentLabels(value: unknown, fallbackKey?: string): string[] {
    if (!value || typeof value !== 'object') return [];
    if (Array.isArray(value)) {
        return value.flatMap((entry) => collectTreatmentLabels(entry, fallbackKey));
    }

    const record = value as Record<string, unknown>;
    const direct =
        readText(record.treatment_pathway) ??
        readText(record.protocol) ??
        readText(record.name) ??
        readText(record.treatment) ??
        readText(record.plan);
    const drugLabels = Array.isArray(record.drugs)
        ? record.drugs.filter((entry): entry is string => typeof entry === 'string')
        : [];
    const procedureLabels = Array.isArray(record.procedures)
        ? record.procedures.filter((entry): entry is string => typeof entry === 'string')
        : [];
    const base = direct ?? drugLabels[0] ?? procedureLabels[0] ?? null;
    const disease = readText(record.disease) ?? fallbackKey ?? null;
    const current = base ? [`${disease ? `${disease} | ` : ''}${base}`] : [];
    const nested = Object.values(record)
        .filter((entry) => entry && typeof entry === 'object')
        .flatMap((entry) => collectTreatmentLabels(entry, fallbackKey));
    return [...current, ...nested];
}

function extractSymptomVector(normalizedSig: Record<string, unknown>): string[] {
    const candidates = [
        normalizedSig.presenting_signs,
        normalizedSig.symptoms,
        normalizedSig.symptom_vector,
    ];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            return candidate
                .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
                .map((entry) => entry.trim());
        }
    }
    return [];
}

function extractBiomarkerSnapshot(normalizedSig: Record<string, unknown>): Record<string, number | string | null> | null {
    for (const key of ['biomarkers', 'lab_values', 'labs']) {
        const record = asRecord(normalizedSig[key]);
        if (Object.keys(record).length > 0) {
            return Object.fromEntries(
                Object.entries(record)
                    .filter(([, value]) => typeof value === 'number' || typeof value === 'string' || value === null)
                    .slice(0, 40),
            ) as Record<string, number | string | null>;
        }
    }
    return null;
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function resolveConditionClass(diagnosis: InferencePipelineDiagnosis): string {
    const explicit = normalizeConditionClass(
        typeof diagnosis.primary_condition_class === 'string'
            ? diagnosis.primary_condition_class
            : typeof diagnosis.condition_class === 'string'
                ? diagnosis.condition_class
                : highestProbabilityClass(diagnosis.condition_class_probabilities),
    );
    if (explicit && explicit !== 'Undifferentiated') {
        return explicit;
    }

    return inferConditionClassFromDiagnosis(extractTopDiagnosis(diagnosis)) ?? explicit ?? 'Undifferentiated';
}

function resolveSeverityScore(risk: InferencePipelineRisk): number {
    const explicit = typeof risk.severity_score === 'number'
        ? risk.severity_score
        : typeof risk.severity_score === 'string'
            ? Number(risk.severity_score)
            : null;
    if (typeof explicit === 'number' && Number.isFinite(explicit)) {
        return Math.max(0, Math.min(1, explicit));
    }

    return severityScoreFromEmergencyLevel(resolveEmergencyLevel(risk));
}

function resolveEmergencyLevel(risk: InferencePipelineRisk): string {
    const explicit = typeof risk.emergency_level === 'string' ? risk.emergency_level.trim().toUpperCase() : null;
    if (explicit === 'CRITICAL' || explicit === 'HIGH' || explicit === 'MODERATE' || explicit === 'LOW') {
        return explicit;
    }

    const severity = typeof risk.severity_score === 'number'
        ? risk.severity_score
        : typeof risk.severity_score === 'string'
            ? Number(risk.severity_score)
            : null;

    if (typeof severity === 'number' && Number.isFinite(severity)) {
        return severity >= 0.85
            ? 'CRITICAL'
            : severity >= 0.6
                ? 'HIGH'
                : severity >= 0.3
                    ? 'MODERATE'
                    : 'LOW';
    }

    return 'MODERATE';
}

function severityScoreFromEmergencyLevel(level: string): number {
    if (level === 'CRITICAL') return 0.95;
    if (level === 'HIGH') return 0.72;
    if (level === 'LOW') return 0.2;
    return 0.42;
}

function extractTopDiagnosis(diagnosis: InferencePipelineDiagnosis): string | null {
    const topDifferentials = Array.isArray(diagnosis.top_differentials) ? diagnosis.top_differentials : [];
    const top = topDifferentials[0];
    if (typeof top === 'object' && top !== null) {
        const record = top as Record<string, unknown>;
        if (typeof record.name === 'string' && record.name.trim()) return record.name.trim();
        if (typeof record.diagnosis === 'string' && record.diagnosis.trim()) return record.diagnosis.trim();
    }

    if (typeof diagnosis.top_diagnosis === 'string' && diagnosis.top_diagnosis.trim()) return diagnosis.top_diagnosis.trim();
    if (typeof diagnosis.predicted_diagnosis === 'string' && diagnosis.predicted_diagnosis.trim()) return diagnosis.predicted_diagnosis.trim();
    return null;
}

function normalizeConditionClass(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) return null;
    const lower = normalized.toLowerCase();
    if (lower === 'idiopathic / unknown' || lower === 'idiopathic' || lower === 'unknown') {
        return 'Undifferentiated';
    }
    return normalized;
}

function highestProbabilityClass(value: unknown): string | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return null;
    }
    let winner: string | null = null;
    let best = Number.NEGATIVE_INFINITY;
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
        const score = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : null;
        if (score == null || !Number.isFinite(score) || score <= best) continue;
        winner = key;
        best = score;
    }
    return winner;
}

function inferConditionClassFromDiagnosis(value: string | null): string | null {
    const normalized = (value ?? '').toLowerCase();
    if (!normalized) return null;
    if (
        normalized.includes('gdv') ||
        normalized.includes('dilatation') ||
        normalized.includes('volvulus') ||
        normalized.includes('obstruction') ||
        normalized.includes('tracheal collapse')
    ) {
        return 'Mechanical';
    }
    if (
        normalized.includes('herpesvirus') ||
        normalized.includes('tracheobronchitis') ||
        normalized.includes('viral') ||
        normalized.includes('bacterial') ||
        normalized.includes('infection') ||
        normalized.includes('parvo') ||
        normalized.includes('distemper') ||
        normalized.includes('rhinotracheitis') ||
        normalized.includes('kennel cough')
    ) {
        return 'Infectious';
    }
    if (normalized.includes('bronchitis') || normalized.includes('pancreatitis')) {
        return 'Inflammatory';
    }
    if (normalized.includes('toxic')) {
        return 'Toxicology';
    }
    return null;
}
