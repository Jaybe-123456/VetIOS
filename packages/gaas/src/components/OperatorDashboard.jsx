// ============================================================
// VetIOS GaaS — Operator Dashboard
// Tenant control plane: agents, runs, HITL queue, usage.
// ============================================================
import { useState, useEffect } from "react";

const ROLES = ["triage", "diagnostic", "treatment", "compliance", "followup", "billing"];
const STATUS_COLORS = {
  running: "#1D9E75",
  completed: "#378ADD",
  awaiting_human: "#BA7517",
  failed: "#E24B4A",
  escalated: "#D4537E",
  idle: "#888780",
};

const MOCK_RUNS = [
  { run_id: "run_001", agent_role: "diagnostic", status: "completed", patient_id: "patient_001", steps_completed: 6, started_at: "2026-04-20T09:12:00Z" },
  { run_id: "run_002", agent_role: "triage", status: "running", patient_id: "patient_002", steps_completed: 2, started_at: "2026-04-20T09:45:00Z" },
  { run_id: "run_003", agent_role: "treatment", status: "awaiting_human", patient_id: "patient_001", steps_completed: 4, started_at: "2026-04-20T10:01:00Z" },
  { run_id: "run_004", agent_role: "compliance", status: "completed", patient_id: "patient_003", steps_completed: 3, started_at: "2026-04-20T10:15:00Z" },
  { run_id: "run_005", agent_role: "followup", status: "failed", patient_id: "patient_004", steps_completed: 1, started_at: "2026-04-20T10:22:00Z" },
];

const MOCK_INTERRUPTS = [
  {
    interrupt_id: "hitl_001",
    agent_run_id: "run_003",
    reason: "Policy requires approval for: write_ehr",
    patient_id: "patient_001",
    agent_role: "treatment",
    pending_action: { tool: "write_ehr", input: { note_type: "SOAP", content: "Patient stable, parvovirus confirmed. Begin fluid therapy." } },
    created_at: "2026-04-20T10:05:00Z",
  },
];

const MOCK_USAGE = { agent_run: 42, tool_call: 187, hitl_interrupt: 3, memory_read: 312, memory_write: 89 };

function Badge({ status }) {
  const color = STATUS_COLORS[status] ?? "#888780";
  const bg = color + "22";
  return (
    <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 20, background: bg, color, border: `0.5px solid ${color}44`, letterSpacing: "0.02em" }}>
      {status.replace("_", " ")}
    </span>
  );
}

function RoleDot({ role }) {
  const colors = { triage: "#1D9E75", diagnostic: "#378ADD", treatment: "#7F77DD", compliance: "#D4537E", followup: "#BA7517", billing: "#888780" };
  return <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: colors[role] ?? "#888780", marginRight: 6 }} />;
}

function MetricCard({ label, value, unit = "" }) {
  return (
    <div style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "12px 16px", minWidth: 0 }}>
      <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 500, color: "var(--color-text-primary)" }}>{value}<span style={{ fontSize: 12, marginLeft: 3, color: "var(--color-text-secondary)" }}>{unit}</span></div>
    </div>
  );
}

function HITLCard({ interrupt, onResolve }) {
  const [resolving, setResolving] = useState(false);
  const handle = async (resolution) => {
    setResolving(true);
    await new Promise(r => setTimeout(r, 600));
    onResolve(interrupt.interrupt_id, resolution);
  };

  return (
    <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderLeft: "3px solid #BA7517", borderRadius: "var(--border-radius-lg)", padding: "16px 20px", marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 3 }}>
            <RoleDot role={interrupt.agent_role} />{interrupt.agent_role} agent · {interrupt.patient_id}
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)" }}>{interrupt.reason}</div>
        </div>
        <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{new Date(interrupt.created_at).toLocaleTimeString()}</span>
      </div>
      {interrupt.pending_action && (
        <div style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "10px 14px", marginBottom: 12, fontSize: 12, fontFamily: "var(--font-mono)" }}>
          <span style={{ color: "var(--color-text-secondary)" }}>tool: </span>
          <span style={{ color: "var(--color-text-primary)" }}>{interrupt.pending_action.tool}</span>
          <div style={{ color: "var(--color-text-secondary)", marginTop: 4, whiteSpace: "pre-wrap" }}>
            {JSON.stringify(interrupt.pending_action.input, null, 2).slice(0, 200)}
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => handle("approved")} disabled={resolving} style={{ flex: 1, padding: "7px 0", fontSize: 12, cursor: "pointer", background: "#1D9E7522", color: "#1D9E75", border: "0.5px solid #1D9E75", borderRadius: "var(--border-radius-md)" }}>
          Approve
        </button>
        <button onClick={() => handle("rejected")} disabled={resolving} style={{ flex: 1, padding: "7px 0", fontSize: 12, cursor: "pointer", background: "#E24B4A22", color: "#E24B4A", border: "0.5px solid #E24B4A", borderRadius: "var(--border-radius-md)" }}>
          Reject
        </button>
        <button onClick={() => handle("modified")} disabled={resolving} style={{ flex: 1, padding: "7px 0", fontSize: 12, cursor: "pointer", background: "var(--color-background-secondary)", color: "var(--color-text-secondary)", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)" }}>
          Modify
        </button>
      </div>
    </div>
  );
}

export default function GaaSOperatorDashboard() {
  const [tab, setTab] = useState("runs");
  const [runs, setRuns] = useState(MOCK_RUNS);
  const [interrupts, setInterrupts] = useState(MOCK_INTERRUPTS);
  const [filter, setFilter] = useState("all");
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setPulse(p => !p), 1800);
    return () => clearInterval(interval);
  }, []);

  const filteredRuns = filter === "all" ? runs : runs.filter(r => r.status === filter || r.agent_role === filter);

  const handleResolve = (interrupt_id, resolution) => {
    setInterrupts(prev => prev.filter(i => i.interrupt_id !== interrupt_id));
    if (resolution === "approved") {
      setRuns(prev => prev.map(r => r.run_id === "run_003" ? { ...r, status: "running" } : r));
    }
  };

  const tabs = [
    { id: "runs", label: "Agent Runs", count: runs.length },
    { id: "hitl", label: "HITL Queue", count: interrupts.length },
    { id: "usage", label: "Usage" },
    { id: "agents", label: "Agents" },
  ];

  return (
    <div style={{ fontFamily: "var(--font-mono)", padding: "1.5rem 0", maxWidth: 720 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--color-text-secondary)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>vetios · gaas</div>
          <div style={{ fontSize: 18, fontWeight: 500, color: "var(--color-text-primary)" }}>operator control plane</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#1D9E75" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: pulse ? "#1D9E75" : "#0F6E56", display: "inline-block", transition: "background 0.4s" }} />
          system live
        </div>
      </div>

      {/* Metrics row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: "1.5rem" }}>
        <MetricCard label="Total Runs" value={runs.length} />
        <MetricCard label="Active" value={runs.filter(r => r.status === "running").length} />
        <MetricCard label="Awaiting Review" value={interrupts.length} />
        <MetricCard label="Tool Calls" value={MOCK_USAGE.tool_call} />
        <MetricCard label="Memory Events" value={MOCK_USAGE.memory_write + MOCK_USAGE.memory_read} />
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 0, borderBottom: "0.5px solid var(--color-border-tertiary)", marginBottom: "1.25rem" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "8px 16px", fontSize: 12, cursor: "pointer", background: "none", border: "none",
            borderBottom: tab === t.id ? "2px solid var(--color-text-primary)" : "2px solid transparent",
            color: tab === t.id ? "var(--color-text-primary)" : "var(--color-text-secondary)",
            fontFamily: "var(--font-mono)",
          }}>
            {t.label}{t.count !== undefined ? ` (${t.count})` : ""}
          </button>
        ))}
      </div>

      {/* Tab: Agent Runs */}
      {tab === "runs" && (
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
            {["all", "running", "completed", "awaiting_human", "failed", ...ROLES].map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                fontSize: 11, padding: "3px 10px", borderRadius: 20, cursor: "pointer",
                background: filter === f ? "var(--color-text-primary)" : "var(--color-background-secondary)",
                color: filter === f ? "var(--color-background-primary)" : "var(--color-text-secondary)",
                border: "0.5px solid var(--color-border-tertiary)",
                fontFamily: "var(--font-mono)",
              }}>
                {f.replace("_", " ")}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filteredRuns.map(run => (
              <div key={run.run_id} style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "12px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--color-text-secondary)" }}>{run.run_id}</span>
                    <Badge status={run.status} />
                  </div>
                  <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{new Date(run.started_at).toLocaleTimeString()}</span>
                </div>
                <div style={{ display: "flex", gap: 20, fontSize: 12 }}>
                  <span><RoleDot role={run.agent_role} />{run.agent_role}</span>
                  <span style={{ color: "var(--color-text-secondary)" }}>patient: {run.patient_id}</span>
                  <span style={{ color: "var(--color-text-secondary)" }}>{run.steps_completed} steps</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: HITL Queue */}
      {tab === "hitl" && (
        <div>
          {interrupts.length === 0 ? (
            <div style={{ textAlign: "center", padding: "2rem 0", color: "var(--color-text-secondary)", fontSize: 13 }}>
              No pending interrupts. All agents operating autonomously.
            </div>
          ) : (
            interrupts.map(i => <HITLCard key={i.interrupt_id} interrupt={i} onResolve={handleResolve} />)
          )}
        </div>
      )}

      {/* Tab: Usage */}
      {tab === "usage" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
          {Object.entries(MOCK_USAGE).map(([k, v]) => (
            <MetricCard key={k} label={k.replace(/_/g, " ")} value={v} />
          ))}
        </div>
      )}

      {/* Tab: Agents */}
      {tab === "agents" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
          {ROLES.map(role => {
            const roleRuns = runs.filter(r => r.agent_role === role);
            const active = roleRuns.filter(r => r.status === "running").length;
            return (
              <div key={role} style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                  <RoleDot role={role} />
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{role}</span>
                  {active > 0 && <span style={{ marginLeft: "auto", fontSize: 10, color: "#1D9E75", background: "#1D9E7522", padding: "1px 7px", borderRadius: 10 }}>{active} active</span>}
                </div>
                <div style={{ fontSize: 11, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                  <div>total runs: {roleRuns.length}</div>
                  <div>completed: {roleRuns.filter(r => r.status === "completed").length}</div>
                  <div>failed: {roleRuns.filter(r => r.status === "failed").length}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: "2rem", paddingTop: "1rem", borderTop: "0.5px solid var(--color-border-tertiary)", display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--color-text-secondary)" }}>
        <span>vetios · build v1.0 omega · gaas layer</span>
        <span>tenant: nairobi-vet-clinic · {new Date().toISOString().slice(0, 10)}</span>
      </div>
    </div>
  );
}
