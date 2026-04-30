import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
    buildEmptyPharmacOSProtocol,
    buildPharmacOSProtocol,
    extractDrugNames,
} from '@/lib/pharmacos/vetiosPharmacos';
import {
    compactSearchTerms,
    detectSpeciesFromTexts,
} from '@/lib/askVetios/context';

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
        const explicitDrugCount = extractDrugNames(combinedText).length;
        const pharmacos = await buildPharmacOSProtocol({
            topic,
            messageContent,
            queryText,
            selectedSpecies,
            patientWeightKg,
        });
        const summary = pharmacos.total_drugs > 0
            ? `VetIOS PharmacOS resolved ${pharmacos.total_drugs} medication candidate${pharmacos.total_drugs === 1 ? '' : 's'} for ${pharmacos.species} ${pharmacos.condition} at ${pharmacos.patient_weight_kg} kg.`
            : `No medication candidates were detected for ${pharmacos.species} ${pharmacos.condition}; name a drug or treatment protocol to resolve a PharmacOS profile.`;

        return NextResponse.json({
            ...pharmacos,
            summary,
            candidateSource: explicitDrugCount > 0 ? 'explicit_response' : pharmacos.total_drugs > 0 ? 'condition_rules' : 'none',
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
