import { NextResponse } from 'next/server';
import { QIVSClient, type PharmacophoreInput, type QIVSResponse } from '@vetios/quantum';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PharmacophoreSchema = z.object({
    id: z.string().min(1).max(64),
    type: z.enum(['HA', 'HD', 'NC', 'AR']),
    position: z.tuple([z.number(), z.number(), z.number()]),
    is_protein: z.boolean(),
});

const QIVSSubmitSchema = z.object({
    drug_smiles: z.string().min(1).max(4096),
    drug_name: z.string().min(1).max(256).optional(),
    pathogen_label: z.string().min(1).max(128),
    tau_flexibility: z.number().positive().max(10).optional(),
    epsilon_interaction: z.number().positive().max(10).optional(),
    pharmacophores: z.object({
        receptor: z.array(PharmacophoreSchema).min(1).max(64),
        ligand: z.array(PharmacophoreSchema).min(1).max(64),
    }).optional(),
});

export async function POST(req: Request) {
    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['inference:write'],
    });

    if (auth.error || !auth.actor) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = QIVSSubmitSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json(
            { error: 'invalid_input', detail: parsed.error.flatten() },
            { status: 400 },
        );
    }

    const pathogenLabel = normalizeLabel(parsed.data.pathogen_label);
    const { data: pathogen, error: pathogenError } = await supabase
        .from('vet_target_pathogens')
        .select('label, species')
        .eq('label', pathogenLabel)
        .maybeSingle();

    if (pathogenError) {
        return NextResponse.json({ error: 'pathogen_lookup_failed' }, { status: 503 });
    }

    if (!pathogen) {
        return NextResponse.json(
            { error: 'unknown_pathogen', pathogen_label: pathogenLabel },
            { status: 400 },
        );
    }

    const quantumUrl = process.env.QUANTUM_SERVICE_URL;
    if (!quantumUrl) {
        return NextResponse.json({ error: 'quantum_service_unconfigured' }, { status: 503 });
    }

    const qivsClient = new QIVSClient(quantumUrl, quantumTimeoutMs());
    if (!(await qivsClient.isAvailable())) {
        return NextResponse.json(
            {
                error: 'quantum_service_unavailable',
                message: 'Quantum screening service is offline. Try again shortly.',
            },
            { status: 503, headers: { 'Retry-After': '30' } },
        );
    }

    let result: QIVSResponse;
    try {
        result = await qivsClient.screenDrug({
            drug_smiles: parsed.data.drug_smiles,
            pathogen_label: pathogenLabel,
            tau_flexibility: parsed.data.tau_flexibility ?? 1.5,
            epsilon_interaction: parsed.data.epsilon_interaction ?? 0.5,
            n_samples: quantumSamples(),
            n_iterations: quantumIterations(),
            pharmacophores: parsed.data.pharmacophores as {
                receptor: PharmacophoreInput[];
                ligand: PharmacophoreInput[];
            } | undefined,
        });
    } catch (error) {
        console.log(JSON.stringify({
            event: 'qivs_screening_failed',
            pathogen_label: pathogenLabel,
            error: error instanceof Error ? error.message : 'unknown',
            timestamp: new Date().toISOString(),
        }));
        return NextResponse.json(
            {
                error: 'screening_failed',
                message: 'Quantum screening failed. Classical docking fallback recommended.',
            },
            { status: 503 },
        );
    }

    const { data: event, error: dbError } = await supabase
        .from('qivs_screening_events')
        .insert({
            tenant_id: auth.actor.tenantId,
            drug_smiles_hash: result.drug_smiles_hash,
            drug_name: parsed.data.drug_name ?? null,
            pathogen_label: result.pathogen_label,
            pathogen_species: String(pathogen.species),
            big_node_count: result.big_node_count,
            big_edge_count: result.big_edge_count,
            tau_flexibility: result.tau_flexibility,
            epsilon_interaction: result.epsilon_interaction,
            max_clique_nodes: result.max_clique_nodes,
            max_clique_weight: result.max_clique_weight,
            binding_pose: result.binding_pose,
            gbs_samples_used: result.gbs_samples_used,
            gbs_backend: result.gbs_backend,
            classical_max_weight: result.classical_max_weight,
            quantum_advantage: result.quantum_advantage,
            confidence_score: result.confidence_score,
            algorithm_version: result.algorithm_version,
            paper_doi: result.paper_doi,
        })
        .select('id')
        .single();

    if (dbError) {
        console.log(JSON.stringify({
            event: 'qivs_storage_failed',
            error: dbError.message,
            timestamp: new Date().toISOString(),
        }));
        return NextResponse.json({ ...result, stored: false, error: null });
    }

    return NextResponse.json({
        ...result,
        qivs_event_id: event.id,
        stored: true,
        error: null,
    });
}

function normalizeLabel(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function quantumTimeoutMs(): number {
    const parsed = Number(process.env.QUANTUM_SERVICE_TIMEOUT_MS);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 45_000;
}

function quantumSamples(): number {
    const parsed = Number(process.env.QUANTUM_GBS_SAMPLES);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 20;
}

function quantumIterations(): number {
    const parsed = Number(process.env.QUANTUM_GBS_ITERATIONS);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 5;
}
