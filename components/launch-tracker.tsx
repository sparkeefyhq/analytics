'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  Pencil,
  RotateCcw,
  Save,
  Sparkles,
  Target,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import type { TrackerData, TrackerMetric, TrackerPhase } from '@/lib/tracker-types';
import { metricPassed, phaseProgress, phaseReady } from '@/lib/tracker-types';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type TrackerResponse = TrackerData & { viewerEmail?: string | null; canEdit?: boolean };

function phaseUsers(phase: TrackerPhase) {
  return phase.userMin === phase.userMax ? `${phase.userMax}` : `${phase.userMin}–${phase.userMax}`;
}

function phaseDuration(phase: TrackerPhase) {
  const amount = phase.durationMin === phase.durationMax ? `${phase.durationMax}` : `${phase.durationMin}–${phase.durationMax}`;
  return `${amount} ${phase.durationUnit}`;
}

function statusCopy(phase: TrackerPhase) {
  if (phase.status === 'complete') return 'Complete';
  if (phaseReady(phase)) return 'Ready to advance';
  if (phase.metrics.some((metric) => metric.actual !== null && !metricPassed(metric))) return 'Needs improvement';
  return phase.status === 'active' ? 'In progress' : 'Planned';
}

function statusClass(phase: TrackerPhase) {
  const status = statusCopy(phase);
  if (status === 'Complete' || status === 'Ready to advance') return 'bg-[#eaf7ef] text-[#277551]';
  if (status === 'Needs improvement') return 'bg-[#fff0ee] text-[#b64b41]';
  if (status === 'In progress') return 'bg-[#fff3e6] text-[#a75a1c]';
  return 'bg-black/[0.045] text-muted-foreground';
}

function MetricStatus({ metric }: { metric: TrackerMetric }) {
  if (metric.actual === null) {
    return <span className="status-dot status-pending" aria-label="Pending"><Circle /></span>;
  }
  if (metricPassed(metric)) {
    return <span className="status-dot status-pass" aria-label="Passed"><Check /></span>;
  }
  return <span className="status-dot status-fail" aria-label="Below target"><X /></span>;
}

export function LaunchTracker() {
  const [data, setData] = useState<TrackerResponse | null>(null);
  const [selectedId, setSelectedId] = useState('phase-0');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TrackerPhase | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('All');

  async function load() {
    try {
      const response = await fetch('/api/tracker');
      if (!response.ok) throw new Error('Could not load launch data.');
      setData(await response.json() as TrackerResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load launch data.');
    }
  }

  useEffect(() => { void load(); }, []);

  const phase = data?.phases.find((item) => item.id === selectedId) ?? data?.phases[0];
  const canEdit = data?.canEdit === true;
  const progress = phase ? phaseProgress(phase) : { passed: 0, total: 0, percent: 0 };
  const categories = useMemo(() => phase ? ['All', ...Array.from(new Set(phase.metrics.map((metric) => metric.category)))] : ['All'], [phase]);
  const visibleMetrics = phase?.metrics.filter((metric) => filter === 'All' || metric.category === filter) ?? [];
  const activePhase = data?.phases.find((item) => item.status === 'active') ?? data?.phases.find((item) => item.status !== 'complete');
  const overallCompleted = data?.phases.filter((item) => item.status === 'complete').length ?? 0;

  async function mutate(payload: Record<string, unknown>) {
    if (!canEdit) {
      setError('This account has view-only access.');
      return false;
    }
    setSaveState('saving');
    setError('');
    try {
      const response = await fetch('/api/tracker', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as TrackerResponse & { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not save changes.');
      setData(result);
      setSaveState('saved');
      window.setTimeout(() => setSaveState('idle'), 1800);
      return true;
    } catch (caught) {
      setSaveState('error');
      setError(caught instanceof Error ? caught.message : 'Could not save changes.');
      return false;
    }
  }

  function updateMetric(id: string, field: 'target' | 'actual', value: string) {
    if (!data) return;
    const numeric = value === '' && field === 'actual' ? null : Number(value);
    setData({
      phases: data.phases.map((item) => ({
        ...item,
        metrics: item.metrics.map((metric) => metric.id === id ? { ...metric, [field]: numeric } : metric),
      })),
    });
  }

  async function saveMetric(metric: TrackerMetric) {
    await mutate({ action: 'metric', id: metric.id, patch: { target: metric.target, actual: metric.actual } });
  }

  function startEditing() {
    if (!phase || !canEdit) return;
    setDraft({ ...phase, features: [...phase.features] });
    setEditing(true);
  }

  async function savePhase() {
    if (!draft) return;
    const saved = await mutate({
      action: 'phase', id: draft.id,
      patch: {
        name: draft.name, objective: draft.objective, userMin: draft.userMin, userMax: draft.userMax,
        durationMin: draft.durationMin, durationMax: draft.durationMax, durationUnit: draft.durationUnit,
        actualUsers: draft.actualUsers, elapsedDays: draft.elapsedDays, features: draft.features, notes: draft.notes,
      },
    });
    if (saved) setEditing(false);
  }

  if (!data || !phase) {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-6">
        <div className="text-center">
          <span className="mx-auto mb-4 grid size-11 animate-pulse place-items-center rounded-2xl bg-foreground text-background"><Sparkles className="size-4" /></span>
          <p className="text-sm font-medium">{error || 'Preparing launch control…'}</p>
          {error && <Button className="mt-4" onClick={() => void load()}>Try again</Button>}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-black/[0.06] bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1480px] items-center justify-between px-5 lg:px-8">
            <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-xl bg-foreground text-background shadow-sm"><Sparkles className="size-4" /></div>
            <div><p className="text-sm font-semibold tracking-[-0.01em]">Sparkeefy</p><p className="text-[11px] text-muted-foreground">Launch control</p></div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-black/[0.06] bg-white px-3 py-1.5 text-xs text-muted-foreground shadow-sm" aria-live="polite">
              <span className={`size-1.5 rounded-full ${saveState === 'error' ? 'bg-red-500' : saveState === 'saving' ? 'animate-pulse bg-amber-500' : 'bg-emerald-500'}`} />
              {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : saveState === 'saved' ? 'Saved' : 'Shared tracker'}
            </div>
            <span className={`hidden rounded-full px-2.5 py-1.5 text-[11px] font-semibold sm:inline-flex ${canEdit ? 'bg-[#eaf7ef] text-[#277551]' : 'bg-black/[0.045] text-muted-foreground'}`}>{canEdit ? 'Editor' : 'View only'}</span>
            <div className="hidden text-right sm:block"><p className="text-xs font-semibold">{overallCompleted} of {data.phases.length} phases</p><p className="text-[10px] text-muted-foreground">completed</p></div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1480px] px-5 py-8 lg:px-8 lg:py-10">
        {error && (
          <div className="mb-5 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
            <span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss"><X className="size-4" /></button>
          </div>
        )}

        <section className="mb-7 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground"><span>Android V3</span><span>•</span><span>Validation roadmap</span></div>
            <h1 className="max-w-2xl text-3xl font-semibold tracking-[-0.045em] sm:text-[42px] sm:leading-[1.05]">Earn the right to scale.</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">{canEdit ? 'Every phase is a decision gate. Hit every metric and accomplishment before the next cohort opens.' : 'You have view-only access. Launch decisions, targets and actuals are managed by the Sparkeefy owner.'}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="lg" className="h-10 rounded-xl bg-white px-4 shadow-sm" disabled={!canEdit} onClick={startEditing}><Pencil /> Edit phase</Button>
            <Button size="lg" className="h-10 rounded-xl px-4" disabled={!canEdit || !phaseReady(phase) || phase.status === 'complete'} onClick={() => void mutate({ action: 'advance', phaseId: phase.id })}>
              {phase.status === 'complete' ? 'Phase complete' : 'Advance phase'} <ArrowRight />
            </Button>
          </div>
        </section>

        <section className="mb-7 rounded-[22px] border border-black/[0.06] bg-white px-5 py-5 shadow-[0_1px_2px_rgb(0_0_0/0.02)] lg:px-7">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div><p className="text-xs font-semibold">Launch sequence</p><p className="mt-1 text-[11px] text-muted-foreground">Current: {activePhase?.name ?? 'All phases complete'}</p></div>
            <span className="text-xs font-semibold tabular-nums">{Math.round((overallCompleted / data.phases.length) * 100)}%</span>
          </div>
          <Progress value={(overallCompleted / data.phases.length) * 100} className="[&_[data-slot=progress-track]]:h-1.5 [&_[data-slot=progress-indicator]]:bg-[#526dff]" />
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {data.phases.map((item) => (
              <button key={item.id} onClick={() => { setSelectedId(item.id); setFilter('All'); }} className={`rounded-xl border px-3 py-2.5 text-left transition ${selectedId === item.id ? 'border-[#526dff]/25 bg-[#f1f3ff]' : 'border-black/[0.06] hover:bg-black/[0.02]'}`}>
                <span className="block text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Phase {item.position}</span>
                <span className="mt-1 block truncate text-xs font-semibold">{item.status === 'complete' ? 'Complete' : item.status === 'active' ? 'Active' : 'Planned'}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="mb-7 grid gap-3 sm:grid-cols-3">
          <div className="stat-card"><span className="stat-icon bg-[#eef3ff] text-[#526dff]"><Users /></span><div><p className="stat-value">{phase.actualUsers} <span>/ {phaseUsers(phase)}</span></p><p className="stat-label">Users in cohort</p></div></div>
          <div className="stat-card"><span className="stat-icon bg-[#fff2e8] text-[#e77832]"><Clock3 /></span><div><p className="stat-value">Day {phase.elapsedDays} <span>/ {phaseDuration(phase)}</span></p><p className="stat-label">Measurement window</p></div></div>
          <div className="stat-card"><span className="stat-icon bg-[#ebf7f0] text-[#27875b]"><Check /></span><div><p className="stat-value">{progress.passed} <span>/ {progress.total}</span></p><p className="stat-label">Gates achieved</p></div></div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="h-fit rounded-[22px] border border-black/[0.06] bg-white p-3 shadow-[0_1px_2px_rgb(0_0_0/0.03),0_14px_40px_rgb(0_0_0/0.035)] xl:sticky xl:top-20">
            <div className="px-3 pb-3 pt-2"><p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Launch phases</p></div>
            <div className="space-y-1">
              {data.phases.map((item) => {
                const itemProgress = phaseProgress(item);
                return (
                  <button key={item.id} onClick={() => { setSelectedId(item.id); setFilter('All'); }} className={`phase-row ${selectedId === item.id ? 'phase-row-active' : ''}`}>
                    <span className={`phase-number ${selectedId === item.id ? 'phase-number-active' : ''}`}>{item.status === 'complete' ? <Check className="size-3.5" /> : item.position}</span>
                    <span className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-medium">{item.name.replace(/^\w+\s/, '')}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{phaseUsers(item)} users · {phaseDuration(item)}</span></span>
                    <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">{itemProgress.percent}%</span>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="space-y-5">
            <div className="overflow-hidden rounded-[22px] border border-black/[0.06] bg-white shadow-[0_1px_2px_rgb(0_0_0/0.03),0_14px_40px_rgb(0_0_0/0.035)]">
              <div className="flex flex-col gap-4 border-b border-black/[0.06] px-5 py-5 sm:flex-row sm:items-center sm:justify-between lg:px-7">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-[14px] bg-[#eef1ff] text-sm font-semibold text-[#526dff]">{phase.position}</span>
                  <div><h2 className="font-semibold tracking-[-0.02em]">{phase.name}</h2><p className="mt-0.5 max-w-2xl text-xs leading-5 text-muted-foreground">{phase.objective}</p></div>
                </div>
                <span className={`w-fit shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${statusClass(phase)}`}>{statusCopy(phase)}</span>
              </div>

              <div className="grid border-b border-black/[0.06] sm:grid-cols-3">
                <div className="phase-meta"><span>Cohort</span><strong>{phaseUsers(phase)} users</strong></div>
                <div className="phase-meta"><span>Duration</span><strong>{phaseDuration(phase)}</strong></div>
                <div className="phase-meta border-r-0"><span>Gate progress</span><strong>{progress.passed} of {progress.total} passed</strong></div>
              </div>

              <div className="border-b border-black/[0.06] px-5 py-5 lg:px-7">
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">Features in this phase</p>
                <div className="flex flex-wrap gap-2">{phase.features.map((feature) => <span key={feature} className="rounded-lg border border-black/[0.06] bg-black/[0.025] px-2.5 py-1.5 text-xs font-medium">{feature}</span>)}</div>
              </div>

              <div className="px-5 py-6 lg:px-7">
                <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                  <div><h3 className="text-sm font-semibold">Decision metrics</h3><p className="mt-1 text-xs text-muted-foreground">{canEdit ? 'Targets and actuals are editable. Changes save when you leave a field.' : 'Targets and actuals are visible to the whole team.'}</p></div>
                  <div className="flex max-w-full gap-1 overflow-x-auto pb-1">
                    {categories.map((category) => <button key={category} onClick={() => setFilter(category)} className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition ${filter === category ? 'bg-foreground text-background' : 'bg-black/[0.035] text-muted-foreground hover:text-foreground'}`}>{category}</button>)}
                  </div>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-black/[0.07]">
                  <div className="min-w-[650px]">
                    <div className="metric-grid metric-head"><span>Metric</span><span>Target</span><span>Actual</span><span className="text-right">Status</span></div>
                    {visibleMetrics.map((metric) => (
                      <div key={metric.id} className="metric-grid metric-row">
                        <div><span className="font-medium">{metric.name}</span><span className="ml-2 text-[10px] text-muted-foreground">{metric.comparator === 'lte' ? 'max' : metric.comparator === 'eq' ? 'exact' : 'min'}</span></div>
                        <label className="metric-input"><Input disabled={!canEdit} aria-label={`${metric.name} target`} type="number" step="0.1" value={metric.target} onChange={(event) => updateMetric(metric.id, 'target', event.target.value)} onBlur={() => void saveMetric(data.phases.flatMap((item) => item.metrics).find((item) => item.id === metric.id) ?? metric)} /><span>{metric.unit}</span></label>
                        <label className="metric-input"><Input disabled={!canEdit} aria-label={`${metric.name} actual`} type="number" step="0.1" value={metric.actual ?? ''} placeholder="—" onChange={(event) => updateMetric(metric.id, 'actual', event.target.value)} onBlur={() => void saveMetric(data.phases.flatMap((item) => item.metrics).find((item) => item.id === metric.id) ?? metric)} /><span>{metric.unit}</span></label>
                        <span className="flex justify-end"><MetricStatus metric={metric} /></span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[1fr_310px]">
              <div className="rounded-[22px] border border-black/[0.06] bg-white p-5 shadow-[0_1px_2px_rgb(0_0_0/0.025)] lg:p-7">
                <div className="mb-5 flex items-center justify-between"><div><h3 className="text-sm font-semibold">Phase accomplishments</h3><p className="mt-1 text-xs text-muted-foreground">Check each qualitative gate only when the team has evidence.</p></div><Target className="size-4 text-muted-foreground" /></div>
                <div className="space-y-2">
                  {phase.checks.map((item) => (
                    <label key={item.id} className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 transition ${canEdit ? 'cursor-pointer' : ''} ${item.completed ? 'border-emerald-200 bg-emerald-50/60' : 'border-black/[0.06] hover:bg-black/[0.02]'}`}>
                      <Checkbox disabled={!canEdit} checked={item.completed} onCheckedChange={(checked) => void mutate({ action: 'check', id: item.id, patch: { completed: Boolean(checked) } })} className="mt-0.5" />
                      <span className={`text-xs leading-5 ${item.completed ? 'text-emerald-800 line-through decoration-emerald-300' : ''}`}>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className={`rounded-[22px] border p-5 shadow-[0_1px_2px_rgb(0_0_0/0.025)] lg:p-6 ${phaseReady(phase) ? 'border-emerald-200 bg-[#f1faf5]' : 'border-black/[0.06] bg-white'}`}>
                <span className={`mb-4 grid size-10 place-items-center rounded-[14px] ${phaseReady(phase) ? 'bg-emerald-600 text-white' : 'bg-black/[0.04] text-muted-foreground'}`}>{phaseReady(phase) ? <CheckCircle2 className="size-4" /> : <RotateCcw className="size-4" />}</span>
                <h3 className="text-sm font-semibold">{phaseReady(phase) ? 'This phase has earned the next cohort.' : 'Keep improving this phase.'}</h3>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{phaseReady(phase) ? 'Every quantitative and qualitative gate is complete. Advance when the team agrees.' : `${progress.total - progress.passed} gates remain. Fix the product, update the evidence, and review again.`}</p>
                <Button className="mt-5 w-full rounded-xl" disabled={!canEdit || !phaseReady(phase) || phase.status === 'complete'} onClick={() => void mutate({ action: 'advance', phaseId: phase.id })}>{phase.status === 'complete' ? 'Phase complete' : 'Advance to next phase'} <ChevronRight /></Button>
              </div>
            </div>
          </div>
        </section>
      </div>

      {editing && draft && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/20 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.currentTarget === event.target) setEditing(false); }}>
          <aside className="h-full w-full max-w-[520px] overflow-y-auto border-l border-black/[0.08] bg-[#fbfaf8] p-5 shadow-2xl sm:p-7">
            <div className="mb-7 flex items-center justify-between"><div><p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Phase {draft.position}</p><h2 className="mt-1 text-xl font-semibold tracking-[-0.03em]">Edit phase</h2></div><Button variant="ghost" size="icon" onClick={() => setEditing(false)} aria-label="Close editor"><X /></Button></div>
            <div className="space-y-5">
              <label className="editor-field"><span>Phase name</span><Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
              <label className="editor-field"><span>Objective</span><textarea value={draft.objective} onChange={(event) => setDraft({ ...draft, objective: event.target.value })} className="min-h-24 w-full resize-y rounded-xl border border-input bg-white px-3 py-2.5 text-sm leading-6 outline-none transition focus:border-ring focus:ring-3 focus:ring-ring/20" /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="editor-field"><span>Minimum users</span><Input type="number" value={draft.userMin} onChange={(event) => setDraft({ ...draft, userMin: Number(event.target.value) })} /></label>
                <label className="editor-field"><span>Maximum users</span><Input type="number" value={draft.userMax} onChange={(event) => setDraft({ ...draft, userMax: Number(event.target.value) })} /></label>
                <label className="editor-field"><span>Actual users</span><Input type="number" value={draft.actualUsers} onChange={(event) => setDraft({ ...draft, actualUsers: Number(event.target.value) })} /></label>
                <label className="editor-field"><span>Elapsed days</span><Input type="number" value={draft.elapsedDays} onChange={(event) => setDraft({ ...draft, elapsedDays: Number(event.target.value) })} /></label>
                <label className="editor-field"><span>Minimum duration</span><Input type="number" value={draft.durationMin} onChange={(event) => setDraft({ ...draft, durationMin: Number(event.target.value) })} /></label>
                <label className="editor-field"><span>Maximum duration</span><Input type="number" value={draft.durationMax} onChange={(event) => setDraft({ ...draft, durationMax: Number(event.target.value) })} /></label>
              </div>
              <label className="editor-field"><span>Duration unit</span><select value={draft.durationUnit} onChange={(event) => setDraft({ ...draft, durationUnit: event.target.value })} className="h-9 w-full rounded-xl border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20"><option value="days">days</option><option value="weeks">weeks</option></select></label>
              <label className="editor-field"><span>Features · one per line</span><textarea value={draft.features.join('\n')} onChange={(event) => setDraft({ ...draft, features: event.target.value.split('\n').filter(Boolean) })} className="min-h-28 w-full resize-y rounded-xl border border-input bg-white px-3 py-2.5 text-sm leading-6 outline-none transition focus:border-ring focus:ring-3 focus:ring-ring/20" /></label>
              <label className="editor-field"><span>Team notes</span><textarea value={draft.notes} placeholder="Decisions, blockers, or learnings…" onChange={(event) => setDraft({ ...draft, notes: event.target.value })} className="min-h-28 w-full resize-y rounded-xl border border-input bg-white px-3 py-2.5 text-sm leading-6 outline-none transition focus:border-ring focus:ring-3 focus:ring-ring/20" /></label>
            </div>
            <div className="sticky bottom-0 mt-8 flex gap-2 border-t border-black/[0.06] bg-[#fbfaf8] py-4"><Button variant="outline" className="flex-1 rounded-xl bg-white" onClick={() => setEditing(false)}>Cancel</Button><Button className="flex-1 rounded-xl" onClick={() => void savePhase()}><Save /> Save changes</Button></div>
          </aside>
        </div>
      )}
    </main>
  );
}
