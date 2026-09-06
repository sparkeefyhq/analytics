import { FormEvent, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Comparator = 'gte' | 'lte' | 'eq';
type Metric = { id: string; phaseId: string; category: string; name: string; target: number; actual: number | null; unit: string; comparator: Comparator };
type Check = { id: string; label: string; completed: boolean };
type Phase = { id: string; position: number; name: string; objective: string; userMin: number; userMax: number; durationMin: number; durationMax: number; durationUnit: string; actualUsers: number; elapsedDays: number; status: 'active' | 'locked' | 'complete'; features: string[]; notes: string; metrics: Metric[]; checks: Check[] };
type Tracker = { phases: Phase[]; authenticated: true; viewerEmail: string | null; canEdit: boolean };

const percent = (metric: Metric) => metric.unit === '%' || metric.unit === 'pp' ? '%' : metric.unit;
const passed = (metric: Metric) => metric.actual !== null && (metric.comparator === 'lte' ? metric.actual <= metric.target : metric.comparator === 'eq' ? metric.actual === metric.target : metric.actual >= metric.target);
const isReady = (phase: Phase) => phase.metrics.every(passed) && phase.checks.every((check) => check.completed);
const users = (phase: Phase) => phase.userMin === phase.userMax ? `${phase.userMax}` : `${phase.userMin}–${phase.userMax}`;
const duration = (phase: Phase) => `${phase.durationMin === phase.durationMax ? phase.durationMax : `${phase.durationMin}–${phase.durationMax}`} ${phase.durationUnit}`;

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function signIn(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError('');
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Unable to sign in.');
      onSuccess();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to sign in.'); }
    finally { setLoading(false); }
  }

  return <main className="login"><div className="login-shade" /><div className="login-box"><div className="brand"><b>✦</b> Sparkeefy</div><section className="login-card"><span className="lock">⌁</span><small>INTERNAL WORKSPACE</small><h1>Launch control</h1><p>Sign in to view Sparkeefy’s Android V3 launch roadmap.</p><form onSubmit={signIn}><label>Email<input type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input type="password" required autoComplete="current-password" placeholder="••••••••••••" value={password} onChange={(event) => setPassword(event.target.value)} /></label>{error && <div className="error">{error}</div>}<button className="primary" disabled={loading}>{loading ? 'Checking access…' : 'Enter launch control →'}</button></form><em>Access is limited to the Sparkeefy launch team.</em></section></div><div className="login-caption">ANDROID V3 · PRODUCT VALIDATION</div></main>;
}

function App() {
  const [data, setData] = useState<Tracker | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [selectedId, setSelectedId] = useState('phase-0');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const response = await fetch('/api/tracker');
      if (response.status === 401) { setNeedsLogin(true); return; }
      if (!response.ok) throw new Error('Unable to load Launch Control.');
      setData(await response.json() as Tracker); setNeedsLogin(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to load Launch Control.'); }
  }
  useEffect(() => { void load(); }, []);

  async function save(payload: Record<string, unknown>) {
    if (!data?.canEdit) return;
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/tracker', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json() as Tracker & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Unable to save.');
      setData(result);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save.'); }
    finally { setSaving(false); }
  }
  async function logout() { await fetch('/api/auth/logout', { method: 'POST' }); setData(null); setNeedsLogin(true); }

  const phase = data?.phases.find((item) => item.id === selectedId) || data?.phases[0];
  const complete = data?.phases.filter((item) => item.status === 'complete').length || 0;
  const progress = phase ? phase.metrics.filter(passed).length + phase.checks.filter((item) => item.completed).length : 0;
  const total = phase ? phase.metrics.length + phase.checks.length : 0;
  const categories = useMemo(() => phase ? Array.from(new Set(phase.metrics.map((metric) => metric.category))) : [], [phase]);

  if (needsLogin) return <Login onSuccess={() => void load()} />;
  if (!data || !phase) return <main className="loading">{error || 'Preparing Launch Control…'}</main>;

  const patchMetric = (metric: Metric, key: 'target' | 'actual', value: string) => {
    const changed = { ...metric, [key]: key === 'actual' && value === '' ? null : Number(value) };
    setData({ ...data, phases: data.phases.map((item) => item.id === phase.id ? { ...item, metrics: item.metrics.map((candidate) => candidate.id === metric.id ? changed : candidate) } : item) });
  };
  const patchPhase = (key: keyof Phase, value: string) => {
    const numeric = ['actualUsers', 'elapsedDays'].includes(key) ? Number(value) : value;
    const changed = { ...phase, [key]: numeric };
    setData({ ...data, phases: data.phases.map((item) => item.id === phase.id ? changed : item) });
    void save({ action: 'phase', id: phase.id, patch: changed });
  };

  return <main className="app"><header><div className="brand dark"><b>✦</b><span>Sparkeefy<small>Launch control</small></span></div><div className="head-actions"><span className="sync">{saving ? 'Saving…' : 'Shared tracker'}</span><span className={`role ${data.canEdit ? 'editor' : ''}`}>{data.canEdit ? 'Editor' : 'View only'}</span><button className="link-button" onClick={() => void logout()}>Sign out</button></div></header><div className="shell">{error && <div className="error banner">{error}</div>}<section className="intro"><div><small>ANDROID V3 · VALIDATION ROADMAP</small><h1>Earn the right to scale.</h1><p>Every phase is a decision gate. Improve the product until every metric and accomplishment earns the next cohort.</p></div><div className="completed"><b>{complete} / {data.phases.length}</b><span>phases complete</span></div></section><section className="sequence"><div><b>Launch sequence</b><span>Current: {data.phases.find((item) => item.status === 'active')?.name || 'Complete'}</span></div><div className="phase-chips">{data.phases.map((item) => <button key={item.id} className={selectedId === item.id ? 'selected' : ''} onClick={() => setSelectedId(item.id)}><small>Phase {item.position}</small><b>{item.status === 'active' ? 'Active' : item.status === 'complete' ? 'Complete' : 'Planned'}</b></button>)}</div></section><section className="stats"><div><b>{phase.actualUsers} <i>/ {users(phase)}</i></b><span>Users in cohort</span></div><div><b>Day {phase.elapsedDays} <i>/ {duration(phase)}</i></b><span>Measurement window</span></div><div><b>{progress} <i>/ {total}</i></b><span>Gates achieved</span></div></section><div className="workspace"><aside><small>LAUNCH PHASES</small>{data.phases.map((item) => <button key={item.id} onClick={() => setSelectedId(item.id)} className={selectedId === item.id ? 'side-selected' : ''}><strong>{item.position}</strong><span><b>{item.name.replace(/^\w+\s/, '')}</b><em>{users(item)} users · {duration(item)}</em></span></button>)}</aside><section className="content"><article className="card"><div className="phase-title"><span>{phase.position}</span><div><h2>{phase.name}</h2><p>{phase.objective}</p></div><b className={isReady(phase) ? 'ready' : ''}>{phase.status === 'complete' ? 'Complete' : isReady(phase) ? 'Ready to advance' : 'In progress'}</b></div><div className="phase-meta"><div>Cohort<strong>{users(phase)} users</strong></div><div>Duration<strong>{duration(phase)}</strong></div><div>Gate progress<strong>{progress} of {total} passed</strong></div></div><div className="features"><small>FEATURES IN THIS PHASE</small><p>{phase.features.map((item) => <span key={item}>{item}</span>)}</p></div><div className="edit-strip"><label>Actual users<input disabled={!data.canEdit} type="number" value={phase.actualUsers} onChange={(event) => patchPhase('actualUsers', event.target.value)} /></label><label>Elapsed days<input disabled={!data.canEdit} type="number" value={phase.elapsedDays} onChange={(event) => patchPhase('elapsedDays', event.target.value)} /></label><label>Team notes<textarea disabled={!data.canEdit} value={phase.notes} placeholder="Add decisions or learnings…" onChange={(event) => patchPhase('notes', event.target.value)} /></label></div></article><article className="card metrics"><div className="section-heading"><div><h3>Decision metrics</h3><p>{data.canEdit ? 'Edit a target or actual, then leave the field to save.' : 'Targets and actuals are visible to the team.'}</p></div></div>{categories.map((category) => <div key={category} className="metric-group"><h4>{category}</h4><div className="metric-head"><span>Metric</span><span>Target</span><span>Actual</span><span>Status</span></div>{phase.metrics.filter((metric) => metric.category === category).map((metric) => <div className="metric-row" key={metric.id}><span>{metric.name}<small>{metric.comparator === 'lte' ? 'maximum' : metric.comparator === 'eq' ? 'exact' : 'minimum'}</small></span><label><input disabled={!data.canEdit} type="number" step="0.1" value={metric.target} onChange={(event) => patchMetric(metric, 'target', event.target.value)} onBlur={() => void save({ action: 'metric', id: metric.id, patch: { target: metric.target, actual: metric.actual } })} /><i>{percent(metric)}</i></label><label><input disabled={!data.canEdit} type="number" step="0.1" value={metric.actual ?? ''} placeholder="—" onChange={(event) => patchMetric(metric, 'actual', event.target.value)} onBlur={() => { const current = (data.phases.find((item) => item.id === phase.id)?.metrics.find((item) => item.id === metric.id)) || metric; void save({ action: 'metric', id: metric.id, patch: { target: current.target, actual: current.actual } }); }} /><i>{percent(metric)}</i></label><b className={metric.actual === null ? 'pending' : passed(metric) ? 'pass' : 'fail'}>{metric.actual === null ? '—' : passed(metric) ? '✓' : '×'}</b></div>)}</div>)}</article><div className="bottom-grid"><article className="card accomplishments"><div className="section-heading"><div><h3>Phase accomplishments</h3><p>Check each qualitative gate only when the team has evidence.</p></div></div>{phase.checks.map((check) => <label key={check.id} className={check.completed ? 'done' : ''}><input type="checkbox" disabled={!data.canEdit} checked={check.completed} onChange={(event) => void save({ action: 'check', id: check.id, patch: { completed: event.target.checked } })} /> <span>{check.label}</span></label>)}</article><article className={`advance ${isReady(phase) ? 'advance-ready' : ''}`}><b>{isReady(phase) ? 'This phase has earned the next cohort.' : 'Keep improving this phase.'}</b><p>{isReady(phase) ? 'Every gate is complete. Advance when the team agrees.' : `${total - progress} gates remain. Fix the product, update evidence and review again.`}</p><button className="primary" disabled={!data.canEdit || !isReady(phase) || phase.status === 'complete'} onClick={() => void save({ action: 'advance', phaseId: phase.id })}>{phase.status === 'complete' ? 'Phase complete' : 'Advance to next phase →'}</button></article></div></section></div></div></main>;
}

createRoot(document.getElementById('root')!).render(<App />);
