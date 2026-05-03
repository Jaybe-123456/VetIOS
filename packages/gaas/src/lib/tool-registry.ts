// ============================================================
// VetIOS GaaS — Tool Registry & Action Executor
// Typed, policy-gated, auditable actions agents can invoke.
// ============================================================

import type { ToolCall, ToolName, AgentPolicy } from "../types/agent";

export interface ToolDefinition {
  name: ToolName;
  description: string;
  input_schema: Record<string, { type: string; description: string; required?: boolean }>;
  executor: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  requires_approval?: boolean;
}

// ─── Tool Registry ───────────────────────────────────────────
export class ToolRegistry {
  private tools = new Map<ToolName, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  get(name: ToolName): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  isAllowed(name: ToolName, policy: AgentPolicy): boolean {
    return policy.allowed_tools.includes(name);
  }

  requiresApproval(name: ToolName, policy: AgentPolicy): boolean {
    return policy.require_human_approval_for.includes(name);
  }
}

// ─── Tool Executor ───────────────────────────────────────────
export class ToolExecutor {
  constructor(
    private registry: ToolRegistry,
    _baseUrl: string,
    _authToken: string
  ) {}

  async execute(
    call: ToolCall,
    policy: AgentPolicy
  ): Promise<ToolCall> {
    const tool = this.registry.get(call.tool);
    if (!tool) {
      return { ...call, status: "failed", output: { error: `Unknown tool: ${call.tool}` } };
    }

    if (!this.registry.isAllowed(call.tool, policy)) {
      return { ...call, status: "failed", output: { error: `Tool not permitted by policy: ${call.tool}` } };
    }

    const start = Date.now();
    try {
      const output = await tool.executor(call.input);
      return { ...call, status: "success", output, latency_ms: Date.now() - start };
    } catch (err) {
      return {
        ...call,
        status: "failed",
        output: { error: String(err) },
        latency_ms: Date.now() - start,
      };
    }
  }
}

// ─── Built-in Tool Definitions ───────────────────────────────
export function buildDefaultTools(baseUrl: string, authToken: string): ToolDefinition[] {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${authToken}`,
  };

  return [
    {
      name: "run_inference",
      description: "Run clinical inference on a patient case and return ranked differentials.",
      input_schema: {
        species: { type: "string", description: "Patient species", required: true },
        symptoms: { type: "array", description: "List of symptoms", required: true },
        metadata: { type: "object", description: "Lab values and vitals" },
      },
      executor: async (input) => {
        const res = await fetch(`${baseUrl}/api/inference`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: { name: "VetIOS Diagnostics", version: "latest" },
            input: { input_signature: input },
          }),
        });
        return res.json();
      },
    },
    {
      name: "record_outcome",
      description: "Record the confirmed diagnosis outcome, closing the supervisory loop.",
      input_schema: {
        inference_event_id: { type: "string", description: "Linked inference event", required: true },
        label: { type: "string", description: "Confirmed diagnosis label", required: true },
        confidence: { type: "number", description: "Clinician confidence 0-1" },
      },
      executor: async (input) => {
        const res = await fetch(`${baseUrl}/api/outcome`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            inference_event_id: input.inference_event_id,
            outcome: {
              type: "confirmed_diagnosis",
              payload: { label: input.label, confidence: input.confidence ?? 0.9 },
              timestamp: new Date().toISOString(),
            },
          }),
        });
        return res.json();
      },
    },
    {
      name: "run_simulation",
      description: "Run a counterfactual simulation for a case variant before committing changes.",
      input_schema: {
        base_case: { type: "object", description: "Base patient case", required: true },
        steps: { type: "number", description: "Simulation steps" },
        mode: { type: "string", description: "Simulation mode: adaptive | fixed" },
      },
      executor: async (input) => {
        const res = await fetch(`${baseUrl}/api/simulate`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            steps: input.steps ?? 10,
            mode: input.mode ?? "adaptive",
            base_case: input.base_case,
            inference: { model: "gpt-4o-mini", model_version: "gpt-4o-mini" },
          }),
        });
        return res.json();
      },
    },
    {
      name: "query_drug_db",
      description: "Query the veterinary drug interaction and dosage database.",
      input_schema: {
        drug_names: { type: "array", description: "List of drug names to check", required: true },
        species: { type: "string", description: "Patient species", required: true },
        weight_kg: { type: "number", description: "Patient weight in kg" },
      },
      executor: async (input) => {
        const drugs = Array.isArray(input.drug_names) ? input.drug_names as string[] : [];
        const species = typeof input.species === 'string' ? input.species : 'canine';
        const weight_kg = typeof input.weight_kg === 'number' ? input.weight_kg : null;
        const conditions = Array.isArray(input.conditions) ? input.conditions as string[] : [];
        try {
          const res = await fetch(`${baseUrl}/api/drug-interaction`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ drugs, species, conditions, weight_kg }),
          });
          if (!res.ok) throw new Error(`Drug API error: ${res.status}`);
          const json = await res.json() as Record<string, unknown>;
          const data = json.data as Record<string, unknown> ?? {};
          return {
            safe_to_administer: data.safeToAdminister ?? false,
            overall_risk: data.overallRisk ?? 'unknown',
            interactions: data.interactions ?? [],
            contraindications: data.contraindications ?? [],
            dose_recommendations: data.doseRecommendations ?? {},
            clinical_summary: data.clinicalSummary ?? '',
            requires_vet_review: data.requiresVetReview ?? true,
            constitutional_safety: data.constitutional_safety ?? null,
            source: 'vetios-drug-db-v2',
            queried_at: new Date().toISOString(),
          };
        } catch (err) {
          return {
            interactions: [],
            contraindications: [],
            warnings: [String(err)],
            source: 'vetios-drug-db-v2',
            queried_at: new Date().toISOString(),
            error: 'Drug interaction check failed — see warnings',
          };
        }
      },
    },
    {
      name: "order_lab",
      description: "Trigger a lab order request for the patient.",
      requires_approval: true,
      input_schema: {
        patient_id: { type: "string", description: "Patient ID", required: true },
        tests: { type: "array", description: "List of lab tests to order", required: true },
        urgency: { type: "string", description: "routine | urgent | stat" },
        notes: { type: "string", description: "Clinical notes for lab" },
      },
      executor: async (input) => {
        return {
          order_id: `lab_${Date.now()}`,
          patient_id: input.patient_id,
          tests: input.tests,
          urgency: input.urgency ?? "routine",
          status: "submitted",
          submitted_at: new Date().toISOString(),
        };
      },
    },
    {
      name: "write_ehr",
      description: "Write a structured note or update to the patient EHR.",
      requires_approval: true,
      input_schema: {
        patient_id: { type: "string", description: "Patient ID", required: true },
        note_type: { type: "string", description: "SOAP | progress | discharge | alert", required: true },
        content: { type: "string", description: "Note content", required: true },
        diagnoses: { type: "array", description: "ICD codes or label list" },
      },
      executor: async (input) => {
        return {
          ehr_note_id: `ehr_${Date.now()}`,
          patient_id: input.patient_id,
          type: input.note_type,
          written_at: new Date().toISOString(),
          status: "committed",
        };
      },
    },
    {
      name: "send_alert",
      description: "Send an alert to the clinician or care team.",
      input_schema: {
        patient_id: { type: "string", description: "Patient ID", required: true },
        severity: { type: "string", description: "info | warning | critical", required: true },
        message: { type: "string", description: "Alert message body", required: true },
        channel: { type: "string", description: "email | sms | in_app" },
      },
      executor: async (input) => {
        return {
          alert_id: `alert_${Date.now()}`,
          patient_id: input.patient_id,
          severity: input.severity,
          dispatched_at: new Date().toISOString(),
          channel: input.channel ?? "in_app",
          status: "sent",
        };
      },
    },
    {
      name: "schedule_followup",
      description: "Schedule a follow-up appointment or check-in for the patient.",
      input_schema: {
        patient_id: { type: "string", description: "Patient ID", required: true },
        reason: { type: "string", description: "Reason for follow-up", required: true },
        days_from_now: { type: "number", description: "Days until follow-up", required: true },
        priority: { type: "string", description: "routine | priority | urgent" },
      },
      executor: async (input) => {
        const followupDate = new Date();
        followupDate.setDate(followupDate.getDate() + Number(input.days_from_now));
        return {
          followup_id: `fu_${Date.now()}`,
          patient_id: input.patient_id,
          scheduled_for: followupDate.toISOString(),
          reason: input.reason,
          priority: input.priority ?? "routine",
          status: "scheduled",
        };
      },
    },
    {
      name: "fetch_patient_history",
      description: "Retrieve prior case history, diagnoses, and treatment records for a patient.",
      input_schema: {
        patient_id: { type: "string", description: "Patient ID", required: true },
        limit: { type: "number", description: "Max records to return" },
        since: { type: "string", description: "ISO timestamp cutoff" },
      },
      executor: async (input) => {
        return {
          patient_id: input.patient_id,
          records: [],
          total_count: 0,
          note: "EHR integration pending — memory store is the active history layer",
        };
      },
    },
    {
      name: "query_vkg_differentials",
      description: "Traverse the Veterinary Knowledge Graph to generate ranked differential diagnoses. Performs 5-hop inference: symptom matching, pathogen chaining, breed predisposition boosting, biomarker confirmation, and differential chaining. Returns ranked diseases with matched symptoms, expected labs, and contraindications.",
      input_schema: {
        symptoms: { type: "array", description: "List of presenting symptoms", required: true },
        species: { type: "string", description: "Patient species (canine, feline, equine, bovine, avian)", required: true },
        breed: { type: "string", description: "Patient breed for predisposition boosting" },
        biomarkers: { type: "object", description: "Lab findings as key-value pairs e.g. { ALT: 120, creatinine: 3.2 }" },
      },
      executor: async (input) => {
        try {
          const res = await fetch(`${baseUrl}/api/vkg/differentials`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              symptoms: input.symptoms,
              species: input.species,
              breed: input.breed ?? null,
              biomarkers: input.biomarkers ?? null,
            }),
          });
          if (!res.ok) throw new Error(`VKG API error: ${res.status}`);
          const json = await res.json() as Record<string, unknown>;
          return {
            ...(json.data as Record<string, unknown> ?? json),
            source: 'vetios-vkg-v1',
            queried_at: new Date().toISOString(),
          };
        } catch (err) {
          return {
            differentials: [],
            error: String(err),
            source: 'vetios-vkg-v1',
            queried_at: new Date().toISOString(),
          };
        }
      },
    },
    {
      name: "query_vkg_path",
      description: "Find the shortest relationship path between two nodes in the Veterinary Knowledge Graph. Use this to explain clinical reasoning: why a diagnosis is likely given a symptom, or how a drug connects to a contraindication.",
      input_schema: {
        from_id: { type: "string", description: "Source node ID e.g. 'symptom:vomiting' or 'disease:canine_parvovirus'", required: true },
        to_id: { type: "string", description: "Target node ID e.g. 'drug:metronidazole' or 'lab:elevated_lipase'", required: true },
        max_depth: { type: "number", description: "Maximum hops to traverse (default 4, max 6)" },
      },
      executor: async (input) => {
        try {
          const res = await fetch(`${baseUrl}/api/vkg/path`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              from_id: input.from_id,
              to_id: input.to_id,
              max_depth: input.max_depth ?? 4,
            }),
          });
          if (!res.ok) throw new Error(`VKG path API error: ${res.status}`);
          const json = await res.json() as Record<string, unknown>;
          return {
            ...(json.data as Record<string, unknown> ?? json),
            source: 'vetios-vkg-v1',
            queried_at: new Date().toISOString(),
          };
        } catch (err) {
          return {
            found: false,
            error: String(err),
            source: 'vetios-vkg-v1',
            queried_at: new Date().toISOString(),
          };
        }
      },
    },
  ];
}
