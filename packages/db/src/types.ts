/**
 * @vetios/db — Database types
 *
 * TypeScript type definitions mirroring the PostgreSQL schema.
 * These types are the single source of truth for entity shapes across the platform.
 *
 * The Database interface uses fully inlined types (matching supabase CLI output)
 * to ensure correct generic inference with supabase-js v2 / postgrest-js.
 */

// ─── JSON Type (matches Supabase's built-in Json) ────────────────────────────

export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[];

// ─── Enums ───────────────────────────────────────────────────────────────────

export type UserRole = 'vet' | 'tech' | 'admin';

export type EncounterStatus = 'checked_in' | 'in_progress' | 'diagnosed' | 'discharged';

export type ClinicalEventType =
    | 'vitals_recorded'
    | 'symptom_noted'
    | 'diagnosis_suggested'
    | 'treatment_planned'
    | 'prescription_ordered'
    | 'note_added'
    | 'ai_suggestion'
    | 'lab_result_received';

export type OverrideAction = 'accepted' | 'rejected' | 'modified';

export type DataEventCategory =
    | 'longitudinal_record'
    | 'ai_diagnostic_outcome'
    | 'failure_mapping'
    | 'multi_clinic_embedding'
    | 'intervention_log';

export type WorkflowType =
    | 'decision_encoding'
    | 'protocol_execution'
    | 'triage_routing'
    | 'treatment_pathway';

export type IntelligenceMetricType =
    | 'prediction_accuracy'
    | 'decision_quality'
    | 'override_rate'
    | 'outcome_correlation'
    | 'model_drift';

export type SimulationType =
    | 'adversarial_scenario'
    | 'boundary_probe'
    | 'intervention_test'
    | 'model_stress_test';

export type SimulationStatus = 'pending' | 'running' | 'passed' | 'failed' | 'error';

// ─── Database Schema (Supabase-compatible shape) ─────────────────────────────

export interface Database {
    public: {
        Tables: {
            tenants: {
                Row: {
                    id: string;
                    name: string;
                    settings: Json;
                    created_at: string;
                    updated_at: string;
                };
                Insert: {
                    id?: string;
                    name: string;
                    settings?: Json;
                    created_at?: string;
                    updated_at?: string;
                };
                Update: {
                    id?: string;
                    name?: string;
                    settings?: Json;
                    created_at?: string;
                    updated_at?: string;
                };
                Relationships: [];
            };
            users: {
                Row: {
                    id: string;
                    tenant_id: string;
                    email: string;
                    role: UserRole;
                    display_name: string;
                    created_at: string;
                };
                Insert: {
                    id?: string;
                    tenant_id: string;
                    email: string;
                    role: UserRole;
                    display_name: string;
                    created_at?: string;
                };
                Update: {
                    id?: string;
                    tenant_id?: string;
                    email?: string;
                    role?: UserRole;
                    display_name?: string;
                    created_at?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "users_tenant_id_fkey";
                        columns: ["tenant_id"];
                        referencedRelation: "tenants";
                        referencedColumns: ["id"];
                    }
                ];
            };
            clients: {
                Row: {
                    id: string;
                    tenant_id: string;
                    name: string;
                    contact: Json;
                    created_at: string;
                };
                Insert: {
                    id?: string;
                    tenant_id: string;
                    name: string;
                    contact?: Json;
                    created_at?: string;
                };
                Update: {
                    id?: string;
                    tenant_id?: string;
                    name?: string;
                    contact?: Json;
                    created_at?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "clients_tenant_id_fkey";
                        columns: ["tenant_id"];
                        referencedRelation: "tenants";
                        referencedColumns: ["id"];
                    }
                ];
            };
            patients: {
                Row: {
                    id: string;
                    tenant_id: string;
                    client_id: string;
                    name: string;
                    species: string;
                    breed: string | null;
                    weight_kg: number | null;
                    date_of_birth: string | null;
                    created_at: string;
                    updated_at: string;
                };
                Insert: {
                    id?: string;
                    tenant_id: string;
                    client_id: string;
                    name: string;
                    species: string;
                    breed?: string | null;
                    weight_kg?: number | null;
                    date_of_birth?: string | null;
                    created_at?: string;
                    updated_at?: string;
                };
                Update: {
                    id?: string;
                    tenant_id?: string;
                    client_id?: string;
                    name?: string;
                    species?: string;
                    breed?: string | null;
                    weight_kg?: number | null;
                    date_of_birth?: string | null;
                    created_at?: string;
                    updated_at?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "patients_tenant_id_fkey";
                        columns: ["tenant_id"];
                        referencedRelation: "tenants";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "patients_client_id_fkey";
                        columns: ["client_id"];
                        referencedRelation: "clients";
                        referencedColumns: ["id"];
                    }
                ];
            };
            encounters: {
                Row: {
                    id: string;
                    tenant_id: string;
                    patient_id: string;
                    user_id: string;
                    status: EncounterStatus;
                    chief_complaint: string | null;
                    started_at: string;
                    ended_at: string | null;
                    created_at: string;
                    updated_at: string;
                };
                Insert: {
                    id?: string;
                    tenant_id: string;
                    patient_id: string;
                    user_id: string;
                    status: EncounterStatus;
                    chief_complaint?: string | null;
                    started_at: string;
                    ended_at?: string | null;
                    created_at?: string;
                    updated_at?: string;
                };
                Update: {
                    id?: string;
                    tenant_id?: string;
                    patient_id?: string;
                    user_id?: string;
                    status?: EncounterStatus;
                    chief_complaint?: string | null;
                    started_at?: string;
                    ended_at?: string | null;
                    created_at?: string;
                    updated_at?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "encounters_tenant_id_fkey";
                        columns: ["tenant_id"];
                        referencedRelation: "tenants";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "encounters_patient_id_fkey";
                        columns: ["patient_id"];
                        referencedRelation: "patients";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "encounters_user_id_fkey";
                        columns: ["user_id"];
                        referencedRelation: "users";
                        referencedColumns: ["id"];
                    }
                ];
            };
            clinical_events: {
                Row: {
                    id: string;
                    tenant_id: string;
                    encounter_id: string;
                    event_type: ClinicalEventType;
                    payload: Json;
                    created_by: string;
                    created_at: string;
                };
                Insert: {
                    id?: string;
                    tenant_id: string;
                    encounter_id: string;
                    event_type: ClinicalEventType;
                    payload: Json;
                    created_by: string;
                    created_at?: string;
                };
                Update: {
                    id?: string;
                    tenant_id?: string;
                    encounter_id?: string;
                    event_type?: ClinicalEventType;
                    payload?: Json;
                    created_by?: string;
                    created_at?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "clinical_events_tenant_id_fkey";
                        columns: ["tenant_id"];
                        referencedRelation: "tenants";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "clinical_events_encounter_id_fkey";
                        columns: ["encounter_id"];
                        referencedRelation: "encounters";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "clinical_events_created_by_fkey";
                        columns: ["created_by"];
                        referencedRelation: "users";
                        referencedColumns: ["id"];
                    }
                ];
            };
            ai_decision_logs: {
                Row: {
                    id: string;
                    tenant_id: string;
                    encounter_id: string;
                    trace_id: string;
                    model_version: string;
                    prompt_template_id: string;
                    context_snapshot: Json;
                    raw_output: string;
                    parsed_output: Json;
                    latency_ms: number;
                    created_at: string;
                };
                Insert: {
                    id?: string;
                    tenant_id: string;
                    encounter_id: string;
                    trace_id: string;
                    model_version: string;
                    prompt_template_id: string;
                    context_snapshot: Json;
                    raw_output: string;
                    parsed_output: Json;
                    latency_ms: number;
                    created_at?: string;
                };
                Update: {
                    id?: string;
                    tenant_id?: string;
                    encounter_id?: string;
                    trace_id?: string;
                    model_version?: string;
                    prompt_template_id?: string;
                    context_snapshot?: Json;
                    raw_output?: string;
                    parsed_output?: Json;
                    latency_ms?: number;
                    created_at?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "ai_decision_logs_tenant_id_fkey";
                        columns: ["tenant_id"];
                        referencedRelation: "tenants";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "ai_decision_logs_encounter_id_fkey";
                        columns: ["encounter_id"];
                        referencedRelation: "encounters";
                        referencedColumns: ["id"];
                    }
                ];
            };
            overrides: {
                Row: {
                    id: string;
                    tenant_id: string;
                    decision_id: string;
                    user_id: string;
                    action: OverrideAction;
                    modification: Json | null;
                    reason: string | null;
                    created_at: string;
                };
                Insert: {
                    id?: string;
                    tenant_id: string;
                    decision_id: string;
                    user_id: string;
                    action: OverrideAction;
                    modification?: Json | null;
                    reason?: string | null;
                    created_at?: string;
                };
                Update: {
                    id?: string;
                    tenant_id?: string;
                    decision_id?: string;
                    user_id?: string;
                    action?: OverrideAction;
                    modification?: Json | null;
                    reason?: string | null;
                    created_at?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "overrides_tenant_id_fkey";
                        columns: ["tenant_id"];
                        referencedRelation: "tenants";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "overrides_decision_id_fkey";
                        columns: ["decision_id"];
                        referencedRelation: "ai_decision_logs";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "overrides_user_id_fkey";
                        columns: ["user_id"];
                        referencedRelation: "users";
                        referencedColumns: ["id"];
                    }
                ];
            };
            outcomes: {
                Row: {
                    id: string;
                    tenant_id: string;
                    encounter_id: string;
                    decision_id: string | null;
                    outcome_type: string;
                    result: Json;
                    recorded_by: string;
                    recorded_at: string;
                };
                Insert: {
                    id?: string;
                    tenant_id: string;
                    encounter_id: string;
                    decision_id?: string | null;
                    outcome_type: string;
                    result: Json;
                    recorded_by: string;
                    recorded_at?: string;
                };
                Update: {
                    id?: string;
                    tenant_id?: string;
                    encounter_id?: string;
                    decision_id?: string | null;
                    outcome_type?: string;
                    result?: Json;
                    recorded_by?: string;
                    recorded_at?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "outcomes_tenant_id_fkey";
                        columns: ["tenant_id"];
                        referencedRelation: "tenants";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "outcomes_encounter_id_fkey";
                        columns: ["encounter_id"];
                        referencedRelation: "encounters";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "outcomes_decision_id_fkey";
                        columns: ["decision_id"];
                        referencedRelation: "ai_decision_logs";
                        referencedColumns: ["id"];
                    }
                ];
            };
            knowledge_vectors: {
                Row: {
                    id: string;
                    tenant_id: string | null;
                    content_type: string;
                    content_hash: string;
                    content: string;
                    embedding: number[];
                    metadata: Json;
                    created_at: string;
                };
                Insert: {
                    id?: string;
                    tenant_id?: string | null;
                    content_type: string;
                    content_hash: string;
                    content: string;
                    embedding: number[];
                    metadata?: Json;
                    created_at?: string;
                };
                Update: {
                    id?: string;
                    tenant_id?: string | null;
                    content_type?: string;
                    content_hash?: string;
                    content?: string;
                    embedding?: number[];
                    metadata?: Json;
                    created_at?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "knowledge_vectors_tenant_id_fkey";
                        columns: ["tenant_id"];
                        referencedRelation: "tenants";
                        referencedColumns: ["id"];
                    }
                ];
            };
            data_generation_events: {
                Row: {
                    id: string;
                    tenant_id: string;
                    event_category: DataEventCategory;
                    source_encounter_id: string | null;
                    source_decision_id: string | null;
                    data_fingerprint: string;
                    data_payload: Json;
                    compounding_score: number;
                    created_at: string;
                };
                Insert: {
                    id?: string;
                    tenant_id: string;
                    event_category: DataEventCategory;
                    source_encounter_id?: string | null;
                    source_decision_id?: string | null;
                    data_fingerprint: string;
                    data_payload?: Json;
                    compounding_score?: number;
                    created_at?: string;
                };
                Update: {
                    id?: string;
                    tenant_id?: string;
                    event_category?: DataEventCategory;
                    source_encounter_id?: string | null;
                    source_decision_id?: string | null;
                    data_fingerprint?: string;
                    data_payload?: Json;
                    compounding_score?: number;
                    created_at?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "dge_tenant_id_fkey";
                        columns: ["tenant_id"];
                        referencedRelation: "tenants";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "dge_encounter_id_fkey";
                        columns: ["source_encounter_id"];
                        referencedRelation: "encounters";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "dge_decision_id_fkey";
                        columns: ["source_decision_id"];
                        referencedRelation: "ai_decision_logs";
                        referencedColumns: ["id"];
                    }
                ];
            };
            workflow_snapshots: {
                Row: {
                    id: string;
                    tenant_id: string;
                    workflow_type: WorkflowType;
                    encounter_id: string;
                    triggered_by: string;
                    state_graph: Json;
                    actor_sequence: Json;
                    decision_points: Json;
                    replication_cost_score: number;
                    snapshot_version: number;
                    created_at: string;
                };
                Insert: {
                    id?: string;
                    tenant_id: string;
                    workflow_type: WorkflowType;
                    encounter_id: string;
                    triggered_by: string;
                    state_graph: Json;
                    actor_sequence: Json;
                    decision_points: Json;
                    replication_cost_score?: number;
                    snapshot_version?: number;
                    created_at?: string;
                };
                Update: {
                    id?: string;
                    tenant_id?: string;
                    workflow_type?: WorkflowType;
                    encounter_id?: string;
                    triggered_by?: string;
                    state_graph?: Json;
                    actor_sequence?: Json;
                    decision_points?: Json;
                    replication_cost_score?: number;
                    snapshot_version?: number;
                    created_at?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "ws_tenant_id_fkey";
                        columns: ["tenant_id"];
                        referencedRelation: "tenants";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "ws_encounter_id_fkey";
                        columns: ["encounter_id"];
                        referencedRelation: "encounters";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "ws_triggered_by_fkey";
                        columns: ["triggered_by"];
                        referencedRelation: "users";
                        referencedColumns: ["id"];
                    }
                ];
            };
            intelligence_metrics: {
                Row: {
                    id: string;
                    tenant_id: string;
                    metric_type: IntelligenceMetricType;
                    decision_id: string | null;
                    encounter_id: string | null;
                    score: number;
                    feedback_signal: Json;
                    window_start: string | null;
                    window_end: string | null;
                    intelligence_sharing_opted_in: boolean;
                    model_version: string | null;
                    created_at: string;
                };
                Insert: {
                    id?: string;
                    tenant_id: string;
                    metric_type: IntelligenceMetricType;
                    decision_id?: string | null;
                    encounter_id?: string | null;
                    score: number;
                    feedback_signal?: Json;
                    window_start?: string | null;
                    window_end?: string | null;
                    intelligence_sharing_opted_in?: boolean;
                    model_version?: string | null;
                    created_at?: string;
                };
                Update: {
                    id?: string;
                    tenant_id?: string;
                    metric_type?: IntelligenceMetricType;
                    decision_id?: string | null;
                    encounter_id?: string | null;
                    score?: number;
                    feedback_signal?: Json;
                    window_start?: string | null;
                    window_end?: string | null;
                    intelligence_sharing_opted_in?: boolean;
                    model_version?: string | null;
                    created_at?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "im_tenant_id_fkey";
                        columns: ["tenant_id"];
                        referencedRelation: "tenants";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "im_decision_id_fkey";
                        columns: ["decision_id"];
                        referencedRelation: "ai_decision_logs";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "im_encounter_id_fkey";
                        columns: ["encounter_id"];
                        referencedRelation: "encounters";
                        referencedColumns: ["id"];
                    }
                ];
            };
            edge_simulations: {
                Row: {
                    id: string;
                    tenant_id: string;
                    simulation_type: SimulationType;
                    scenario_config: Json;
                    scenario_name: string;
                    expected_outcome: Json;
                    actual_outcome: Json | null;
                    failure_mode: string | null;
                    safety_score: number | null;
                    model_version: string | null;
                    pipeline_trace_id: string | null;
                    pipeline_decision_id: string | null;
                    status: SimulationStatus;
                    started_at: string | null;
                    completed_at: string | null;
                    created_at: string;
                };
                Insert: {
                    id?: string;
                    tenant_id: string;
                    simulation_type: SimulationType;
                    scenario_config: Json;
                    scenario_name: string;
                    expected_outcome: Json;
                    actual_outcome?: Json | null;
                    failure_mode?: string | null;
                    safety_score?: number | null;
                    model_version?: string | null;
                    pipeline_trace_id?: string | null;
                    pipeline_decision_id?: string | null;
                    status?: SimulationStatus;
                    started_at?: string | null;
                    completed_at?: string | null;
                    created_at?: string;
                };
                Update: {
                    id?: string;
                    tenant_id?: string;
                    simulation_type?: SimulationType;
                    scenario_config?: Json;
                    scenario_name?: string;
                    expected_outcome?: Json;
                    actual_outcome?: Json | null;
                    failure_mode?: string | null;
                    safety_score?: number | null;
                    model_version?: string | null;
                    pipeline_trace_id?: string | null;
                    pipeline_decision_id?: string | null;
                    status?: SimulationStatus;
                    started_at?: string | null;
                    completed_at?: string | null;
                    created_at?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "es_tenant_id_fkey";
                        columns: ["tenant_id"];
                        referencedRelation: "tenants";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "es_decision_id_fkey";
                        columns: ["pipeline_decision_id"];
                        referencedRelation: "ai_decision_logs";
                        referencedColumns: ["id"];
                    }
                ];
            };

            // ─── API Event Tables (Migration 014) ──────────────────────────

            clinical_cases: {
                Row: {
                    id: string;
                    tenant_id: string;
                    user_id: string | null;
                    clinic_id: string | null;
                    source_module: string | null;
                    case_key: string;
                    source_case_reference: string | null;
                    species: string | null;
                    species_canonical: string | null;
                    species_display: string | null;
                    species_raw: string | null;
                    symptom_text_raw: string | null;
                    symptoms_raw: string | null;
                    symptoms_normalized: string[];
                    breed: string | null;
                    symptom_vector: string[];
                    symptom_vector_normalized: Json;
                    symptom_summary: string | null;
                    patient_metadata: Json;
                    metadata: Json;
                    latest_input_signature: Json;
                    ingestion_status: string;
                    invalid_case: boolean;
                    validation_error_code: string | null;
                    primary_condition_class: string | null;
                    top_diagnosis: string | null;
                    predicted_diagnosis: string | null;
                    confirmed_diagnosis: string | null;
                    label_type: string;
                    diagnosis_confidence: number | null;
                    severity_score: number | null;
                    emergency_level: string | null;
                    triage_priority: string | null;
                    contradiction_score: number | null;
                    contradiction_flags: string[];
                    adversarial_case: boolean;
                    adversarial_case_type: string | null;
                    uncertainty_notes: string[];
                    case_cluster: string | null;
                    model_version: string | null;
                    telemetry_status: string | null;
                    calibration_status: string | null;
                    prediction_correct: boolean | null;
                    confidence_error: number | null;
                    calibration_bucket: string | null;
                    degraded_confidence: number | null;
                    differential_spread: Json | null;
                    latest_inference_event_id: string | null;
                    latest_outcome_event_id: string | null;
                    latest_simulation_event_id: string | null;
                    inference_event_count: number;
                    first_inference_at: string;
                    last_inference_at: string;
                    created_at: string;
                    updated_at: string;
                };
                Insert: {
                    id?: string;
                    tenant_id: string;
                    user_id?: string | null;
                    clinic_id?: string | null;
                    source_module?: string | null;
                    case_key: string;
                    source_case_reference?: string | null;
                    species?: string | null;
                    species_canonical?: string | null;
                    species_display?: string | null;
                    species_raw?: string | null;
                    symptom_text_raw?: string | null;
                    symptoms_raw?: string | null;
                    symptoms_normalized?: string[];
                    breed?: string | null;
                    symptom_vector?: string[];
                    symptom_vector_normalized?: Json;
                    symptom_summary?: string | null;
                    patient_metadata?: Json;
                    metadata?: Json;
                    latest_input_signature?: Json;
                    ingestion_status?: string;
                    invalid_case?: boolean;
                    validation_error_code?: string | null;
                    primary_condition_class?: string | null;
                    top_diagnosis?: string | null;
                    predicted_diagnosis?: string | null;
                    confirmed_diagnosis?: string | null;
                    label_type?: string;
                    diagnosis_confidence?: number | null;
                    severity_score?: number | null;
                    emergency_level?: string | null;
                    triage_priority?: string | null;
                    contradiction_score?: number | null;
                    contradiction_flags?: string[];
                    adversarial_case?: boolean;
                    adversarial_case_type?: string | null;
                    uncertainty_notes?: string[];
                    case_cluster?: string | null;
                    model_version?: string | null;
                    telemetry_status?: string | null;
                    calibration_status?: string | null;
                    prediction_correct?: boolean | null;
                    confidence_error?: number | null;
                    calibration_bucket?: string | null;
                    degraded_confidence?: number | null;
                    differential_spread?: Json | null;
                    latest_inference_event_id?: string | null;
                    latest_outcome_event_id?: string | null;
                    latest_simulation_event_id?: string | null;
                    inference_event_count?: number;
                    first_inference_at?: string;
                    last_inference_at?: string;
                    created_at?: string;
                    updated_at?: string;
                };
                Update: {
                    id?: string;
                    tenant_id?: string;
                    user_id?: string | null;
                    clinic_id?: string | null;
                    source_module?: string | null;
                    case_key?: string;
                    source_case_reference?: string | null;
                    species?: string | null;
                    species_canonical?: string | null;
                    species_display?: string | null;
                    species_raw?: string | null;
                    symptom_text_raw?: string | null;
                    symptoms_raw?: string | null;
                    symptoms_normalized?: string[];
                    breed?: string | null;
                    symptom_vector?: string[];
                    symptom_vector_normalized?: Json;
                    symptom_summary?: string | null;
                    patient_metadata?: Json;
                    metadata?: Json;
                    latest_input_signature?: Json;
                    ingestion_status?: string;
                    invalid_case?: boolean;
                    validation_error_code?: string | null;
                    primary_condition_class?: string | null;
                    top_diagnosis?: string | null;
                    predicted_diagnosis?: string | null;
                    confirmed_diagnosis?: string | null;
                    label_type?: string;
                    diagnosis_confidence?: number | null;
                    severity_score?: number | null;
                    emergency_level?: string | null;
                    triage_priority?: string | null;
                    contradiction_score?: number | null;
                    contradiction_flags?: string[];
                    adversarial_case?: boolean;
                    adversarial_case_type?: string | null;
                    uncertainty_notes?: string[];
                    case_cluster?: string | null;
                    model_version?: string | null;
                    telemetry_status?: string | null;
                    calibration_status?: string | null;
                    prediction_correct?: boolean | null;
                    confidence_error?: number | null;
                    calibration_bucket?: string | null;
                    degraded_confidence?: number | null;
                    differential_spread?: Json | null;
                    latest_inference_event_id?: string | null;
                    latest_outcome_event_id?: string | null;
                    latest_simulation_event_id?: string | null;
                    inference_event_count?: number;
                    first_inference_at?: string;
                    last_inference_at?: string;
                    created_at?: string;
                    updated_at?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "clinical_cases_tenant_id_fkey";
                        columns: ["tenant_id"];
                        referencedRelation: "tenants";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "clinical_cases_latest_inference_event_id_fkey";
                        columns: ["latest_inference_event_id"];
                        referencedRelation: "ai_inference_events";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "clinical_cases_latest_outcome_event_id_fkey";
                        columns: ["latest_outcome_event_id"];
                        referencedRelation: "clinical_outcome_events";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "clinical_cases_latest_simulation_event_id_fkey";
                        columns: ["latest_simulation_event_id"];
                        referencedRelation: "edge_simulation_events";
                        referencedColumns: ["id"];
                    }
                ];
            };

            ai_inference_events: {
                Row: {
                    id: string;
                    tenant_id: string;
                    user_id: string | null;
                    clinic_id: string | null;
                    case_id: string | null;
                    source_module: string | null;
                    model_name: string;
                    model_version: string;
                    input_signature: Json;
                    output_payload: Json;
                    confidence_score: number | null;
                    uncertainty_metrics: Json | null;
                    compute_profile: Json | null;
                    inference_latency_ms: number;
                    created_at: string;
                };
                Insert: {
                    id?: string;
                    tenant_id: string;
                    user_id?: string | null;
                    clinic_id?: string | null;
                    case_id?: string | null;
                    source_module?: string | null;
                    model_name: string;
                    model_version: string;
                    input_signature: Json;
                    output_payload: Json;
                    confidence_score?: number | null;
                    uncertainty_metrics?: Json | null;
                    compute_profile?: Json | null;
                    inference_latency_ms: number;
                    created_at?: string;
                };
                Update: {
                    id?: string;
                    tenant_id?: string;
                    user_id?: string | null;
                    clinic_id?: string | null;
                    case_id?: string | null;
                    source_module?: string | null;
                    model_name?: string;
                    model_version?: string;
                    input_signature?: Json;
                    output_payload?: Json;
                    confidence_score?: number | null;
                    uncertainty_metrics?: Json | null;
                    compute_profile?: Json | null;
                    inference_latency_ms?: number;
                    created_at?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "ai_inference_events_tenant_id_fkey";
                        columns: ["tenant_id"];
                        referencedRelation: "tenants";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "ai_inference_events_case_id_fkey";
                        columns: ["case_id"];
                        referencedRelation: "clinical_cases";
                        referencedColumns: ["id"];
                    }
                ];
            };

            clinical_outcome_events: {
                Row: {
                    id: string;
                    tenant_id: string;
                    user_id: string | null;
                    clinic_id: string | null;
                    case_id: string | null;
                    source_module: string | null;
                    inference_event_id: string;
                    outcome_type: string;
                    outcome_payload: Json;
                    outcome_timestamp: string;
                    label_type: string | null;
                    created_at: string;
                };
                Insert: {
                    id?: string;
                    tenant_id: string;
                    user_id?: string | null;
                    clinic_id?: string | null;
                    case_id?: string | null;
                    source_module?: string | null;
                    inference_event_id: string;
                    outcome_type: string;
                    outcome_payload: Json;
                    outcome_timestamp: string;
                    label_type?: string | null;
                    created_at?: string;
                };
                Update: {
                    id?: string;
                    tenant_id?: string;
                    user_id?: string | null;
                    clinic_id?: string | null;
                    case_id?: string | null;
                    source_module?: string | null;
                    inference_event_id?: string;
                    outcome_type?: string;
                    outcome_payload?: Json;
                    outcome_timestamp?: string;
                    label_type?: string | null;
                    created_at?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "clinical_outcome_events_tenant_id_fkey";
                        columns: ["tenant_id"];
                        referencedRelation: "tenants";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "clinical_outcome_events_inference_event_id_fkey";
                        columns: ["inference_event_id"];
                        referencedRelation: "ai_inference_events";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "clinical_outcome_events_case_id_fkey";
                        columns: ["case_id"];
                        referencedRelation: "clinical_cases";
                        referencedColumns: ["id"];
                    }
                ];
            };

            edge_simulation_events: {
                Row: {
                    id: string;
                    tenant_id: string | null;
                    user_id: string | null;
                    clinic_id: string | null;
                    case_id: string | null;
                    source_module: string | null;
                    simulation_type: string;
                    simulation_parameters: Json;
                    triggered_inference_id: string | null;
                    failure_mode: string | null;
                    stress_metrics: Json | null;
                    is_real_world: boolean;
                    created_at: string;
                };
                Insert: {
                    id?: string;
                    tenant_id?: string | null;
                    user_id?: string | null;
                    clinic_id?: string | null;
                    case_id?: string | null;
                    source_module?: string | null;
                    simulation_type: string;
                    simulation_parameters: Json;
                    triggered_inference_id?: string | null;
                    failure_mode?: string | null;
                    stress_metrics?: Json | null;
                    is_real_world: boolean;
                    created_at?: string;
                };
                Update: {
                    id?: string;
                    tenant_id?: string | null;
                    user_id?: string | null;
                    clinic_id?: string | null;
                    case_id?: string | null;
                    source_module?: string | null;
                    simulation_type?: string;
                    simulation_parameters?: Json;
                    triggered_inference_id?: string | null;
                    failure_mode?: string | null;
                    stress_metrics?: Json | null;
                    is_real_world?: boolean;
                    created_at?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "edge_simulation_events_tenant_id_fkey";
                        columns: ["tenant_id"];
                        referencedRelation: "tenants";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "edge_simulation_events_inference_id_fkey";
                        columns: ["triggered_inference_id"];
                        referencedRelation: "ai_inference_events";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "edge_simulation_events_case_id_fkey";
                        columns: ["case_id"];
                        referencedRelation: "clinical_cases";
                        referencedColumns: ["id"];
                    }
                ];
            };

            network_intelligence_metrics: {
                Row: {
                    id: string;
                    tenant_id: string | null;
                    metric_name: string;
                    metric_scope: string;
                    aggregated_signal: Json;
                    model_version: string | null;
                    computed_at: string;
                    created_at: string;
                };
                Insert: {
                    id?: string;
                    tenant_id?: string | null;
                    metric_name: string;
                    metric_scope: string;
                    aggregated_signal: Json;
                    model_version?: string | null;
                    computed_at?: string;
                    created_at?: string;
                };
                Update: {
                    id?: string;
                    tenant_id?: string | null;
                    metric_name?: string;
                    metric_scope?: string;
                    aggregated_signal?: Json;
                    model_version?: string | null;
                    computed_at?: string;
                    created_at?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "network_intelligence_metrics_tenant_id_fkey";
                        columns: ["tenant_id"];
                        referencedRelation: "tenants";
                        referencedColumns: ["id"];
                    }
                ];
            };
        };
        Views: {
            clinical_case_live_view: {
                Row: {
                    case_id: string | null;
                    tenant_id: string | null;
                    user_id: string | null;
                    species: string | null;
                    breed: string | null;
                    symptoms_summary: string | null;
                    symptom_vector_normalized: Json | null;
                    primary_condition_class: string | null;
                    top_diagnosis: string | null;
                    predicted_diagnosis: string | null;
                    confirmed_diagnosis: string | null;
                    label_type: string | null;
                    diagnosis_confidence: number | null;
                    severity_score: number | null;
                    triage_priority: string | null;
                    contradiction_score: number | null;
                    contradiction_flags: string[] | null;
                    uncertainty_notes: string[] | null;
                    case_cluster: string | null;
                    model_version: string | null;
                    telemetry_status: string | null;
                    calibration_status: string | null;
                    prediction_correct: boolean | null;
                    confidence_error: number | null;
                    calibration_bucket: string | null;
                    degraded_confidence: number | null;
                    differential_spread: Json | null;
                    ingestion_status: string | null;
                    invalid_case: boolean | null;
                    validation_error_code: string | null;
                    adversarial_case: boolean | null;
                    adversarial_case_type: string | null;
                    latest_inference_event_id: string | null;
                    latest_outcome_event_id: string | null;
                    latest_simulation_event_id: string | null;
                    latest_confidence: number | null;
                    latest_emergency_level: string | null;
                    source_module: string | null;
                    updated_at: string | null;
                };
                Relationships: [];
            };
        };
        Functions: Record<string, never>;
        Enums: {
            user_role: UserRole;
            encounter_status: EncounterStatus;
            clinical_event_type: ClinicalEventType;
            override_action: OverrideAction;
            data_event_category: DataEventCategory;
            workflow_type: WorkflowType;
            intelligence_metric_type: IntelligenceMetricType;
            simulation_type: SimulationType;
            simulation_status: SimulationStatus;
        };
        CompositeTypes: Record<string, never>;
    };
}

// ─── Convenience Type Aliases (extracted from Database for domain use) ────────

export type Tenant = Database['public']['Tables']['tenants']['Row'];
export type User = Database['public']['Tables']['users']['Row'];
export type Client = Database['public']['Tables']['clients']['Row'];
export type Patient = Database['public']['Tables']['patients']['Row'];
export type Encounter = Database['public']['Tables']['encounters']['Row'];
export type ClinicalEvent = Database['public']['Tables']['clinical_events']['Row'];
export type AIDecisionLog = Database['public']['Tables']['ai_decision_logs']['Row'];
export type Override = Database['public']['Tables']['overrides']['Row'];
export type Outcome = Database['public']['Tables']['outcomes']['Row'];
export type KnowledgeVector = Database['public']['Tables']['knowledge_vectors']['Row'];
export type DataGenerationEvent = Database['public']['Tables']['data_generation_events']['Row'];
export type WorkflowSnapshot = Database['public']['Tables']['workflow_snapshots']['Row'];
export type IntelligenceMetric = Database['public']['Tables']['intelligence_metrics']['Row'];
export type EdgeSimulation = Database['public']['Tables']['edge_simulations']['Row'];
export type ClinicalCase = Database['public']['Tables']['clinical_cases']['Row'];
export type AIInferenceEvent = Database['public']['Tables']['ai_inference_events']['Row'];
export type ClinicalOutcomeEvent = Database['public']['Tables']['clinical_outcome_events']['Row'];
export type EdgeSimulationEvent = Database['public']['Tables']['edge_simulation_events']['Row'];
export type NetworkIntelligenceMetric = Database['public']['Tables']['network_intelligence_metrics']['Row'];
