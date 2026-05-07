import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
    buildPharmacOSReasoningResponse,
    generateAnthropicDrugCommentary,
    loadFormularyRecordsFromSupabase,
    loadInteractionRecordsFromSupabase,
    validateSpeciesWeight,
} from '@vetios/pharmacos';
import {
    buildEmptyPharmacOSProtocol,
    buildPharmacOSProtocol,
    extractDrugNames,
    inferCondition,
} from '@/lib/pharmacos/vetiosPharmacos';
import {
    compactSearchTerms,
    detectSpeciesFromTexts,
    isVetiosSpecies,
} from '@/lib/askVetios/context';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const maxDuration = 30;

const RequestSchema = z.object({
    topic: z.string().trim().optional(),
    messageContent: z.string().trim().min(1).max(12000),
    queryText: z.string().trim().max(4000).optional(),
    selectedSpecies: z.string().trim().optional(),
    patientWeightKg: z.number().positive().max(2500).optional(),
});

export async function POST(req: Request) {
    try {
        const parsed = RequestSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 });
        }

        const { topic, messageContent, queryText, selectedSpecies, patientWeightKg } = parsed.data;
        const combinedText = compactSearchTerms([queryText, topic, messageContent]);
        const detectedSpecies = detectSpeciesFromTexts([selectedSpecies, queryText, topic, messageContent], 'unknown');
        const species = isVetiosSpecies(detectedSpecies) ? detectedSpecies : 'canine';
        const inferredWeight = patientWeightKg ?? extractWeightKg(combinedText) ?? 10;
        const condition = inferCondition(topic, compactSearchTerms([queryText, topic]) || combinedText, species, combinedText);
        const validation = process.env.VETIOS_PHARMACOS_WEIGHT_VALIDATION_ENABLED === 'false'
            ? { valid: true as const }
            : validateSpeciesWeight(species, inferredWeight);
        const invalidValidation = validation.valid ? null : validation;

        await logValidationEvent({
            species,
            weightKg: inferredWeight,
            validationResult: invalidValidation ? invalidValidation.severity : 'valid',
            message: invalidValidation?.message ?? null,
            blocked: invalidValidation?.severity === 'impossible',
        });

        if (invalidValidation?.severity === 'impossible') {
            const blockedProtocol = buildEmptyPharmacOSProtocol({
                species,
                condition,
                patientWeightKg: inferredWeight,
            });
            return NextResponse.json(
                {
                    ...blockedProtocol,
                    blocked: true,
                    validation_error: {
                        code: 'PHARMACOS_IMPOSSIBLE_WEIGHT',
                        severity: invalidValidation.severity,
                        message: invalidValidation.message,
                        bounds: invalidValidation.bounds,
                        correction_prompt: `Correct the ${species} weight to a physiologic kg value before requesting dose calculations.`,
                    },
                    summary: invalidValidation.message,
                    candidateSource: 'blocked_weight_validation',
                },
                { status: 422 },
            );
        }

        const explicitDrugCount = extractDrugNames(combinedText).length;
        const pharmacosRaw = await buildPharmacOSProtocol({
            topic,
            messageContent,
            queryText,
            selectedSpecies,
            patientWeightKg: inferredWeight,
        });
        const weightWarning = invalidValidation?.message;
        const pharmacos = weightWarning
            ? {
                ...pharmacosRaw,
                drugs: pharmacosRaw.drugs.map((drug) => ({ ...drug, weight_warning: weightWarning })),
                interaction_warnings: Array.from(new Set([weightWarning, ...pharmacosRaw.interaction_warnings])),
            }
            : pharmacosRaw;
        const structuredDrugPanel = await buildStructuredDrugPanel({
            query: combinedText,
            species,
            weightKg: inferredWeight,
            indication: condition,
        });
        const summary = pharmacos.total_drugs > 0
            ? `VetIOS PharmacOS resolved ${pharmacos.total_drugs} medication candidate${pharmacos.total_drugs === 1 ? '' : 's'} for ${pharmacos.species} ${pharmacos.condition} at ${pharmacos.patient_weight_kg} kg.`
            : `No medication candidates were detected for ${pharmacos.species} ${pharmacos.condition}; name a drug or treatment protocol to resolve a PharmacOS profile.`;

        return NextResponse.json({
            ...pharmacos,
            summary,
            candidateSource: explicitDrugCount > 0 ? 'explicit_response' : pharmacos.total_drugs > 0 ? 'condition_rules' : 'none',
            validation: validation.valid ? { valid: true } : validation,
            structured_drug_cards: structuredDrugPanel?.cards ?? [],
            structured_warnings: structuredDrugPanel?.warnings ?? [],
        });
    } catch (error) {
        const fallbackSpecies = detectSpeciesFromTexts([]);
        const fallback = buildEmptyPharmacOSProtocol({
            species: fallbackSpecies,
            condition: 'Current VetIOS treatment context',
        });
        return NextResponse.json(
            {
                ...fallback,
                summary: 'VetIOS PharmacOS could not complete enrichment for this response. Re-run with explicit species, condition, weight, and drug list.',
                error: error instanceof Error ? error.message : 'Drug formulary enrichment failed',
            },
            { status: 500 },
        );
    }
}

function extractWeightKg(text: string) {
    const explicit = text.match(/\b(?:weight|wt|patient weight|patient_weight_kg)\D{0,24}(\d+(?:\.\d+)?)\s*(?:kg|kilograms?)\b/i);
    const generic = explicit ?? text.match(/\b(\d+(?:\.\d+)?)\s*(?:kg|kilograms?)\b/i);
    if (!generic?.[1]) return null;
    const value = Number(generic[1]);
    return Number.isFinite(value) && value > 0 ? Math.min(value, 2500) : null;
}

async function logValidationEvent(input: {
    species: string;
    weightKg: number;
    validationResult: 'valid' | 'impossible' | 'extreme_outlier';
    message: string | null;
    blocked: boolean;
}) {
    try {
        const supabase = getSupabaseServer();
        await supabase.from('pharmacos_validation_events').insert({
            tenant_id: null,
            session_id: crypto.randomUUID(),
            species: input.species,
            weight_kg: input.weightKg,
            validation_result: input.validationResult,
            message: input.message,
            blocked: input.blocked,
        });
    } catch {
        // Validation logging must never block the patient-safety gate.
    }
}

async function buildStructuredDrugPanel(input: {
    query: string;
    species: string;
    weightKg: number;
    indication: string;
}) {
    try {
        const supabase = getSupabaseServer();
        const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY;
        return await buildPharmacOSReasoningResponse({
            query: input.query,
            species: input.species,
            weight_kg: input.weightKg,
            indication: input.indication,
            max_candidates: Number(process.env.VETIOS_PHARMACOS_MAX_DRUG_CANDIDATES ?? 6),
        }, {
            fetchFormularyRecords: () => loadFormularyRecordsFromSupabase(supabase as never),
            fetchInteractions: () => loadInteractionRecordsFromSupabase(supabase as never),
            generateCommentary: apiKey
                ? (commentaryInput) => generateAnthropicDrugCommentary(commentaryInput, apiKey)
                : undefined,
        });
    } catch {
        return buildPharmacOSReasoningResponse({
            query: input.query,
            species: input.species,
            weight_kg: input.weightKg,
            indication: input.indication,
            max_candidates: Number(process.env.VETIOS_PHARMACOS_MAX_DRUG_CANDIDATES ?? 6),
        });
    }
}
