/**
 * Error Clustering Engine
 * 
 * Analyzes mismatched predictions vs actual outcomes, generates a deterministic
 * "cluster signature", and increments its frequency in the `error_clusters` table.
 * This is the intelligence layer for debugging systematic model failures.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ERROR_CLUSTERS } from '@/lib/db/schemaContracts';

export interface ErrorClusterResult {
    cluster_signature: string;
    frequency: number;
}

/**
 * Generates a human-readable but deterministic signature for a failure geometry.
 */
export function generateClusterSignature(
    predictedClass: string | undefined,
    actualClass: string | undefined,
    severityErrorDelta: number,
    hadContradictions: boolean
): string {
    const pClass = predictedClass || 'UNKNOWN';
    const aClass = actualClass || 'UNKNOWN';
    
    let sevFlag = '';
    if (severityErrorDelta > 0.4) sevFlag = ' | Severe Underestimation';
    if (severityErrorDelta < -0.4) sevFlag = ' | Severe Overestimation';

    const contraFlag = hadContradictions ? ' | Ignored Contradictions' : '';

    return `${aClass} misclassified as ${pClass}${sevFlag}${contraFlag}`;
}

export async function logErrorCluster(
    client: SupabaseClient,
    params: {
        tenant_id: string;
        predicted_class?: string;
        actual_class?: string;
        predicted_severity?: number;
        actual_severity?: number;
        had_contradictions: boolean;
    }
): Promise<ErrorClusterResult | null> {
    // Determine if an actual error occurred
    if (params.predicted_class === params.actual_class && 
        Math.abs((params.predicted_severity ?? 0) - (params.actual_severity ?? 0)) < 0.2) {
        return null; // No significant error
    }

    const severityErrorDelta = (params.actual_severity ?? 0) - (params.predicted_severity ?? 0);
    
    const signature = generateClusterSignature(
        params.predicted_class, 
        params.actual_class, 
        severityErrorDelta, 
        params.had_contradictions
    );

    const C = ERROR_CLUSTERS.COLUMNS;

    // Upsert the cluster based on tenant_id + cluster_signature
    const { data, error } = await client
        .rpc('upsert_error_cluster', {
            p_tenant_id: params.tenant_id,
            p_cluster_signature: signature,
            p_misclassification_type: `${params.actual_class}->${params.predicted_class}`,
            p_severity_error: severityErrorDelta,
            p_contradiction_presence: params.had_contradictions
        });

    // If RPC doesn't exist, fallback to standard upsert
    if (error) {
        console.warn('RPC upsert_error_cluster failed. Attempting standard upsert fallback.', error.message);
        
        // Standard Upsert
        const { data: upsertData, error: upsertErr } = await client
            .from(ERROR_CLUSTERS.TABLE)
            .upsert({
                [C.tenant_id]: params.tenant_id,
                [C.cluster_signature]: signature,
                [C.misclassification_type]: `${params.actual_class}->${params.predicted_class}`,
                [C.severity_error]: severityErrorDelta,
                [C.contradiction_presence]: params.had_contradictions,
                // On conflict this would normally increment frequency. 
                // Using Supabase JS standard upsert with unique index:
            }, { onConflict: 'tenant_id, cluster_signature' })
            .select('cluster_signature, frequency')
            .single();
            
        if (upsertErr || !upsertData) {
            console.error('[logErrorCluster] Failed to log error cluster:', upsertErr);
            return null;
        }
        return {
            cluster_signature: upsertData.cluster_signature as string,
            frequency: upsertData.frequency as number
        };
    }

    // if RPC succeeded, expect it to return the row
    if (data && typeof data === 'object' && 'frequency' in data) {
        return {
             cluster_signature: signature,
             frequency: data.frequency as number
        };
    }
    
    return null;
}
