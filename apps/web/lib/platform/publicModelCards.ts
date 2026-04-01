import { getModelRegistryControlPlaneSnapshot } from '@/lib/experiments/service';
import { createSupabaseExperimentTrackingStore } from '@/lib/experiments/supabaseStore';
import type { GateStatus, ModelFamily, ModelRegistryControlPlaneEntry } from '@/lib/experiments/types';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { resolvePublicCatalogTenant, type PublicCatalogSource } from '@/lib/platform/publicTenant';

export interface PublicModelCard {
    registry_id: string;
    model_family: ModelFamily;
    model_name: string;
    model_version: string;
    registry_role: string;
    lifecycle_status: string;
    is_active_route: boolean;
    deployment_decision: string;
    promotion_eligibility: boolean;
    promotion_blockers: string[];
    gates: {
        calibration: GateStatus;
        adversarial: GateStatus;
        safety: GateStatus;
        benchmark: GateStatus;
        manual_approval: GateStatus;
    };
    clinical_scorecard: {
        global_accuracy: number | null;
        macro_f1: number | null;
        critical_recall: number | null;
        false_reassurance_rate: number | null;
        fn_critical_rate: number | null;
        ece: number | null;
        latency_p99: number | null;
    };
    dataset_version: string | null;
    feature_schema_version: string | null;
    label_policy_version: string | null;
    updated_at: string;
}

export interface PublicModelCardFamily {
    model_family: ModelFamily;
    active_model_version: string | null;
    last_stable_model_version: string | null;
    cards: PublicModelCard[];
}

export interface PublicModelCardsCatalog {
    configured: boolean;
    source: PublicCatalogSource;
    tenant_id: string | null;
    refreshed_at: string | null;
    families: PublicModelCardFamily[];
}

export async function getPublicModelCardsCatalog(): Promise<PublicModelCardsCatalog> {
    const target = await resolvePublicCatalogTenant();
    if (!target.tenantId) {
        return {
            configured: false,
            source: target.source,
            tenant_id: null,
            refreshed_at: null,
            families: [],
        };
    }

    const snapshot = await getModelRegistryControlPlaneSnapshot(
        createSupabaseExperimentTrackingStore(getSupabaseServer()),
        target.tenantId,
        { readOnly: true },
    );

    return {
        configured: true,
        source: target.source,
        tenant_id: snapshot.tenant_id,
        refreshed_at: snapshot.refreshed_at,
        families: snapshot.families.map((family) => ({
            model_family: family.model_family,
            active_model_version: family.active_model?.model_version ?? null,
            last_stable_model_version: family.last_stable_model?.model_version ?? null,
            cards: selectPublicEntries(family.entries).map(mapPublicCard),
        })),
    };
}

function selectPublicEntries(entries: ModelRegistryControlPlaneEntry[]): ModelRegistryControlPlaneEntry[] {
    const ranked = [...entries].sort((left, right) => {
        return rankPublicEntry(right) - rankPublicEntry(left)
            || Date.parse(right.registry.updated_at) - Date.parse(left.registry.updated_at);
    });

    const selected: ModelRegistryControlPlaneEntry[] = [];
    const seen = new Set<string>();
    for (const entry of ranked) {
        if (seen.has(entry.registry.registry_id)) {
            continue;
        }

        selected.push(entry);
        seen.add(entry.registry.registry_id);
        if (selected.length >= 3) {
            break;
        }
    }

    return selected;
}

function rankPublicEntry(entry: ModelRegistryControlPlaneEntry): number {
    let score = 0;
    if (entry.is_active_route) score += 100;
    if (entry.registry.registry_role === 'champion') score += 80;
    if (entry.registry.lifecycle_status === 'production') score += 70;
    if (entry.registry.lifecycle_status === 'staging') score += 50;
    if (entry.registry.registry_role === 'candidate') score += 30;
    if (entry.decision_panel.deployment_decision === 'approved') score += 10;
    return score;
}

function mapPublicCard(entry: ModelRegistryControlPlaneEntry): PublicModelCard {
    return {
        registry_id: entry.registry.registry_id,
        model_family: entry.registry.model_family,
        model_name: entry.registry.model_name,
        model_version: entry.registry.model_version,
        registry_role: entry.registry.registry_role,
        lifecycle_status: entry.registry.lifecycle_status,
        is_active_route: entry.is_active_route,
        deployment_decision: entry.decision_panel.deployment_decision,
        promotion_eligibility: entry.decision_panel.promotion_eligibility,
        promotion_blockers: entry.decision_panel.reasons,
        gates: entry.promotion_gating.gates,
        clinical_scorecard: {
            global_accuracy: entry.clinical_scorecard.global_accuracy,
            macro_f1: entry.clinical_scorecard.macro_f1,
            critical_recall: entry.clinical_scorecard.critical_recall,
            false_reassurance_rate: entry.clinical_scorecard.false_reassurance_rate,
            fn_critical_rate: entry.clinical_scorecard.fn_critical_rate,
            ece: entry.clinical_scorecard.ece,
            latency_p99: entry.clinical_scorecard.latency_p99,
        },
        dataset_version: entry.registry.dataset_version,
        feature_schema_version: entry.registry.feature_schema_version,
        label_policy_version: entry.registry.label_policy_version,
        updated_at: entry.registry.updated_at,
    };
}
