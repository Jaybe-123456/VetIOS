import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAiProviderApiKey, getAiProviderBaseUrl } from '../../../../lib/ai/config';
import { detectSpeciesFromTexts } from '@/lib/askVetios/context';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { safeJson } from '@/lib/http/safeJson';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const maxDuration = 30;

const RequestSchema = z.object({
    messageContent: z.string().trim().min(1).max(12000),
    conversation: z.array(z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(4000),
    })).max(12).default([]),
});

interface StoredCaseVector {
    id: string;
    inference_event_id: string | null;
    species: string;
    symptoms: string[];
    diagnosis: string | null;
    outcome_confirmed: boolean;
    similarity: number;
}

async function embedQuery(text: string) {
    const response = await fetch(`${getAiProviderBaseUrl()}/embeddings`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${getAiProviderApiKey()}`,
        },
        body: JSON.stringify({
            model: 'text-embedding-3-large',
            input: text,
            dimensions: 1536,
        }),
    });

    if (!response.ok) {
        throw new Error(`Embedding request failed: ${response.status}`);
    }

    const data = (await response.json()) as {
        data: Array<{ embedding: number[] }>;
    };
    return data.data[0]?.embedding ?? [];
}

function buildRetrievalSummary(cases: StoredCaseVector[], species: string) {
    if (cases.length === 0) {
        return `No similar ${species} cases were retrieved from the VetIOS network.`;
    }

    const confirmed = cases.filter((item) => item.outcome_confirmed).length;
    const averageSimilarity = cases.reduce((sum, item) => sum + item.similarity, 0) / cases.length;
    return `Retrieved ${cases.length} similar ${species} cases from the VetIOS network (${confirmed} outcome-confirmed). Average similarity ${Math.round(averageSimilarity * 100)}%.`;
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000, maxBodySize: 64 * 1024 });
    if (guard.blocked) return guard.response!;

    try {
        const supabase = getSupabaseServer();
        const auth = await resolveClinicalApiActor(req, {
            client: supabase,
            requiredScopes: ['rag:read'],
        });
        if (auth.error || !auth.actor) {
            return NextResponse.json(
                { error: auth.error?.message ?? 'Unauthorized', request_id: guard.requestId },
                { status: auth.error?.status ?? 401 },
            );
        }

        const json = await safeJson(req);
        const parsed = RequestSchema.safeParse(json.ok ? json.data : null);
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 });
        }

        const combinedText = [
            ...parsed.data.conversation.slice(-6).map((item) => `${item.role}: ${item.content}`),
            `assistant_summary: ${parsed.data.messageContent}`,
        ].join('\n');
        const species = detectSpeciesFromTexts([combinedText], 'canine');
        const embedding = await embedQuery(combinedText);

        if (embedding.length === 0) {
            return NextResponse.json({ species, retrievalSummary: `No similar ${species} cases were retrieved from the VetIOS network.`, cases: [] });
        }

        const { data, error } = await supabase.rpc('match_tenant_vet_case_vectors', {
            query_embedding: `[${embedding.join(',')}]`,
            filter_tenant: auth.actor.tenantId,
            match_threshold: 0.72,
            match_count: 5,
            filter_species: species,
            confirmed_only: false,
        });

        if (error) {
            throw new Error(error.message);
        }

        const cases = ((data ?? []) as StoredCaseVector[]).map((item) => ({
            caseId: item.id,
            inferenceEventId: item.inference_event_id,
            species: item.species,
            presentingSigns: item.symptoms ?? [],
            finalDiagnosis: item.diagnosis ?? 'Unconfirmed diagnosis',
            outcome: item.outcome_confirmed ? 'Outcome confirmed in network record' : 'Outcome not yet confirmed',
            similarity: item.similarity,
            clinicalSummary: (item.symptoms ?? []).length > 0
                ? `Presenting signs: ${(item.symptoms ?? []).slice(0, 5).join(', ')}.`
                : 'Historical case summary available without structured presenting signs.',
        }));

        return NextResponse.json({
            species,
            tenant_id: auth.actor.tenantId,
            retrievalSummary: buildRetrievalSummary(data as StoredCaseVector[] ?? [], species),
            cases,
        });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Similar-case retrieval failed' },
            { status: 500 },
        );
    }
}
