/**
 * Every number on the dashboard is computed here from the filtered Dataset.
 * Pure functions only (no I/O), so the definitions are unit-tested.
 *
 * Days are India days (IST, UTC+5:30): the team and nearly every user are in India.
 */
import type { Config } from './config';
import type {
  Dataset,
  Filters,
  OverlayUserRow,
  PlatformRow,
  Ratio,
  RetentionCell,
  RetentionRow,
  Snapshot,
} from './types';
import { buildFunnel, funnelPartial, buildRoster, buildScorecard } from './users';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const IST = 5.5 * HOUR;
/** A new overlay session starts after this much idle time (old builds send no panel id). */
export const SESSION_GAP_MS = 5 * 60_000;

export const istDay = (ms: number) => Math.floor((ms + IST) / DAY);
const dayStartMs = (day: number) => day * DAY - IST;
const t = (iso: string) => Date.parse(iso);
const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);
const ratio = (n: number, d: number): Ratio => ({ n, d, pct: pct(n, d) });
const change = (now: number | null, before: number | null) =>
  now === null || before === null || before === 0 ? null : ((now - before) / before) * 100;

export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const APPS: Record<string, string> = {
  'com.whatsapp': 'WhatsApp',
  'com.whatsapp.w4b': 'WhatsApp Business',
  'com.instagram.android': 'Instagram',
  'co.hinge.app': 'Hinge',
  'com.snapchat.android': 'Snapchat',
  'com.tinder': 'Tinder',
  'com.bumble.app': 'Bumble',
  'com.google.android.apps.messaging': 'Messages',
  'org.telegram.messenger': 'Telegram',
  'com.facebook.orca': 'Messenger',
  'com.linkedin.android': 'LinkedIn',
  'com.google.android.gm': 'Gmail',
};
export const appLabel = (pkg: string) => APPS[pkg] ?? (pkg ? pkg : 'Unknown');

export interface Session {
  id: string;
  start: number;
  end: number;
  app: string;
  requests: number;
  ok: number;
  failed: number;
  used: boolean;
  firstUsed: boolean;
  useActions: number;
  events: number;
  cost: number;
  taps: number | null;
}

/** Groups a user's overlay events into bubble sessions (panel id when present, else 5-minute idle gap). */
export function buildSessions(overlay: Dataset['overlay'], summaries: Dataset['sessions']): Session[] {
  const byUser = new Map<string, Dataset['overlay']>();
  for (const e of overlay) {
    const list = byUser.get(e.id);
    if (list) list.push(e);
    else byUser.set(e.id, [e]);
  }
  const summaryByPanel = new Map(summaries.filter((s) => s.panel).map((s) => [`${s.id}|${s.panel}`, s]));
  const out: Session[] = [];
  for (const [id, events] of byUser) {
    events.sort((a, b) => t(a.ts) - t(b.ts));
    let current: (Session & { panel: string; draftsBeforeUse: number }) | null = null;
    const close = () => {
      if (!current) return;
      const summary = current.panel ? summaryByPanel.get(`${id}|${current.panel}`) : undefined;
      if (summary) {
        if (summary.taps !== null) current.taps = summary.taps;
        if (summary.firstTry !== null) current.firstUsed = summary.firstTry && (summary.used ?? current.used);
        if (summary.used !== null) current.used = summary.used;
        if (!current.app && summary.app) current.app = summary.app;
      }
      const { panel: _panel, draftsBeforeUse: _d, ...session } = current;
      out.push(session);
      current = null;
    };
    for (const e of events) {
      const at = t(e.ts);
      const newPanel = current && e.panel && current.panel && e.panel !== current.panel;
      if (!current || newPanel || at - current.end > SESSION_GAP_MS) {
        close();
        current = {
          id, start: at, end: at, app: e.app, requests: 0, ok: 0, failed: 0, used: false, firstUsed: false,
          useActions: 0, events: 0, cost: 0, taps: null, panel: e.panel, draftsBeforeUse: 0,
        };
      }
      const s = current!;
      s.end = at;
      s.events += 1;
      s.cost += e.cost ?? 0;
      if (!s.app && e.app) s.app = e.app;
      if (!s.panel && e.panel) s.panel = e.panel;
      if (e.action === 'draft') {
        s.requests += 1;
        if (e.status === 'ok') s.ok += 1;
        if (e.status === 'failed') s.failed += 1;
        if (!s.used) s.draftsBeforeUse += 1;
      } else if (e.action === 'inserted' || e.action === 'copied' || e.action === 'sent') {
        if (e.action !== 'sent') s.useActions += 1;
        if (!s.used) {
          s.used = true;
          s.firstUsed = s.draftsBeforeUse <= 1;
        }
      }
    }
    close();
  }
  for (const s of out) if (s.taps === null) s.taps = s.events;
  return out.sort((a, b) => a.start - b.start);
}

export interface OverlayRequest {
  id: string;
  at: number;
  ok: boolean;
  failed: boolean;
  latency: number | null;
  /** null = no cost recorded (PostHog drafts before 1 Nov); valued at the recorded average. */
  cost: number | null;
}

/**
 * One row per overlay reply request, from the best source for each period:
 * the backend's ai_call_telemetry (every model call, real cost; retries of one request are merged)
 * from its first row onwards, and PostHog draft events only for the time before that.
 */
export function buildRequests(data: Dataset, ids: Set<string>): OverlayRequest[] {
  const calls = data.overlayCalls.filter((c) => ids.has(c.id));
  const byRequest = new Map<string, Dataset['overlayCalls']>();
  for (const c of calls) {
    const list = byRequest.get(c.request);
    if (list) list.push(c);
    else byRequest.set(c.request, [c]);
  }
  const out: OverlayRequest[] = [];
  for (const list of byRequest.values()) {
    const okCall = list.find((c) => c.ok);
    const costs = list.map((c) => c.cost).filter((c): c is number => c !== null);
    out.push({
      id: list[0].id,
      at: Math.min(...list.map((c) => t(c.at))),
      ok: Boolean(okCall),
      failed: !okCall,
      latency: okCall?.latency ?? null,
      cost: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
    });
  }
  const backendFrom = data.sources.overlayCallsFrom ? t(data.sources.overlayCallsFrom) : Infinity;
  for (const e of data.overlay) {
    if (e.action !== 'draft' || !ids.has(e.id) || t(e.ts) >= backendFrom) continue;
    if (e.status !== 'ok' && e.status !== 'failed') continue; // needs_target / no_reply / unsupported never reach the model
    out.push({ id: e.id, at: t(e.ts), ok: e.status === 'ok', failed: e.status === 'failed', latency: e.latency, cost: e.cost });
  }
  return out.sort((a, b) => a.at - b.at);
}

function windowFor(filters: Filters, now: number, dataStart: string) {
  const startAll = Date.parse(`${dataStart}T00:00:00+05:30`);
  if (filters.range === 'all') return { from: startAll, prevFrom: null as number | null, label: 'All time' };
  const days = filters.range === '7d' ? 7 : 30;
  const from = Math.max(now - days * DAY, startAll);
  return { from, prevFrom: from - days * DAY, label: `Last ${days} days` };
}

export function computeSnapshot(data: Dataset, filters: Filters, cfg: Pick<Config, 'infraMonthlyUsd' | 'revenueMonthlyUsd' | 'costTargetPerMau' | 'onboardingBenchmark' | 'latencySlaMs' | 'failureSlaPct'>, now = Date.now()): Snapshot {
  const versionOf = new Map(data.versions.map((v) => [v.id, v.version]));
  const versions = [...new Set(data.versions.filter((v) => /^\d+(\.\d+)*$/.test(v.version)).map((v) => v.version))].sort((a, b) =>
    b.localeCompare(a, undefined, { numeric: true }),
  );
  const people = data.people.filter(
    (p) =>
      p.team === (filters.audience === 'internal') &&
      (filters.version === 'all' || versionOf.get(p.id) === filters.version),
  );
  const ids = new Set(people.map((p) => p.id));
  const names = new Map(people.map((p) => [p.id, p.name]));
  const { from, prevFrom, label } = windowFor(filters, now, data.dataStart);
  const rangeDays = Math.max(1, (now - from) / DAY);

  const surfaceOk = (s: 'overlay' | 'app') => filters.surface === 'combined' || filters.surface === (s === 'overlay' ? 'overlay' : 'app');
  const activity = data.activity.filter((a) => ids.has(a.id) && surfaceOk(a.surface));
  const activeBetween = (a: number, b: number, surface?: 'overlay' | 'app') => {
    const set = new Set<string>();
    for (const r of activity) {
      const h = t(r.hour);
      // An hour bucket counts if it overlaps the window.
      if (h + HOUR > a && h < b && (!surface || r.surface === surface)) set.add(r.id);
    }
    return set;
  };

  // Engagement: trailing windows, independent of the range picker (as labelled on the cards).
  const dauSet = activeBetween(now - DAY, now);
  const dauPrev = activeBetween(now - 2 * DAY, now - DAY).size;
  const wau = activeBetween(now - 7 * DAY, now).size;
  const mau = activeBetween(now - 30 * DAY, now).size;

  // Overlay sessions for this audience.
  const overlayEvents = data.overlay.filter((e) => ids.has(e.id));
  const sessions = buildSessions(overlayEvents, data.sessions.filter((s) => ids.has(s.id)));
  const inRange = (ms: number) => ms >= from && ms <= now;
  const inPrev = (ms: number) => prevFrom !== null && ms >= prevFrom && ms < from;
  const rangeSessions = sessions.filter((s) => inRange(s.start));
  const prevSessions = sessions.filter((s) => inPrev(s.start));

  const frequency = (list: typeof sessions) => {
    const userDays = new Set(list.map((s) => `${s.id}|${istDay(s.start)}`));
    return userDays.size ? list.length / userDays.size : null;
  };
  const freqNow = frequency(rangeSessions);
  const freqPrev = prevFrom === null ? null : frequency(prevSessions);

  // Cost: overlay reply requests + in-app model calls (backend telemetry); never double counted.
  const firstDay = istDay(from);
  const lastDay = istDay(now);
  const requests = buildRequests(data, ids);
  // Requests with no recorded cost (before cost tracking) are valued at the recorded average.
  const costed = requests.filter((r) => r.cost !== null);
  const avgRequestCost = costed.length ? costed.reduce((a, r) => a + (r.cost as number), 0) / costed.length : 0;
  const requestCost = (r: OverlayRequest) => (r.cost !== null ? r.cost : r.ok ? avgRequestCost : 0);
  const dailyModel = new Map<number, number>();
  let estimatedCost = false;
  for (const r of requests) {
    if (!inRange(r.at)) continue;
    if (r.cost === null && r.ok) estimatedCost = true;
    dailyModel.set(istDay(r.at), (dailyModel.get(istDay(r.at)) ?? 0) + requestCost(r));
  }
  for (const c of data.aiCost) {
    if (!ids.has(c.id) || !inRange(t(c.at))) continue;
    const day = istDay(t(c.at));
    dailyModel.set(day, (dailyModel.get(day) ?? 0) + c.cost);
  }
  const modelUsd = [...dailyModel.values()].reduce((a, b) => a + b, 0);
  const infraUsd = (cfg.infraMonthlyUsd * rangeDays) / 30;
  const rangeActive = activeBetween(from, now).size;
  const perActiveUser = rangeActive ? (modelUsd + infraUsd) / rangeActive : null;
  const series: number[] = [];
  for (let d = firstDay; d <= lastDay; d += 1) {
    const active = activeBetween(dayStartMs(d), dayStartMs(d + 1)).size;
    series.push(active ? ((dailyModel.get(d) ?? 0) + cfg.infraMonthlyUsd / 30) / active : 0);
  }
  const revenue = (cfg.revenueMonthlyUsd * rangeDays) / 30;
  const grossMarginPct = revenue > 0 ? ((revenue - modelUsd - infraUsd) / revenue) * 100 : null;

  // Onboarding: accounts that signed up in the range and reached a first reply (chat or overlay).
  const firstReply = new Set<string>();
  for (const r of data.chatReplies) firstReply.add(r.id);
  for (const e of data.overlay) if (e.action === 'draft' && e.status === 'ok') firstReply.add(e.id);
  const signups = people.filter((p) => !p.returning && inRange(t(p.signupAt)));
  const completed = signups.filter((p) => firstReply.has(p.id));
  const dropped = signups.filter((p) => !firstReply.has(p.id));
  const lastScreen = new Map(data.onboarding.map((o) => [o.id, o.screen]));
  const dropCounts = new Map<string, number>();
  for (const p of dropped) {
    const s = lastScreen.get(p.id);
    if (s) dropCounts.set(s, (dropCounts.get(s) ?? 0) + 1);
  }
  const dropSteps = [...dropCounts.entries()].sort((a, b) => b[1] - a[1]).map(([step, count]) => ({ step, count }));
  const unknownDrops = dropped.length - dropSteps.reduce((a, d) => a + d.count, 0);
  if (unknownDrops > 0) dropSteps.push({ step: '', count: unknownDrops });
  const topDropStep = dropSteps.find((d) => d.step)?.step ?? null;

  // Reply use: of sessions where Keefie showed a reply, how many ended with it inserted/copied.
  const shown = rangeSessions.filter((s) => s.ok > 0);
  const usedSessions = shown.filter((s) => s.used).length;
  const firstUsedNow = shown.filter((s) => s.firstUsed).length;
  const prevShown = prevSessions.filter((s) => s.ok > 0);
  const firstPrevPct = prevFrom === null ? null : pct(prevShown.filter((s) => s.firstUsed).length, prevShown.length);

  // Retention by signup week (Monday-start IST weeks), D1 / D7 / D14 windows from each user's signup day.
  const activeDays = new Map<string, Set<number>>();
  for (const r of activity) {
    const set = activeDays.get(r.id) ?? new Set<number>();
    set.add(istDay(t(r.hour)));
    activeDays.set(r.id, set);
  }
  const today = istDay(now);
  const weekOf = (day: number) => day - ((day + 3) % 7); // epoch day 0 was a Thursday; Monday-start weeks
  const cohorts = new Map<number, typeof people>();
  for (const p of people) {
    if (p.returning) continue; // signed up before the analytics reset: active, but not a cohort member
    const day = istDay(t(p.signupAt));
    if (dayStartMs(weekOf(day) + 7) <= from && filters.range !== 'all') continue;
    const list = cohorts.get(weekOf(day)) ?? [];
    list.push(p);
    cohorts.set(weekOf(day), list);
  }
  const windowCell = (members: typeof people, startOffset: number, endOffset: number, weekStart: number): RetentionCell => {
    let n = 0;
    let d = 0;
    let anyStarted = false;
    for (const p of members) {
      const s = istDay(t(p.signupAt));
      if (s + startOffset <= today) anyStarted = true;
      if (s + endOffset >= today) continue; // window not finished yet
      d += 1;
      const days = activeDays.get(p.id);
      let hit = false;
      for (let x = s + startOffset; x <= s + endOffset && !hit; x += 1) hit = Boolean(days?.has(x));
      if (hit) n += 1;
    }
    if (d === members.length && d > 0) return { kind: 'value', n, d, pct: (n / d) * 100 };
    if (anyStarted) return { kind: 'pending', note: 'In Window' };
    const elapsed = today - weekStart;
    return { kind: 'pending', note: elapsed >= 0 && elapsed < startOffset ? `Day ${elapsed}` : 'Future' };
  };
  const fmtDay = (day: number) =>
    new Date(dayStartMs(day) + IST).toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' });
  const rows: RetentionRow[] = [...cohorts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([week, members], index) => {
      const current = week + 6 >= today;
      const d1 = windowCell(members, 1, 1, week);
      const d7 = windowCell(members, 7, 13, week);
      const d14 = windowCell(members, 14, 20, week);
      return {
        label: `Week ${index + 1} (${fmtDay(week)} - ${current ? 'Current' : fmtDay(week + 6)})`,
        start: new Date(dayStartMs(week)).toISOString(),
        users: members.length,
        d1,
        d7,
        d14,
        state: current ? 'Active Intake' : d14.kind === 'value' ? 'Settled' : 'Measuring',
      };
    });
  let d1n = 0;
  let d1d = 0;
  for (const r of rows) if (r.d1.kind === 'value') { d1n += r.d1.n; d1d += r.d1.d; }

  // Overlay performance.
  const drafts = requests.filter((r) => inRange(r.at));
  // Latency and failures are what the user experiences: PostHog draft events (tap to reply on screen,
  // a failure the user saw). Backend telemetry measures one model call and counts retried attempts,
  // so it is used for these two only when PostHog has no rows.
  const userFacing: OverlayRequest[] = data.sources.posthogAt
    ? overlayEvents
        .filter((e) => e.action === 'draft' && (e.status === 'ok' || e.status === 'failed'))
        .map((e) => ({ id: e.id, at: t(e.ts), ok: e.status === 'ok', failed: e.status === 'failed', latency: e.latency, cost: e.cost }))
    : requests;
  const userFacingInRange = userFacing.filter((r) => inRange(r.at));
  const okLatency = (list: OverlayRequest[]) => list.filter((r) => r.ok && r.latency !== null && r.latency > 0).map((r) => r.latency as number);
  const latencies = okLatency(userFacingInRange);
  const latencySeries: { hour: string; p95: number | null }[] = [];
  const hourNow = Math.floor(now / HOUR) * HOUR;
  for (let h = hourNow - 23 * HOUR; h <= hourNow; h += HOUR) {
    latencySeries.push({ hour: new Date(h).toISOString(), p95: quantile(okLatency(userFacing.filter((r) => r.at >= h && r.at < h + HOUR)), 0.95) });
  }
  const overlayCost = drafts.reduce((a, r) => a + requestCost(r), 0);
  const trackedDrafts = drafts.filter((r) => r.cost !== null);
  const perRequest = trackedDrafts.length ? trackedDrafts.reduce((a, r) => a + (r.cost as number), 0) / trackedDrafts.length : null;
  const prevTracked = requests.filter((r) => r.cost !== null && inPrev(r.at));
  const prevPerRequest = prevTracked.length ? prevTracked.reduce((a, r) => a + (r.cost as number), 0) / prevTracked.length : null;
  const failed = userFacingInRange.filter((r) => r.failed).length;

  const byApp = new Map<string, { users: Set<string>; requests: number }>();
  for (const s of rangeSessions) {
    const entry = byApp.get(s.app) ?? { users: new Set<string>(), requests: 0 };
    entry.users.add(s.id);
    entry.requests += s.requests;
    byApp.set(s.app, entry);
  }
  const totalRequests = drafts.length;
  const appRequests = [...byApp.values()].reduce((a, v) => a + v.requests, 0);
  const platforms: PlatformRow[] = [...byApp.entries()]
    .filter(([, v]) => v.requests > 0 || v.users.size > 0)
    .map(([key, v]) => ({ key, label: appLabel(key), users: v.users.size, requests: v.requests, share: appRequests ? (v.requests / appRequests) * 100 : 0 }))
    .sort((a, b) => b.requests - a.requests || b.users - a.users);

  const todayStart = dayStartMs(today);
  const todaySessions = sessions.filter((s) => s.start >= todayStart);
  const tapValues = rangeSessions.map((s) => s.taps ?? 0);

  const perUser = new Map<string, { sessions: number; requests: number; used: number; apps: Map<string, number>; last: number }>();
  for (const s of rangeSessions) {
    const u = perUser.get(s.id) ?? { sessions: 0, requests: 0, used: 0, apps: new Map(), last: 0 };
    u.sessions += 1;
    u.requests += s.requests;
    u.used += Math.min(s.useActions || (s.used ? 1 : 0), Math.max(s.requests, s.used ? 1 : 0));
    u.apps.set(s.app, (u.apps.get(s.app) ?? 0) + 1);
    u.last = Math.max(u.last, s.end);
    perUser.set(s.id, u);
  }
  const users: OverlayUserRow[] = [...perUser.entries()]
    .map(([id, u]) => ({
      id,
      name: names.get(id) ?? null,
      sessions: u.sessions,
      requests: u.requests,
      used: u.used,
      usedPct: pct(u.used, u.requests),
      app: appLabel([...u.apps.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''),
      lastActive: new Date(u.last).toISOString(),
    }))
    .sort((a, b) => b.lastActive.localeCompare(a.lastActive));

  const allVersions = versions;
  // The build most of this audience is on (not simply the highest number, which may be a test build).
  const versionCounts = new Map<string, number>();
  const recentlyActive = activeBetween(now - 30 * DAY, now);
  for (const p of people) {
    if (!recentlyActive.has(p.id)) continue; // the build people use now, not the one churned users last had
    const v = versionOf.get(p.id);
    if (v && /^\d+(\.\d+)*$/.test(v)) versionCounts.set(v, (versionCounts.get(v) ?? 0) + 1);
  }
  const mainVersion = [...versionCounts.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0], undefined, { numeric: true }))[0]?.[0] ?? null;
  const r = (x: Ratio) => x.pct;
  const todayStartMs = dayStartMs(today);
  const overlayUsersToday = new Set(overlayEvents.filter((e) => e.action === 'draft' && e.status === 'ok' && t(e.ts) >= todayStartMs).map((e) => e.id)).size;
  const teamIds = new Set(data.people.filter((p) => p.team).map((p) => p.id));
  const roster = buildRoster({ data, people, versionOf, from, now });
  const snapshot: Omit<Snapshot, 'funnel' | 'scorecard' | 'roster'> = {
    generatedAt: data.generatedAt,
    servedAt: new Date(now).toISOString(),
    stale: data.sourceError !== null,
    sources: {
      posthog: !data.sources.posthogAt ? 'down' : data.sourceError ? 'stale' : 'live',
      posthogAt: data.sources.posthogAt,
      backendAt: data.sources.backendAt,
      overlayCalls: data.sources.overlayCallsFrom ? 'backend' : 'posthog',
      ledgerFrom: data.sources.ledgerFrom ?? null,
    },
    filters,
    rangeLabel: label,
    countFrom: data.countFrom ?? null,
    versions: allVersions,
    latestVersion: mainVersion,
    people: people.length,
    overview: {
      dau: {
        value: dauSet.size,
        prev: dauPrev,
        deltaPct: change(dauSet.size, dauPrev),
        overlay: activeBetween(now - DAY, now, 'overlay').size,
        app: activeBetween(now - DAY, now, 'app').size,
      },
      wau: { value: wau, pctOfMau: pct(wau, mau) },
      mau: { value: mau, dauOverMau: pct(dauSet.size, mau) },
      overlayFrequency: { value: freqNow, prev: freqPrev, deltaPct: change(freqNow, freqPrev) },
      cost: { perActiveUser, modelUsd, infraUsd, activeUsers: rangeActive, series, target: cfg.costTargetPerMau, grossMarginPct, estimated: estimatedCost },
      onboarding: {
        pct: r(ratio(completed.length, signups.length)),
        completed: completed.length,
        total: signups.length,
        benchmark: cfg.onboardingBenchmark,
        dropped: dropped.length,
        topDropStep,
        dropSteps,
      },
      replyUse: { pct: pct(usedSessions, shown.length), used: usedSessions, total: shown.length, notUsed: shown.length - usedSessions },
      retention: { rows, avgD1: pct(d1n, d1d), target: 60 },
    },
    overlay: {
      sessionsPerUser: {
        value: freqNow,
        deltaPct: change(freqNow, freqPrev),
        sessionsToday: todaySessions.length,
        usersToday: new Set(todaySessions.map((s) => s.id)).size,
      },
      firstReply: {
        pct: pct(firstUsedNow, shown.length),
        deltaPts: firstPrevPct === null || !shown.length ? null : (pct(firstUsedNow, shown.length) as number) - firstPrevPct,
        used: firstUsedNow,
        total: shown.length,
      },
      latency: {
        p50: quantile(latencies, 0.5),
        p95: quantile(latencies, 0.95),
        p99: quantile(latencies, 0.99),
        slaMs: cfg.latencySlaMs,
        series: latencySeries,
      },
      cost: {
        perRequest,
        total: overlayCost,
        requests: totalRequests,
        tracked: trackedDrafts.length,
        estimated: drafts.some((r) => r.ok && r.cost === null),
        deltaPct: change(perRequest, prevPerRequest),
      },
      failures: { failed, requests: userFacingInRange.length, pct: pct(failed, userFacingInRange.length), slaPct: cfg.failureSlaPct },
      platforms,
      pairedUsers: new Set(sessions.map((s) => s.id)).size,
      taps: {
        perSession: tapValues.length ? tapValues.reduce((a, b) => a + b, 0) / tapValues.length : null,
        firstUsed: firstUsedNow,
        other: shown.length - firstUsedNow,
        total: shown.length,
      },
      users,
    },
  };
  return {
    ...snapshot,
    funnel: buildFunnel(data, filters, teamIds, from, now),
    funnelPartial: funnelPartial(data, filters, teamIds, from, now),
    scorecard: buildScorecard(roster, snapshot, overlayUsersToday, now),
    roster,
  };
}
