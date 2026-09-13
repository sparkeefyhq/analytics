import { useEffect, useMemo, useState } from "react";
import { countdown } from "./control-state";
import "./control.css";
import "./control-polish.css";
import { Phase0Analytics, Phase0Tracking } from "./phase0";
import type { Phase0Snapshot } from "./phase0-data";
import { UsersPage } from "./users";
import { useLiveData } from "./live-data";
type ControlView = "analytics" | "plan" | "users";

type Metric = {
  id: string; name: string; target: number; actual: number | null; unit: string;
  comparator: "gte" | "lte" | "eq"; category: string; valueType?: "number" | "fraction" | "percent";
  actualDenominator?: number | null; minimumDenominator?: number | null; definition?: string;
};
type Check = { id: string; label: string; completed: boolean };
type ReleaseGate = { id: string; name: string; actual: number };
type Phase = {
  id: string; position: number; name: string; objective: string; actualUsers: number;
  userMin: number; userMax: number; durationMin: number; durationMax: number; durationUnit: string;
  elapsedDays: number; status: string; startedAt?: string | null; updatedAt?: string; metrics: Metric[]; checks: Check[];
};
type Aggregate = { numerator: number | null; denominator: number | null; definition: string; source: string };
type Analytics = {
  phase0?: Phase0Snapshot;
  updatedAt: string | null;
  source: { name: string; status: string; description: string };
  cohorts: { id: string; label: string; available: boolean }[];
  users: { registered: number | null; active: number | null; series: null; reason: string };
  funnel: { key: string; label: string; value: number | null; definition: string }[];
  activation: Record<string, Aggregate>;
  retention: { app: null; wingman: null; meaningfulWingman: null; organicSituation: null; organicAttributed: Aggregate; reason: string };
  quality: { usefulness: { yes: number; abit: number | null; no: number; unrated: number }; responseSuccess: null; failures: null; retries: null; fallbacks: null; incomplete: null };
  reliability: null;
  aiCost: null;
};
export type ControlTracker = {
  phases: Phase[]; canEdit: boolean; viewerEmail: string | null;
  releaseGates?: ReleaseGate[];
  phase0Unmet?: string[];
  phase1?: { phase1AReady: boolean; phase1BUnlocked: boolean; phase1Unmet: string[]; decision1A: string | null; finalDecision: string | null };
  analytics?: Analytics;
};

const metricPasses = (metric: Metric) => {
  if (metric.actual === null) return false;
  if (metric.valueType === "percent") {
    if (!metric.actualDenominator || (metric.minimumDenominator && metric.actualDenominator < metric.minimumDenominator)) return false;
    return metric.actual / metric.actualDenominator * 100 >= metric.target;
  }
  return metric.comparator === "eq" ? metric.actual === metric.target : metric.comparator === "lte" ? metric.actual <= metric.target : metric.actual >= metric.target;
};
const pct = (value: number | null) => value === null ? "No data yet" : `${value.toFixed(1)}%`;
const value = (number: number | null) => number === null ? "—" : number.toLocaleString();
const unavailableAnalytics: Analytics = {
  updatedAt: null,
  source: { name: "Canonical analytics source", status: "unavailable", description: "The analytics aggregation endpoint is not connected to this deployed control plane." },
  cohorts: [{ id: "all", label: "All users", available: true }, { id: "phase-0", label: "Phase 0", available: false }, { id: "phase-1a", label: "Phase 1A", available: false }, { id: "phase-1b", label: "Phase 1B", available: false }],
  users: { registered: null, active: null, series: null, reason: "Active-user events are not connected to this control plane yet." },
  funnel: ["Invited", "Accepted", "Play access / installed", "Onboarding completed", "Genuine situation", "First Wingman complete", "Meaningful activation", "Useful answer", "Independent activation", "Organic second situation"].map((label, index) => ({ key: String(index), label, value: null, definition: "A canonical source is not connected." })),
  activation: Object.fromEntries(["onboarding", "meaningful", "usefulness", "independent", "organicSecond", "organicYield"].map((key) => [key, { numerator: null, denominator: null, definition: "A canonical source is not connected.", source: "Unavailable" }])),
  retention: { app: null, wingman: null, meaningfulWingman: null, organicSituation: null, organicAttributed: { numerator: null, denominator: null, definition: "A canonical source is not connected.", source: "Unavailable" }, reason: "D1/D7/D30 retention requires timestamped product events." },
  quality: { usefulness: { yes: 0, abit: null, no: 0, unrated: 0 }, responseSuccess: null, failures: null, retries: null, fallbacks: null, incomplete: null }, reliability: null, aiCost: null,
};

function ControlSidebar({ view, setView, email, onLogout, onLogin }: { view: ControlView; setView: (view: ControlView) => void; email: string | null; onLogout: () => void; onLogin: () => void }) {
  return <aside className="control-sidebar">
    <button className="control-brand" onClick={() => setView("analytics")} aria-label="Sparkeefy Control home"><img src="/sparkeefy-logo.png" alt="" width="44" height="44" /><b>Sparkeefy<small>Control</small></b></button>
    <nav aria-label="Primary navigation">
      <button className={view === "analytics" ? "control-nav active" : "control-nav"} onClick={() => setView("analytics")}><i>◫</i>Analytics</button>
      <button className={view === "plan" ? "control-nav active" : "control-nav"} onClick={() => setView("plan")}><i>✓</i>Plan</button>
      <button className={view === "users" ? "control-nav active" : "control-nav"} onClick={() => setView("users")}><i>♙</i>Users</button>
    </nav>
    <div className="control-sidebar-foot"><span className="status-dot" />{email ? "Secure internal workspace" : "Public dashboard"}<small>{email || "View-only"}</small>{email && <button onClick={onLogout}>Sign out</button>}</div>
  </aside>;
}

function MetricRing({ label, percent, detail }: { label: string; percent: number | null; detail?: string }) {
  const available = percent !== null && Number.isFinite(percent);
  const circumference = 2 * Math.PI * 46;
  return <div className="metric-ring">
    <div className="ring-visual" aria-label={`${label}: ${available ? pct(percent) : "No data"}`}>
      <svg viewBox="0 0 112 112" aria-hidden="true">
        <circle className="ring-track" cx="56" cy="56" r="46" />
        {available && <circle className="ring-fill" cx="56" cy="56" r="46" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - Math.min(100, Math.max(0, percent!)) / 100)} />}
      </svg>
      <strong>{available ? pct(percent) : "—"}</strong>
    </div>
    <span>{label}</span>
    <small>{detail || (available ? "" : "Not connected")}</small>
  </div>;
}

function FormatMetric({ metric, canEdit, save }: { metric: Metric; canEdit: boolean; save: (action: string, patch?: Record<string, unknown>, id?: string) => Promise<void> }) {
  const [actualDraft, setActualDraft] = useState(metric.actual === null ? "" : String(metric.actual));
  const [denominatorDraft, setDenominatorDraft] = useState(metric.actualDenominator === null || metric.actualDenominator === undefined ? "" : String(metric.actualDenominator));
  const persist = () => {
    const actual = actualDraft === "" ? null : Number(actualDraft);
    const actualDenominator = denominatorDraft === "" ? null : Number(denominatorDraft);
    if (actual === metric.actual && actualDenominator === (metric.actualDenominator ?? null)) return;
    void save("metric", { target: metric.target, actual, actualDenominator }, metric.id).catch(() => {
      setActualDraft(metric.actual === null ? "" : String(metric.actual));
      setDenominatorDraft(metric.actualDenominator == null ? "" : String(metric.actualDenominator));
    });
  };
  const actual = metric.actual === null ? "—" : String(metric.actual);
  const target = metric.valueType === "percent" ? `≥${metric.target}%` : metric.comparator === "eq" ? `=${metric.target}` : metric.comparator === "lte" ? `≤${metric.target}` : `≥${metric.target}`;
  const status = metric.actual === null || (metric.valueType === "percent" && !metric.actualDenominator) ? "Waiting" : metricPasses(metric) ? "Pass" : "In progress";
  return <div className="gate-row" title={metric.definition}><div><b>{metric.name}</b></div><span>{canEdit ? <input aria-label={`${metric.name} actual`} className="metric-editor-input" type="number" min="0" value={actualDraft} placeholder="—" onChange={(event) => setActualDraft(event.target.value)} onBlur={persist} /> : actual}</span><span>{target}</span><span>{canEdit && metric.valueType === "percent" ? <input aria-label={`${metric.name} total`} className="metric-editor-input" type="number" min="0" value={denominatorDraft} placeholder="—" onChange={(event) => setDenominatorDraft(event.target.value)} onBlur={persist} /> : metric.actualDenominator ? String(metric.actualDenominator) : "—"}</span><em className={status === "Pass" ? "pass" : ""}>{status}</em></div>;
}

function PhaseClock({ phase }: { phase?: Phase }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (phase?.status !== "active") return;
    const tick = () => setNow(Date.now());
    tick();
    const interval = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", tick); };
  }, [phase?.status, phase?.startedAt]);
  const duration = (phase?.id === "phase-0" ? 3 : (phase?.durationMin || 3) * (phase?.durationUnit === "weeks" ? 7 : 1)) * 86400000;
  const time = countdown(phase?.startedAt, duration, now);
  const unavailable = !phase || phase.status === "locked" || (phase.status === "active" && !phase.startedAt);
  const clockParts = time.display.replace(/^\+/, "").match(/\d+/g) || [];
  const clockUnits = time.display.includes("d") ? ["DAY", "HR", "MIN"] : ["HR", "MIN", "SEC"];
  return <div className={`phase-clock ${time.overdue ? "overdue" : ""}`} aria-label={unavailable ? "Timer not started" : `${time.label}: ${time.display}`}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" /></svg>
    <div><span>{unavailable ? "Not started" : phase?.status === "complete" ? "Completed" : phase?.status === "ready" ? `${duration / 86400000}-day countdown` : time.label}</span>{unavailable || phase?.status === "complete" ? <time>—</time> : <time className="clock-digits" aria-label={time.display}>{time.overdue && <b className="clock-plus" aria-hidden="true">+</b>}{clockParts.map((part, index) => <span className="clock-part" key={clockUnits[index]}><b>{part}</b><small>{clockUnits[index]}</small></span>)}</time>}</div>
  </div>;
}

function PlanPage({ tracker, save, onLogin }: { onLogin: () => void; tracker: ControlTracker; save: (action: string, patch?: Record<string, unknown>, id?: string) => Promise<void> }) {
  const phase0 = tracker.phases.find((phase) => phase.id === "phase-0");
  const phase1 = tracker.phases.find((phase) => phase.id === "phase-1");
  const [selected, setSelected] = useState("phase-0");
  const [undo, setUndo] = useState<{ check: Check; phaseId: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const options = useMemo(() => [
    phase0 && { id: "phase-0", label: "Phase 0", subtitle: "Power-User Release Candidate", phase: phase0, state: phase0.status },
    phase1 && { id: "phase-1a", label: "Phase 1A", subtitle: "Wedge Discovery", phase: phase1, state: phase1.status, prefix: "phase-1a-" },
    phase1 && { id: "phase-1b", label: "Phase 1B", subtitle: "Cold Replication", phase: phase1, state: tracker.phase1?.phase1BUnlocked ? phase1.status : "locked", prefix: "phase-1b-" },
    { id: "phase-2", label: "Phase 2", subtitle: "Scale decision", phase: undefined, state: "locked" },
  ].filter(Boolean) as { id: string; label: string; subtitle: string; phase?: Phase; state: string; prefix?: string }[], [phase0, phase1, tracker.phase1?.phase1BUnlocked]);
  const current = options.find((item) => item.id === selected) || options[0];
  const phase = current?.phase;
  const scopeNotes: Record<string, { features: string; preparation: string }> = {
    "phase-0": { features: "Wingman · People · Memory · Calendar", preparation: "Android release testing. No proactive notifications." },
    "phase-1a": { features: "Same core features · User-controlled memory", preparation: "Wedge discovery. No proactive return notifications." },
    "phase-1b": { features: "Same build · Winning wedge", preparation: "Cold-cohort testing with minimal founder help." },
    "phase-2": { features: "Feature scope pending", preparation: "Decided after Phase 1 results." },
  };
  const scope = scopeNotes[current.id];
  const metrics = phase ? current.prefix ? phase.metrics.filter((metric) => metric.id.startsWith(current.prefix!)) : phase.metrics : [];
  const checks = phase ? current.prefix ? phase.checks.filter((check) => check.id.startsWith(current.prefix!)) : phase.checks : [];
  const pending = checks.filter((check) => !check.completed), complete = checks.filter((check) => check.completed);
  const gatesPassed = metrics.filter(metricPasses).length + complete.length;
  const total = metrics.length + checks.length;
  const canStart = Boolean(tracker.canEdit && phase && current.state !== "locked" && phase.status !== "active" && phase.status !== "complete");
  const unmet = current.id === "phase-0" ? tracker.phase0Unmet || [] : current.id.startsWith("phase-1") ? tracker.phase1?.phase1Unmet || [] : ["Phase 2 is not configured yet."];
  const toggle = async (check: Check, completed: boolean) => {
    if (completed) setUndo({ check, phaseId: phase!.id });
    else setUndo(null);
    try { await save("check", { completed }, check.id); }
    catch { setUndo(null); }
  };
  const startPhase = async () => {
    if (!canStart || starting || !phase) return;
    setStarting(true);
    try { await save("start", {}, phase.id); }
    catch { /* The save error is displayed by the app. */ }
    finally { setStarting(false); }
  };
  return <section className="control-page plan-page">
    <header className="control-header"><h1>Plan</h1><div className="phase-header-controls"><PhaseClock phase={phase} />{current?.state === "ready" ? <button className="phase-status ready" disabled={starting || !tracker.canEdit} title={!tracker.canEdit ? "Public view-only" : "Start phase"} onClick={() => void startPhase()}>{starting ? "Starting…" : "Ready"}</button> : <span className={`phase-status ${current?.state}`}>{current?.state === "active" ? "Active" : current?.state === "complete" ? "Completed" : "Locked"}</span>}</div></header>
    <section className="phase-overview"><div className="phase-cohort"><h2>{current?.label}</h2><div className="cohort-hero" aria-label={`${phase?.userMax ?? 0} users target`}><strong>{phase?.userMax ?? "—"}</strong><span>users</span></div></div>{scope && <div className="phase-scope"><h3>In this phase</h3><p>{scope.features}</p><small>{scope.preparation}</small></div>}</section>
    <div className="phase-stepper">{options.map((item, index) => <button key={item.id} className={`${selected === item.id ? "selected" : ""} ${item.state}`} onClick={() => setSelected(item.id)}><span>{item.state === "complete" ? "✓" : index}</span><div><b>{item.label}</b><small>{item.subtitle}</small></div><em>{item.state === "active" ? "Active" : item.state === "complete" ? "Done" : item.state === "locked" ? "Locked" : "Ready"}</em></button>)}</div>
    {!phase ? <article className="signal-card phase-placeholder"><p className="card-eyebrow">PHASE 2</p><h2>Not configured</h2><p>Phase 2 stays locked until the server-authorized Phase 1 advancement path completes. No local UI can override that decision.</p></article> : <>
      {current.id === "phase-0" && <Phase0Tracking snapshot={tracker.analytics?.phase0} target={phase.userMax} />}
      <section className="plan-actions"><div><b>{gatesPassed} / {total} complete</b><span><i style={{ width: `${total ? gatesPassed / total * 100 : 0}%` }} /></span></div><div>{phase.status !== "complete" && current.id !== "phase-1b" && <button className="control-secondary" disabled={unmet.length > 0 || !tracker.canEdit} title={unmet.length ? unmet.slice(0, 3).join(" · ") : "Advance phase"} onClick={() => { if (confirm("Confirm advancement? The server will verify every gate again.")) void save("advance", { confirmed: true }, phase.id).catch(() => {}); }}>Advance phase →</button>}</div></section>
      <section className="plan-grid"><article className="signal-card gates-card"><div className="card-row"><div><h2>Launch gates</h2><p className="p0-gates-note">Verified evidence · manual until reconciled</p></div></div><div className="gate-table"><div className="gate-row heading"><span>Metric</span><span>Count</span><span>Target</span><span title="Total users or requests evaluated">Total</span><span>Status</span></div>{metrics.map((metric) => <FormatMetric key={`${metric.id}-${metric.actual}-${metric.actualDenominator}`} metric={metric} canEdit={tracker.canEdit} save={save} />)}</div></article><article className="signal-card blockers-card"><h2>{unmet.length ? `Remaining · ${unmet.length}` : "Requirements met"}</h2>{unmet.length ? <ul>{unmet.slice(0, 8).map((item) => <li key={item}>{item}</li>)}</ul> : <p>Verified again on advancement.</p>}</article></section>
      <section className="signal-card checklist-card"><div className="card-row"><div><h2>Checklist</h2></div><span>{complete.length} / {checks.length} complete</span></div><div className="check-groups"><div>{pending.map((check) => <label className="plan-check" key={check.id}><input disabled={!tracker.canEdit} type="checkbox" checked={false} onChange={() => void toggle(check, true)} /><span>{check.label}</span></label>)}</div>{complete.length > 0 && <div className="completed-checks"><small>COMPLETED</small>{complete.map((check) => <label className="plan-check completed" key={check.id}><input disabled={!tracker.canEdit} type="checkbox" checked onChange={() => void toggle(check, false)} /><span>{check.label}</span><button type="button" className="check-undo" disabled={!tracker.canEdit} onClick={(event) => { event.preventDefault(); void toggle(check, false); }}>Undo</button></label>)}</div>}</div>{undo && <div className="undo-toast"><span>Marked complete.</span><button onClick={() => { void toggle(undo.check, false); setUndo(null); }}>Undo</button></div>}</section>
    </>}
  </section>;
}

export function ControlApp({ tracker, save, view, setView, onLogout, onLogin }: { tracker: ControlTracker; save: (action: string, patch?: Record<string, unknown>, id?: string) => Promise<void>; view: ControlView; setView: (view: ControlView) => void; onLogout: () => void; onLogin: () => void }) {
  const live = useLiveData<ControlTracker>(view === "users" ? null : "/api/tracker");
  // Analytics-only overlay: background reads never replace optimistic edits or gate evidence.
  const displayed = {...tracker, analytics: live.data ? live.data.analytics : tracker.analytics};
  return <main className="control-shell"><ControlSidebar view={view} setView={setView} email={tracker.viewerEmail} onLogout={onLogout} onLogin={onLogin} /><div className="control-main">{view !== "users" && <div className="live-refresh" role="status"><span>{live.error || (live.denied ? "Session expired" : "Checks every 30s")}</span><button onClick={live.refresh}>Refresh</button></div>}{view === "users" ? <UsersPage key={tracker.viewerEmail || "public"} allowed={tracker.canEdit} onLogin={onLogin}/> : view === "analytics" ? <Phase0Analytics snapshot={displayed.analytics?.phase0} target={tracker.phases.find(phase => phase.id === "phase-0")?.userMax ?? 15} /> : <PlanPage tracker={displayed} save={save} onLogin={onLogin} />}</div></main>;
}
