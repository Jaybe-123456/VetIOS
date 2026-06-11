import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { formatZodErrors } from '@/lib/http/schemas';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import {
    completeClinicalCaseImportJob,
    createClinicalCaseImportJob,
    hashImportPayload,
    missingImportJobStorageMessage,
    type ClinicalCaseImportJobRecord,
} from '@/lib/dataset/importJobs';
import { importRealClinicalCases, type RealCaseImportRow } from '@/lib/dataset/realCaseImport';
import { listTenantLearningConsents } from '@/lib/learning/consent';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OptionalNumber = z.preprocess((value) => {
    if (value === '' || value == null) return null;
    return typeof value === 'number' ? value : Number(value);
}, z.number().finite().nullable()).optional();

const RealCaseImportRowSchema = z.object({
    source_case_reference: z.string().min(1),
    usage_class: z.enum(['credentialed_deidentified', 'internal_deidentified', 'consented_research']),
    deidentified: z.boolean(),
    patient: z.object({
        species: z.string().min(1),
        breed: z.string().optional().nullable(),
        age_years: OptionalNumber,
        weight_kg: OptionalNumber,
        sex: z.string().optional().nullable(),
        deidentified_patient_ref: z.string().optional().nullable(),
        name: z.string().optional().nullable(),
        owner_name: z.string().optional().nullable(),
        owner_contact: z.record(z.string(), z.unknown()).optional().nullable(),
        microchip_id: z.string().optional().nullable(),
    }),
    presenting_complaint: z.string().min(1),
    symptoms: z.preprocess((value) => {
        if (typeof value === 'string') return value.split(/[,;]/).map((entry) => entry.trim()).filter(Boolean);
        return value;
    }, z.array(z.string().min(1)).min(1)),
    history: z.string().optional().nullable(),
    physical_exam: z.record(z.string(), z.unknown()).optional().nullable(),
    diagnostics: z.record(z.string(), z.unknown()).optional().nullable(),
    labs: z.record(z.string(), z.unknown()).optional().nullable(),
    confirmed_diagnosis: z.string().min(1),
    diagnosis_method: z.enum(['clinical', 'lab_confirmed', 'imaging_confirmed', 'pathology', 'response_to_treatment']).optional().nullable(),
    diagnosis_confidence: OptionalNumber,
    primary_condition_class: z.string().optional().nullable(),
    outcome_at_followup: z.string().optional().nullable(),
    observed_at: z.string().optional().nullable(),
    learning_consent: z.object({
        deidentified_training: z.boolean().optional(),
        consent_version: z.string().optional().nullable(),
    }).optional().nullable(),
    metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

const CaseImportRequestSchema = z.object({
    dry_run: z.boolean().optional().default(false),
    clinic_id: z.string().optional().nullable(),
    source_name: z.string().optional().nullable(),
    cases: z.array(RealCaseImportRowSchema).min(1).max(100),
});

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();

    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['outcome:write'],
    });
    if (auth.error || !auth.actor) {
        return NextResponse.json(
            { error: auth.error?.message ?? 'Unauthorized', request_id: requestId },
            { status: auth.error?.status ?? 401 },
        );
    }

    const parsedJson = await safeJson(req);
    if (!parsedJson.ok) {
        return NextResponse.json({ error: parsedJson.error, request_id: requestId }, { status: 400 });
    }

    const parsed = CaseImportRequestSchema.safeParse(parsedJson.data);
    if (!parsed.success) {
        return NextResponse.json(
            { error: 'invalid_input', detail: formatZodErrors(parsed.error), request_id: requestId },
            { status: 400 },
        );
    }

    const payloadHash = hashImportPayload(parsed.data);
    let importJob: ClinicalCaseImportJobRecord | null = null;
    let importJobStorageWarning: string | null = null;

    try {
        try {
            importJob = await createClinicalCaseImportJob(supabase, {
                tenantId: auth.actor.tenantId,
                userId: auth.actor.userId,
                clinicId: parsed.data.clinic_id ?? null,
                sourceName: parsed.data.source_name ?? null,
                dryRun: parsed.data.dry_run,
                status: parsed.data.dry_run ? 'validating' : 'importing',
                requestedCases: parsed.data.cases.length,
                payloadHash,
            });
        } catch (jobError) {
            if (jobError instanceof Error && jobError.message === missingImportJobStorageMessage()) {
                importJobStorageWarning = jobError.message;
            } else {
                throw jobError;
            }
        }

        const consents = await listTenantLearningConsents(supabase, auth.actor.tenantId, 'deidentified_training');
        const tenantConsentGranted = consents.some((consent) => consent.status === 'granted');
        const report = await importRealClinicalCases(supabase, {
            tenantId: auth.actor.tenantId,
            userId: auth.actor.userId,
            clinicId: parsed.data.clinic_id ?? null,
            sourceName: parsed.data.source_name ?? null,
            cases: parsed.data.cases as RealCaseImportRow[],
            dryRun: parsed.data.dry_run,
            tenantConsentGranted,
        });

        if (importJob) {
            try {
                importJob = await completeClinicalCaseImportJob(supabase, {
                    tenantId: auth.actor.tenantId,
                    jobId: importJob.id,
                    status: parsed.data.dry_run ? 'validated' : 'completed',
                    report: report as unknown as Record<string, unknown>,
                    summary: report.summary,
                });
            } catch (jobError) {
                importJobStorageWarning = jobError instanceof Error
                    ? jobError.message
                    : 'Clinical case import completed, but import job finalization failed.';
            }
        }

        const response = NextResponse.json(
            {
                data: {
                    ...report,
                    import_job_id: importJob?.id ?? null,
                    import_job_storage_warning: importJobStorageWarning,
                },
                request_id: requestId,
            },
            { status: report.summary.accepted > 0 || parsed.data.dry_run ? 200 : 422 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        if (importJob) {
            await completeClinicalCaseImportJob(supabase, {
                tenantId: auth.actor.tenantId,
                jobId: importJob.id,
                status: 'failed',
                errorMessage: error instanceof Error ? error.message : 'Unknown real-case import error.',
            }).catch(() => null);
        }

        return NextResponse.json(
            {
                error: 'real_case_import_failed',
                detail: error instanceof Error ? error.message : 'Unknown real-case import error.',
                request_id: requestId,
            },
            { status: 500 },
        );
    }
}
