/**
 * @vetios/ai-core — Prompt Templates
 *
 * Versioned prompt templates for the Decision Intelligence Layer.
 * Each template has a unique `template_id` derived from its content hash,
 * enabling traceability: every AI decision log records which prompt version was used.
 */

import type { ChatMessage } from './client';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PromptTemplate {
    /** Unique identifier — a content-based hash for versioning */
    template_id: string;
    /** Human-readable name */
    name: string;
    /** Description of when this prompt is used */
    description: string;
    /** Builds the message array from structured input */
    build(context: PromptContext): ChatMessage[];
}

export interface PromptContext {
    /** Patient information */
    patient: {
        name: string;
        species: string;
        breed: string | null;
        weight_kg: number | null;
        age_description: string | null;
    };
    /** Current encounter data */
    encounter: {
        chief_complaint: string | null;
        clinical_events: Array<{
            event_type: string;
            payload: Record<string, unknown>;
            created_at: string;
        }>;
    };
    /** Relevant knowledge retrieved via RAG */
    retrieved_knowledge?: string[];
    /** Clinic-specific protocols or constraints */
    clinic_protocols?: string[];
}

// ─── Hashing Utility ─────────────────────────────────────────────────────────

/**
 * Simple deterministic hash for template versioning.
 * In production, use a proper SHA-256. This is a FNV-1a 32-bit hash.
 */
function hashString(str: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

// ─── System Prompts ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT_BASE = `You are VetIOS Decision Intelligence, a clinical decision support system for veterinary medicine.

YOUR ROLE:
- Provide evidence-based diagnostic differentials and treatment recommendations.
- You are an ADVISORY system. All outputs are suggestions for a licensed veterinarian to review.
- NEVER present your output as a definitive diagnosis or order.

RULES:
- Be precise and cite relevant veterinary medical knowledge.
- Consider species, breed, weight, and age in all recommendations.
- Flag uncertainties explicitly.
- If information is insufficient, state what additional data would help.
- Present differentials ranked by likelihood.
- For medications, include drug name, dose (mg/kg), route, and frequency.`;

// ─── Template: Differential Diagnosis ────────────────────────────────────────

const DIFFERENTIAL_DIAGNOSIS_TEMPLATE_CONTENT = `${SYSTEM_PROMPT_BASE}
TASK: Generate differential diagnoses based on clinical presentation.`;

export const differentialDiagnosisTemplate: PromptTemplate = {
    template_id: hashString(DIFFERENTIAL_DIAGNOSIS_TEMPLATE_CONTENT),
    name: 'differential_diagnosis',
    description: 'Generates ranked differential diagnoses from clinical encounter data.',

    build(context: PromptContext): ChatMessage[] {
        const messages: ChatMessage[] = [
            { role: 'system', content: DIFFERENTIAL_DIAGNOSIS_TEMPLATE_CONTENT },
        ];

        // Build patient context
        const patientInfo = [
            `Patient: ${context.patient.name}`,
            `Species: ${context.patient.species}`,
            context.patient.breed && `Breed: ${context.patient.breed}`,
            context.patient.weight_kg && `Weight: ${context.patient.weight_kg} kg`,
            context.patient.age_description && `Age: ${context.patient.age_description}`,
        ]
            .filter(Boolean)
            .join('\n');

        // Build clinical timeline
        const timeline = context.encounter.clinical_events
            .map((e) => `[${e.created_at}] ${e.event_type}: ${JSON.stringify(e.payload)}`)
            .join('\n');

        let userContent = `PATIENT:\n${patientInfo}\n\nCHIEF COMPLAINT:\n${context.encounter.chief_complaint ?? 'Not specified'}\n\nCLINICAL TIMELINE:\n${timeline || 'No events recorded yet.'}`;

        if (context.retrieved_knowledge && context.retrieved_knowledge.length > 0) {
            userContent += `\n\nRELEVANT KNOWLEDGE:\n${context.retrieved_knowledge.join('\n---\n')}`;
        }

        if (context.clinic_protocols && context.clinic_protocols.length > 0) {
            userContent += `\n\nCLINIC PROTOCOLS:\n${context.clinic_protocols.join('\n')}`;
        }

        userContent += `\n\nProvide your differential diagnoses in JSON format:
{
  "differentials": [
    {
      "diagnosis": "string",
      "likelihood": "high|medium|low",
      "reasoning": "string",
      "recommended_tests": ["string"],
      "urgency": "emergency|urgent|routine"
    }
  ],
  "additional_data_needed": ["string"],
  "confidence_note": "string"
}`;

        messages.push({ role: 'user', content: userContent });

        return messages;
    },
};

// ─── Template: Treatment Plan ────────────────────────────────────────────────

const TREATMENT_PLAN_TEMPLATE_CONTENT = `${SYSTEM_PROMPT_BASE}
TASK: Generate a treatment plan for a confirmed or working diagnosis.
Include medications with precise dosing, monitoring plan, and follow-up schedule.`;

export const treatmentPlanTemplate: PromptTemplate = {
    template_id: hashString(TREATMENT_PLAN_TEMPLATE_CONTENT),
    name: 'treatment_plan',
    description: 'Generates treatment plans with medication dosing, monitoring, and follow-ups.',

    build(context: PromptContext): ChatMessage[] {
        const messages: ChatMessage[] = [
            { role: 'system', content: TREATMENT_PLAN_TEMPLATE_CONTENT },
        ];

        const patientInfo = [
            `Patient: ${context.patient.name}`,
            `Species: ${context.patient.species}`,
            context.patient.breed && `Breed: ${context.patient.breed}`,
            context.patient.weight_kg && `Weight: ${context.patient.weight_kg} kg`,
            context.patient.age_description && `Age: ${context.patient.age_description}`,
        ]
            .filter(Boolean)
            .join('\n');

        const timeline = context.encounter.clinical_events
            .map((e) => `[${e.created_at}] ${e.event_type}: ${JSON.stringify(e.payload)}`)
            .join('\n');

        let userContent = `PATIENT:\n${patientInfo}\n\nCLINICAL TIMELINE:\n${timeline || 'None'}`;

        if (context.retrieved_knowledge && context.retrieved_knowledge.length > 0) {
            userContent += `\n\nRELEVANT KNOWLEDGE:\n${context.retrieved_knowledge.join('\n---\n')}`;
        }

        userContent += `\n\nProvide your treatment plan in JSON format:
{
  "working_diagnosis": "string",
  "medications": [
    {
      "drug_name": "string",
      "dose_mg_per_kg": number,
      "total_dose_mg": number,
      "route": "PO|IV|IM|SC|topical",
      "frequency": "string",
      "duration_days": number,
      "notes": "string"
    }
  ],
  "procedures": ["string"],
  "monitoring": {
    "parameters": ["string"],
    "frequency": "string"
  },
  "follow_up": {
    "timing": "string",
    "purpose": "string"
  },
  "client_instructions": "string",
  "warnings": ["string"]
}`;

        messages.push({ role: 'user', content: userContent });

        return messages;
    },
};

// ─── Template Registry ───────────────────────────────────────────────────────

export const PROMPT_REGISTRY: Record<string, PromptTemplate> = {
    differential_diagnosis: differentialDiagnosisTemplate,
    treatment_plan: treatmentPlanTemplate,
};

export function getPromptTemplate(name: string): PromptTemplate {
    const template = PROMPT_REGISTRY[name];
    if (!template) {
        throw new Error(`Unknown prompt template: "${name}". Available: ${Object.keys(PROMPT_REGISTRY).join(', ')}`);
    }
    return template;
}
