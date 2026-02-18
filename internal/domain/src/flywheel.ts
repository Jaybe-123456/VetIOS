/**
 * @vetios/domain — Data Flywheel
 *
 * Captures every unique data generation event the system produces.
 * This is the engine behind VetIOS's data moat: longitudinal records,
 * AI-diagnostic outcomes, failure maps, multi-clinic embeddings,
 * and intervention logs — data that compounds defensibility daily.
 *
 * Every inference, every encounter, every override feeds the flywheel.
 * Competitors cannot replicate time-compounded proprietary data.
 */

import type { TypedSupabaseClient } from '@vetios/db';
import type { DataGenerationEvent, DataEventCategory, Json } from '@vetios/db';
import { createLogger } from '@vetios/logger';

const logger = createLogger({ module: 'domain.flywheel' });

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CaptureDataEventInput {
    tenant_id: string;
    event_category: DataEventCategory;
    source_encounter_id?: string;
    source_decision_id?: string;
    data_payload: Json;
}

export interface FlywheelMetrics {
    /** Total data events captured */
    total_events: number;
    /** Number of unique data fingerprints */
    unique_fingerprints: number;
    /** Uniqueness ratio (unique / total) — higher = more diverse data */
    uniqueness_ratio: number;
    /** Average compounding score across all events */
    avg_compounding_score: number;
    /** Breakdown by event category */
    category_counts: Record<DataEventCategory, number>;
    /** Data velocity: events per day in the last 30 days */
    daily_velocity: number;
}

// ─── Data Fingerprinting ─────────────────────────────────────────────────────

/**
 * Generates a content-addressable fingerprint for a data payload.
 * Used to prove uniqueness — identical data produces identical fingerprints,
 * ensuring we only count truly new data events.
 */
function generateDataFingerprint(
    category: DataEventCategory,
    payload: Json,
    encounterId?: string,
): string {
    const canonical = JSON.stringify({
        c: category,
        e: encounterId ?? '',
        p: payload,
    });

    // FNV-1a hash — fast, deterministic, good distribution
    let hash = 0x811c9dc5;
    for (let i = 0; i < canonical.length; i++) {
        hash ^= canonical.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

// ─── Compounding Score ───────────────────────────────────────────────────────

/**
 * Computes a compounding score for a data event.
 *
 * The score estimates how much this event increases the moat:
 * - Higher for rarer event categories (failure_mapping > longitudinal_record)
 * - Higher for events with AI decision provenance (closed-loop data)
 * - Higher for events from encounters with more clinical events (richer context)
 *
 * This is a heuristic, not a precise metric — the point is to track
 * moat growth directionally.
 */
function computeCompoundingScore(
    category: DataEventCategory,
    hasDecisionLink: boolean,
    payloadComplexity: number,
): number {
    // Category rarity weights — rarer categories are harder to replicate
    const categoryWeights: Record<DataEventCategory, number> = {
        longitudinal_record: 0.6,
        ai_diagnostic_outcome: 0.8,
        failure_mapping: 1.0,
        multi_clinic_embedding: 0.9,
        intervention_log: 0.75,
    };

    let score = categoryWeights[category] ?? 0.5;

    // AI-linked data is more valuable (closed-loop generates proprietary patterns)
    if (hasDecisionLink) {
        score *= 1.3;
    }

    // More complex payloads carry more signal
    const complexityBonus = Math.min(payloadComplexity / 100, 0.5);
    score += complexityBonus;

    // Cap at 2.0
    return Math.min(score, 2.0);
}

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Captures a data generation event into the flywheel.
 *
 * This is the primary data moat function — called after every meaningful
 * system operation (inference, encounter transition, override, outcome).
 * Data events with duplicate fingerprints are silently deduplicated.
 */
export async function captureDataEvent(
    client: TypedSupabaseClient,
    input: CaptureDataEventInput,
): Promise<DataGenerationEvent | null> {
    const fingerprint = generateDataFingerprint(
        input.event_category,
        input.data_payload,
        input.source_encounter_id,
    );

    const payloadComplexity = JSON.stringify(input.data_payload).length;
    const compoundingScore = computeCompoundingScore(
        input.event_category,
        !!input.source_decision_id,
        payloadComplexity,
    );

    const { data, error } = await client
        .from('data_generation_events')
        .insert({
            tenant_id: input.tenant_id,
            event_category: input.event_category,
            source_encounter_id: input.source_encounter_id ?? null,
            source_decision_id: input.source_decision_id ?? null,
            data_fingerprint: fingerprint,
            data_payload: input.data_payload,
            compounding_score: compoundingScore,
        })
        .select()
        .single();

    if (error) {
        // Unique constraint violation on fingerprint = duplicate data, not an error
        if (error.code === '23505') {
            logger.debug('Duplicate data event skipped', {
                fingerprint,
                category: input.event_category,
            });
            return null;
        }

        logger.error('Failed to capture data event', { error, input });
        throw new Error(`Failed to capture data event: ${error.message}`);
    }

    const result = data as DataGenerationEvent;
    logger.info('Data event captured', {
        event_id: result.id,
        category: result.event_category,
        fingerprint,
        compounding_score: compoundingScore,
    });

    return result;
}

/**
 * Returns aggregate flywheel metrics for a tenant.
 *
 * These metrics are the moat health dashboard — they tell you:
 * - How much unique data have we generated?
 * - How fast is data compounding?
 * - Which categories are producing the most value?
 */
export async function getFlywheelMetrics(
    client: TypedSupabaseClient,
    tenantId: string,
): Promise<FlywheelMetrics> {
    // Total events and unique fingerprints
    const { count: totalEvents } = await client
        .from('data_generation_events')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId);

    // Category breakdown
    const { data: categoryData } = await client
        .from('data_generation_events')
        .select('event_category, compounding_score')
        .eq('tenant_id', tenantId);

    const events = (categoryData ?? []) as Array<{
        event_category: DataEventCategory;
        compounding_score: number;
    }>;

    const categoryCounts = {} as Record<DataEventCategory, number>;
    let totalCompounding = 0;

    for (const event of events) {
        categoryCounts[event.event_category] =
            (categoryCounts[event.event_category] ?? 0) + 1;
        totalCompounding += event.compounding_score;
    }

    const total = totalEvents ?? 0;

    // Estimate uniqueness ratio (fingerprint-based dedup means stored = unique)
    const uniqueFingerprints = total;
    const uniquenessRatio = total > 0 ? 1.0 : 0;

    // Daily velocity: events in last 30 days / 30
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { count: recentCount } = await client
        .from('data_generation_events')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .gte('created_at', thirtyDaysAgo.toISOString());

    const dailyVelocity = (recentCount ?? 0) / 30;

    return {
        total_events: total,
        unique_fingerprints: uniqueFingerprints,
        uniqueness_ratio: uniquenessRatio,
        avg_compounding_score: total > 0 ? totalCompounding / total : 0,
        category_counts: categoryCounts,
        daily_velocity: dailyVelocity,
    };
}
