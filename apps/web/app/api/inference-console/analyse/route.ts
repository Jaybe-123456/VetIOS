import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { analyseLabResults, parseCsvLabResults, type LabPatternMatch, type LabReport } from '@/lib/inferenceConsole/labAnalysis';
import { resolveClinicalApiActor, type ClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { safeJson } from '@/lib/http/safeJson';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const maxDuration = 30;

const LabAnalyteSchema = z.object({
    analyte: z.string().trim().min(1).max(120),
    value: z.number(),
    unit: z.string().trim().max(40).optional(),
    reference_low: z.number().optional(),
    reference_high: z.number().optional(),
});

const AnalyseSchema = z.object({
    session_id: z.string().trim().max(120).optional().nullable(),
    patient: z.object({
        species: z.string().trim().min(1).max(40),
        breed: z.string().trim().max(80).optional(),
        age_years: z.number().min(0).optional(),
        weight_kg: z.number().min(0).optional(),
        sex: z.string().trim().max(40).optional(),
        reproductive_status: z.string().trim().max(40).optional(),
    }),
    presenting_complaint: z.string().trim().max(1000).optional(),
    clinical_history: z.string().trim().max(4000).optional(),
    lab_results: z.array(LabAnalyteSchema).max(300).default([]),
    lab_results_csv: z.string().max(200_000).optional(),
});

const MODEL_VERSION = 'inference-console-v2-lab-foundation';

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000, maxBodySize: 256 * 1024 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['inference:write'],
    });
    if (auth.error || !auth.actor) {
        return withHeaders(
            NextResponse.json(
                { error: auth.error?.message ?? 'Unauthorized', request_id: requestId },
                { status: auth.error?.status ?? 401 },
            ),
            requestId,
            startTime,
        );
    }

    const parsedJson = await safeJson(req);
    if (!parsedJson.ok) {
        return withHeaders(NextResponse.json({ error: parsedJson.error, request_id: requestId }, { status: 400 }), requestId, startTime);
    }

    const parsed = AnalyseSchema.safeParse(parsedJson.data);
    if (!parsed.success) {
        return withHeaders(NextResponse.json({ error: 'invalid_input', details: parsed.error.flatten(), request_id: requestId }, { status: 400 }), requestId, startTime);
    }

    const csvResults = parsed.data.lab_results_csv ? parseCsvLabResults(parsed.data.lab_results_csv) : [];
    const labResults = [...parsed.data.lab_results, ...csvResults];
    if (labResults.length === 0) {
        return withHeaders(NextResponse.json({ error: 'No lab results supplied.', request_id: requestId }, { status: 400 }), requestId, startTime);
    }

    const labReport = analyseLabResults({
        species: parsed.data.patient.species,
        results: labResults,
    });
    const report = buildInferenceConsoleReport({
        sessionId: parsed.data.session_id ?? null,
        patient: parsed.data.patient,
        presentingComplaint: parsed.data.presenting_complaint,
        clinicalHistory: parsed.data.clinical_history,
        labReport,
    });

    void persistReport(report, auth.actor).catch((error) => {
        console.warn('[inference-console/analyse] report persistence failed:', error);
    });

    return withHeaders(NextResponse.json({ ...report, request_id: requestId }), requestId, startTime);
}

function buildInferenceConsoleReport(input: {
    sessionId: string | null;
    patient: z.infer<typeof AnalyseSchema>['patient'];
    presentingComplaint?: string;
    clinicalHistory?: string;
    labReport: LabReport;
}) {
    const differentials = input.labReport.pattern_matches.map((pattern, index) => mapPatternToDifferential(pattern, index + 1));
    const criticalLabValues = input.labReport.critical_values;
    const emergencyReason = criticalLabValues.length > 0
        ? 'One or more submitted lab values is classified as critical.'
        : undefined;

    return {
        report_id: randomUUID(),
        session_id: input.sessionId ?? 'sessionless',
        inference_event_id: randomUUID(),
        patient: input.patient,
        presenting_complaint: input.presentingComplaint,
        clinical_history: input.clinicalHistory,
        imaging_reports: [],
        lab_report: input.labReport,
        differentials,
        primary_assessment: buildPrimaryAssessment(input.labReport),
        key_abnormalities: input.labReport.key_abnormalities_summary.split('; ').filter(Boolean),
        critical_flags: {
            emergency: criticalLabValues.length > 0,
            emergency_reason: emergencyReason,
            critical_lab_values: criticalLabValues,
            critical_imaging_findings: [],
        },
        recommended_diagnostics: buildRecommendedDiagnostics(input.labReport),
        recommended_immediate_management: criticalLabValues.length > 0
            ? ['Review critical values immediately with the attending veterinarian and stabilize according to patient status.']
            : [],
        specialist_referral_recommended: criticalLabValues.length > 0 || differentials.some((entry) => entry.confidence >= 0.8),
        specialist_type: inferSpecialistType(input.labReport.pattern_matches),
        confidence_overall: differentials.length > 0 ? Number((differentials.reduce((sum, entry) => sum + entry.confidence, 0) / differentials.length).toFixed(2)) : 0.35,
        uncertainty_flags: buildUncertaintyFlags(input.labReport),
        model_limitations: [
            'Lab-only analysis cannot localize lesions without history, examination, imaging, urinalysis, and trend context.',
            'Reference intervals are analyser-, lab-, age-, and species-dependent.',
        ],
        disclaimer: buildDisclaimer(),
        generated_at: new Date().toISOString(),
        model_version: MODEL_VERSION,
        outcome_channel_open: true,
        simulation_candidates: differentials.filter((entry) => entry.confidence_label !== 'HIGH').map((entry) => entry.diagnosis),
    };
}

function mapPatternToDifferential(pattern: LabPatternMatch, rank: number) {
    const diagnosis = diagnosisForPattern(pattern.pattern_name);
    const confidence = Number(pattern.confidence.toFixed(2));
    return {
        rank,
        diagnosis,
        confidence,
        confidence_label: confidence >= 0.75 ? 'HIGH' : confidence >= 0.45 ? 'MODERATE' : confidence >= 0.1 ? 'LOW' : 'RULE_OUT',
        evidence: {
            imaging_findings: [],
            lab_patterns: [pattern.pattern_name],
            lab_analytes: pattern.supporting_analytes,
            clinical_signs: [],
        },
        contradicting_evidence: {
            imaging_findings: [],
            lab_patterns: pattern.contradicting_analytes,
            explanation: pattern.contradicting_analytes.length > 0 ? 'Some submitted analytes reduce confidence.' : '',
        },
        pathognomonic_combination: pattern.confidence >= 0.85,
        recommended_confirmatory_tests: confirmatoryTestsForPattern(pattern.pattern_name),
        treatment_direction: 'Treat only after clinician review, patient-specific examination, and confirmation of the working diagnosis.',
        prognosis: {
            label: 'unknown',
            caveats: 'Prognosis depends on final diagnosis, severity, response to stabilization, and comorbidities.',
        },
    };
}

function diagnosisForPattern(patternName: string): string {
    if (patternName.includes('Azotaemia')) return 'Azotaemia - localize prerenal, renal, or postrenal cause';
    if (patternName.includes('sodium:potassium')) return 'Hypoadrenocorticism major rule-out';
    if (patternName.includes('Pancreatic')) return 'Pancreatitis or pancreatic injury';
    if (patternName.includes('thrombocytopenia')) return 'Severe thrombocytopenia differential set';
    if (patternName.includes('hepatocellular')) return 'Hepatobiliary injury or cholestasis';
    if (patternName.includes('leucogram')) return patternName;
    if (patternName.includes('Hyperglycaemia')) return 'Hyperglycaemia differential set';
    return patternName;
}

function confirmatoryTestsForPattern(patternName: string) {
    if (patternName.includes('Azotaemia')) {
        return [
            { test: 'Urinalysis with specific gravity', rationale: 'Localizes azotaemia pattern.', expected_result_if_positive: 'Inadequate concentrating ability suggests renal involvement.', priority: 'high' },
            { test: 'Blood pressure and renal imaging', rationale: 'Assesses complications and obstruction.', expected_result_if_positive: 'Hypertension or renal/urinary tract abnormality.', priority: 'high' },
        ];
    }
    if (patternName.includes('sodium:potassium')) {
        return [
            { test: 'Baseline cortisol or ACTH stimulation test', rationale: 'Confirms or excludes hypoadrenocorticism.', expected_result_if_positive: 'Low baseline cortisol or inadequate ACTH response.', priority: 'urgent' },
        ];
    }
    if (patternName.includes('Pancreatic')) {
        return [
            { test: 'Abdominal ultrasound', rationale: 'Looks for pancreatic and peripancreatic changes.', expected_result_if_positive: 'Pancreatic enlargement, altered echogenicity, or peripancreatic fluid/fat changes.', priority: 'high' },
        ];
    }
    return [
        { test: 'Repeat/confirm abnormal analytes and review blood smear where relevant', rationale: 'Rules out analyser or sample artefact.', expected_result_if_positive: 'Abnormality persists or morphology supports the pattern.', priority: 'routine' },
    ];
}

function buildPrimaryAssessment(labReport: LabReport): string {
    if (labReport.pattern_matches.length === 0) {
        return 'Submitted laboratory values do not form a high-confidence named pattern. Interpret with patient history, examination, and complete diagnostics.';
    }
    const top = labReport.pattern_matches[0];
    return `Top laboratory pattern is ${top.pattern_name} (${Math.round(top.confidence * 100)}% confidence). ${top.clinical_interpretation}`;
}

function buildRecommendedDiagnostics(labReport: LabReport) {
    const tests = new Map<string, { test: string; rationale: string; priority: 'stat' | 'urgent' | 'high' | 'routine' }>();
    for (const differential of labReport.pattern_matches.map((pattern, index) => mapPatternToDifferential(pattern, index + 1))) {
        for (const test of differential.recommended_confirmatory_tests) {
            tests.set(test.test, {
                test: test.test,
                rationale: test.rationale,
                priority: test.priority === 'urgent' ? 'urgent' : test.priority === 'high' ? 'high' : 'routine',
            });
        }
    }
    return [...tests.values()];
}

function buildUncertaintyFlags(labReport: LabReport): string[] {
    const flags: string[] = [];
    if (labReport.pattern_matches.length === 0) flags.push('NO_HIGH_CONFIDENCE_LAB_PATTERN');
    if (!labReport.panel_types.includes('urinalysis') && labReport.pattern_matches.some((entry) => entry.pattern_category === 'renal')) {
        flags.push('RENAL_PATTERN_WITHOUT_URINALYSIS');
    }
    flags.push('VERIFY_REFERENCE_INTERVALS_AND_ANALYSER');
    return flags;
}

function inferSpecialistType(patterns: LabPatternMatch[]): string | undefined {
    if (patterns.some((entry) => entry.pattern_category === 'renal')) return 'internal medicine';
    if (patterns.some((entry) => entry.pattern_category === 'hepatic' || entry.pattern_category === 'pancreatic')) return 'internal medicine';
    if (patterns.some((entry) => entry.pattern_category === 'haematology')) return 'internal medicine';
    return undefined;
}

function buildDisclaimer(): string {
    return `VETIOS INFERENCE CONSOLE - CLINICAL DECISION SUPPORT NOTICE

This report is generated by an AI-powered diagnostic reasoning system and is
intended to SUPPORT, not replace, the clinical judgement of a licensed veterinarian.
All findings, differentials, and recommendations require review and validation by
a qualified veterinary professional before any clinical action is taken.

Confidence scores represent the model's internal calibration and should not be
interpreted as definitive diagnostic certainty. Reference ranges are species- and
context-dependent; apply clinical judgement when interpreting borderline values.

This output has not been reviewed by a board-certified veterinary specialist.
For complex, critical, or ambiguous cases, specialist consultation is strongly recommended.

VetIOS Inference Console - inference-v2-lab-foundation - ${new Date().toISOString()}`;
}

async function persistReport(
    report: ReturnType<typeof buildInferenceConsoleReport>,
    actor: ClinicalApiActor,
): Promise<void> {
    const client = getSupabaseServer();
    const { data: labData } = await client
        .from('lab_reports')
        .insert({
            id: report.lab_report.report_id,
            tenant_id: actor.tenantId,
            user_id: actor.userId,
            inference_event_id: report.inference_event_id,
            session_id: report.session_id,
            species: report.lab_report.species,
            panel_types: report.lab_report.panel_types,
            analyte_results: report.lab_report.analyte_results,
            critical_values: report.lab_report.critical_values,
            pattern_matches: report.lab_report.pattern_matches,
            key_abnormalities_summary: report.lab_report.key_abnormalities_summary,
            model_version: MODEL_VERSION,
        })
        .select('id')
        .maybeSingle();

    await client
        .from('inference_console_reports')
        .insert({
            id: report.report_id,
            tenant_id: actor.tenantId,
            user_id: actor.userId,
            inference_event_id: report.inference_event_id,
            session_id: report.session_id,
            patient: report.patient,
            lab_report_id: labData?.id ?? report.lab_report.report_id,
            differentials: report.differentials,
            primary_assessment: report.primary_assessment,
            critical_flags: report.critical_flags,
            recommended_diagnostics: report.recommended_diagnostics,
            confidence_overall: report.confidence_overall,
            uncertainty_flags: report.uncertainty_flags,
            model_version: MODEL_VERSION,
        });
}

function withHeaders(response: NextResponse, requestId: string, startTime: number): NextResponse {
    withRequestHeaders(response.headers, requestId, startTime);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}
