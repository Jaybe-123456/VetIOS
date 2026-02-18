/**
 * @vetios/testing — Shared Test Fixtures & Generators
 *
 * Provides factory functions for creating test data
 * consistent with the VetIOS database schema.
 */

import type {
    Tenant,
    User,
    Client,
    Patient,
    Encounter,
    ClinicalEvent,
    AIDecisionLog,
    Override,
    Outcome,
    DataGenerationEvent,
    WorkflowSnapshot,
    IntelligenceMetric,
    EdgeSimulation,
} from '@vetios/db';

// ─── ID Generators ───────────────────────────────────────────────────────────

let idCounter = 0;

function generateId(): string {
    idCounter++;
    return `00000000-0000-4000-a000-${String(idCounter).padStart(12, '0')}`;
}

export function resetIdCounter(): void {
    idCounter = 0;
}

// ─── Fixture Factories ───────────────────────────────────────────────────────

export function createTenantFixture(overrides?: Partial<Tenant>): Tenant {
    return {
        id: generateId(),
        name: 'Test Veterinary Clinic',
        settings: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...overrides,
    };
}

export function createUserFixture(tenantId: string, overrides?: Partial<User>): User {
    return {
        id: generateId(),
        tenant_id: tenantId,
        email: `vet-${idCounter}@testclinic.com`,
        role: 'vet',
        display_name: 'Dr. Test',
        created_at: new Date().toISOString(),
        ...overrides,
    };
}

export function createClientFixture(tenantId: string, overrides?: Partial<Client>): Client {
    return {
        id: generateId(),
        tenant_id: tenantId,
        name: 'Test Owner',
        contact: { phone: '+1-555-0100', email: 'owner@test.com' },
        created_at: new Date().toISOString(),
        ...overrides,
    };
}

export function createPatientFixture(
    tenantId: string,
    clientId: string,
    overrides?: Partial<Patient>,
): Patient {
    return {
        id: generateId(),
        tenant_id: tenantId,
        client_id: clientId,
        name: 'Buddy',
        species: 'dog',
        breed: 'Labrador Retriever',
        weight_kg: 30,
        date_of_birth: '2020-03-15',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...overrides,
    };
}

export function createEncounterFixture(
    tenantId: string,
    patientId: string,
    userId: string,
    overrides?: Partial<Encounter>,
): Encounter {
    return {
        id: generateId(),
        tenant_id: tenantId,
        patient_id: patientId,
        user_id: userId,
        status: 'checked_in',
        chief_complaint: 'Vomiting and lethargy for 2 days',
        started_at: new Date().toISOString(),
        ended_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...overrides,
    };
}

export function createClinicalEventFixture(
    tenantId: string,
    encounterId: string,
    userId: string,
    overrides?: Partial<ClinicalEvent>,
): ClinicalEvent {
    return {
        id: generateId(),
        tenant_id: tenantId,
        encounter_id: encounterId,
        event_type: 'vitals_recorded',
        payload: { temperature_f: 102.5, heart_rate: 80, respiratory_rate: 20 },
        created_by: userId,
        created_at: new Date().toISOString(),
        ...overrides,
    };
}

export function createDecisionLogFixture(
    tenantId: string,
    encounterId: string,
    overrides?: Partial<AIDecisionLog>,
): AIDecisionLog {
    return {
        id: generateId(),
        tenant_id: tenantId,
        encounter_id: encounterId,
        trace_id: generateId(),
        model_version: 'gpt-4-turbo-2024-04-09',
        prompt_template_id: 'abc12345',
        context_snapshot: {},
        raw_output: '{"differentials": []}',
        parsed_output: { differentials: [] },
        latency_ms: 1200,
        created_at: new Date().toISOString(),
        ...overrides,
    };
}

export function createOverrideFixture(
    tenantId: string,
    decisionId: string,
    userId: string,
    overrides?: Partial<Override>,
): Override {
    return {
        id: generateId(),
        tenant_id: tenantId,
        decision_id: decisionId,
        user_id: userId,
        action: 'accepted',
        modification: null,
        reason: null,
        created_at: new Date().toISOString(),
        ...overrides,
    };
}

export function createOutcomeFixture(
    tenantId: string,
    encounterId: string,
    userId: string,
    overrides?: Partial<Outcome>,
): Outcome {
    return {
        id: generateId(),
        tenant_id: tenantId,
        encounter_id: encounterId,
        decision_id: null,
        outcome_type: 'recovery',
        result: { status: 'improved', notes: 'Patient responded well to treatment.' },
        recorded_by: userId,
        recorded_at: new Date().toISOString(),
        ...overrides,
    };
}

// ─── Monopoly Vector Fixtures ────────────────────────────────────────────────

export function createDataEventFixture(
    tenantId: string,
    overrides?: Partial<DataGenerationEvent>,
): DataGenerationEvent {
    return {
        id: generateId(),
        tenant_id: tenantId,
        event_category: 'ai_diagnostic_outcome',
        source_encounter_id: null,
        source_decision_id: null,
        data_fingerprint: `fp_${idCounter}_${Date.now().toString(36)}`,
        data_payload: { diagnosis: 'test', confidence: 0.85 },
        compounding_score: 0.75,
        created_at: new Date().toISOString(),
        ...overrides,
    };
}

export function createWorkflowSnapshotFixture(
    tenantId: string,
    encounterId: string,
    userId: string,
    overrides?: Partial<WorkflowSnapshot>,
): WorkflowSnapshot {
    return {
        id: generateId(),
        tenant_id: tenantId,
        workflow_type: 'decision_encoding',
        encounter_id: encounterId,
        triggered_by: userId,
        state_graph: {
            nodes: ['triage', 'vitals', 'diagnosis', 'treatment'],
            edges: [
                { from: 'triage', to: 'vitals' },
                { from: 'vitals', to: 'diagnosis' },
                { from: 'diagnosis', to: 'treatment' },
            ],
        },
        actor_sequence: [
            { actor_type: 'human', actor_id: userId, action: 'triage' },
            { actor_type: 'system', actor_id: 'vitals_device', action: 'record_vitals' },
            { actor_type: 'ai', actor_id: 'diagnosis_agent', action: 'suggest_differential' },
        ],
        decision_points: [
            {
                node_id: 'diagnosis',
                ai_attribution: 0.7,
                human_attribution: 0.3,
                choice: 'pancreatitis',
                alternatives_considered: ['gastritis', 'foreign_body'],
            },
        ],
        replication_cost_score: 4.2,
        snapshot_version: 1,
        created_at: new Date().toISOString(),
        ...overrides,
    };
}

export function createIntelligenceMetricFixture(
    tenantId: string,
    overrides?: Partial<IntelligenceMetric>,
): IntelligenceMetric {
    return {
        id: generateId(),
        tenant_id: tenantId,
        metric_type: 'decision_quality',
        decision_id: null,
        encounter_id: null,
        score: 0.78,
        feedback_signal: {
            learning_direction: 'reinforce',
            was_overridden: false,
        },
        window_start: null,
        window_end: null,
        intelligence_sharing_opted_in: false,
        model_version: 'gpt-4-turbo-2024-04-09',
        created_at: new Date().toISOString(),
        ...overrides,
    };
}

export function createEdgeSimulationFixture(
    tenantId: string,
    overrides?: Partial<EdgeSimulation>,
): EdgeSimulation {
    return {
        id: generateId(),
        tenant_id: tenantId,
        simulation_type: 'adversarial_scenario',
        scenario_config: {
            species: 'cat',
            drug: 'ibuprofen',
            weight_kg: 4.5,
        },
        scenario_name: 'Contraindicated NSAID for feline',
        expected_outcome: { constraints_satisfied: false },
        actual_outcome: null,
        failure_mode: null,
        safety_score: null,
        model_version: null,
        pipeline_trace_id: null,
        pipeline_decision_id: null,
        status: 'pending',
        started_at: null,
        completed_at: null,
        created_at: new Date().toISOString(),
        ...overrides,
    };
}
