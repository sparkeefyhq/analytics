/**
 * Users tab, onboarding funnel and the Phase 1 scorecard (BENCHMARK - Phase 1, 20 users).
 * Pure functions over the filtered Dataset, like metrics.ts.
 *
 * Benchmark definitions, as close as current tracking allows:
 *  - Finish setup: reached Home at the end of onboarding within 24 h of first open.
 *  - Useful reply: acted on an overlay draft (copy, insert, or sent as-is / edited) within 48 h of
 *    first open. "Would-use" feedback is not captured yet, so draft adoption is the only evidence.
 *  - Act on a draft: any copy, insert or confirmed send of a draft.
 *  - Repeat: acted on a draft again on a later India day, within 7 days of the first useful reply.
 *    Eligible once 7 full days have passed since that first useful reply; until then it is pending.
 *    (Chats are hashed per day by design, so "a different chat" can't be checked; a later day is.)
 */
import { appLabel, buildSessions, istDay, quantile } from './metrics';
import type { Dataset, Filters, FunnelStep, Gate, RosterUser, Scorecard, Snapshot } from './types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Draft taps that never reach the model (no chat found, no reply needed, app not supported). */
const NOT_A_DRAFT = new Set(['needs_target', 'no_reply', 'unsupported']);
const IST = 5.5 * HOUR;
const t = (iso: string) => Date.parse(iso);
const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);

/** Monetization doc (6 Nov): free pilot monthly allowance. */
export const PILOT_DRAFTS = 100;
export const PILOT_ANSWERS = 40;

/** Keefie onboarding in app order (Android build 7). Unknown screens go after, by median time. */
export const SCREEN_ORDER = [
  'IntroVideo', 'Welcome', 'MeetKeefie', 'OverlayVideo', 'RelationshipSelect', 'PersonName', 'GenderSelect', 'Traits',
  'OnboardingQuestion', 'ProfilePicture', 'PhotoUpload', 'YourName', 'YourGender', 'YourAvatar', 'TryKeefie', 'StartJourney',
  'PhoneLogin', 'Otp', 'NotificationPermission', 'perm:notifications', 'Privacy', 'Permissions', 'perm:display_over_apps',
  'perm:accessibility', 'perm:accessibility_running', 'perm:battery_unrestricted', 'Pledge', 'FounderNote', 'Home',
];

const LABELS: Record<string, string> = {
  IntroVideo: 'Intro video', Welcome: 'Welcome', MeetKeefie: 'Meet Keefie', OverlayVideo: 'Overlay video',
  RelationshipSelect: 'Relationship', PersonName: 'Their name', GenderSelect: 'Their gender', Traits: 'Traits',
  OnboardingQuestion: 'Question', ProfilePicture: 'Profile picture', PhotoUpload: 'Photo upload', TryKeefie: 'Try Keefie demo',
  StartJourney: 'Start journey', PhoneLogin: 'Phone number', Otp: 'Login code', NotificationPermission: 'Notifications screen',
  Privacy: 'Privacy', Permissions: 'Permissions screen', Pledge: 'Pledge', FounderNote: 'Founder note', Home: 'Home (setup done)',
  'perm:notifications': 'Notifications on', 'perm:display_over_apps': 'Display over apps on', 'perm:accessibility': 'Accessibility on',
  'perm:accessibility_running': 'Accessibility running', 'perm:battery_unrestricted': 'Battery unrestricted',
};
export const screenLabel = (s: string) => LABELS[s] ?? s.replace(/^perm:/, '').replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');

/** Draft adoption: a copy, an insert, or a send that used the suggestion. */
const isAct = (e: Dataset['overlay'][number]) =>
  e.action === 'copied' || e.action === 'inserted' || (e.action === 'sent' && (e.sentOutcome === 'as_is' || e.sentOutcome === 'edited'));

const ENTRY_SCREENS = new Set(['IntroVideo', 'Welcome']);

/** Ids with onboarding screens in range that never show the first screen (anonymous id changed mid-way). */
export function funnelPartial(data: Dataset, filters: Filters, teamIds: Set<string>, from: number, now: number): number {
  const steps = (data.steps ?? []).filter((s) => {
    const team = s.account && teamIds.has(s.id);
    return filters.audience === 'internal' ? team : !team;
  });
  const entered = new Set(steps.filter((s) => ENTRY_SCREENS.has(s.screen)).map((s) => s.id));
  const first = new Map<string, number>();
  for (const s of steps) first.set(s.id, Math.min(first.get(s.id) ?? Infinity, t(s.ts)));
  return [...first.entries()].filter(([id, ms]) => ms >= from && ms <= now && !entered.has(id)).length;
}

/**
 * 7 Nov: people who started onboarding in range and never signed in. Before sign-in an install is only
 * an anonymous id, so a reinstall, cleared app data or a team test run without logging in each count
 * here as a real starter who dropped. Shown next to the funnel so a small cohort isn't misread.
 */
export function funnelUnlinked(data: Dataset, filters: Filters, teamIds: Set<string>, from: number, now: number): { started: number; unlinked: number } {
  const steps = (data.steps ?? []).filter((s) => {
    const team = s.account && teamIds.has(s.id);
    return filters.audience === 'internal' ? team : !team;
  });
  const entered = new Set(steps.filter((s) => ENTRY_SCREENS.has(s.screen)).map((s) => s.id));
  const first = new Map<string, { ms: number; account: boolean }>();
  for (const s of steps) {
    const cur = first.get(s.id);
    first.set(s.id, { ms: Math.min(cur?.ms ?? Infinity, t(s.ts)), account: (cur?.account ?? false) || s.account });
  }
  const started = [...first.entries()].filter(([id, v]) => v.ms >= from && v.ms <= now && entered.has(id));
  return { started: started.length, unlinked: started.filter(([, v]) => !v.account).length };
}

export function buildFunnel(data: Dataset, filters: Filters, teamIds: Set<string>, from: number, now: number): FunnelStep[] {
  const steps = (data.steps ?? []).filter((s) => {
    const team = s.account && teamIds.has(s.id);
    return filters.audience === 'internal' ? team : !team;
  });
  const first = new Map<string, number>();
  for (const s of steps) first.set(s.id, Math.min(first.get(s.id) ?? Infinity, t(s.ts)));
  // 6 Nov (Sarthak: "47% intro video?"): someone starts onboarding by reaching its first screen.
  // An id seen only mid-way (the phone's anonymous id changed during onboarding) is a piece of
  // someone already counted; it is reported apart (funnelPartial) and never inflates "started".
  const entered = new Set(steps.filter((s) => ENTRY_SCREENS.has(s.screen)).map((s) => s.id));
  const people = new Set([...first.entries()].filter(([id, ms]) => ms >= from && ms <= now && entered.has(id)).map(([id]) => id));
  const byScreen = new Map<string, Set<string>>();
  const offsets = new Map<string, number[]>();
  for (const s of steps) {
    if (!people.has(s.id)) continue;
    (byScreen.get(s.screen) ?? byScreen.set(s.screen, new Set()).get(s.screen)!).add(s.id);
    (offsets.get(s.screen) ?? offsets.set(s.screen, []).get(s.screen)!).push(t(s.ts) - (first.get(s.id) ?? 0));
  }
  if (!people.size) return [];
  const known = SCREEN_ORDER.filter((s) => byScreen.has(s));
  const extra = [...byScreen.keys()].filter((s) => !SCREEN_ORDER.includes(s)).sort((a, b) => (quantile(offsets.get(a)!, 0.5) ?? 0) - (quantile(offsets.get(b)!, 0.5) ?? 0));
  // Unknown screens slot in before Home so the funnel still ends on "setup done".
  const order = known.includes('Home') ? [...known.filter((s) => s !== 'Home'), ...extra, 'Home'] : [...known, ...extra];

  // Where people stopped: their last screen in app order, for those who never reached Home.
  const rank = new Map(order.map((s, i) => [s, i]));
  const stopped = new Map<string, number>();
  for (const id of people) {
    if (byScreen.get('Home')?.has(id)) continue;
    let last: string | null = null;
    for (const s of order) if (!s.startsWith('perm:') && byScreen.get(s)?.has(id) && (last === null || rank.get(s)! > rank.get(last)!)) last = s;
    if (last) stopped.set(last, (stopped.get(last) ?? 0) + 1);
  }
  const start = people.size;
  let prev: number | null = null;
  return order.map((screen) => {
    const reached = byScreen.get(screen)?.size ?? 0;
    const row: FunnelStep = {
      screen,
      label: screenLabel(screen),
      reached,
      pctOfStart: pct(reached, start),
      // Permissions are a side branch of the Permissions screen, so they compare to it.
      pctOfPrev: screen.startsWith('perm:') ? pct(reached, byScreen.get('Permissions')?.size ?? 0) : prev === null ? null : pct(reached, prev),
      stoppedHere: stopped.get(screen) ?? 0,
      permission: screen.startsWith('perm:'),
    };
    if (!row.permission) prev = reached;
    return row;
  });
}

interface Ctx {
  data: Dataset;
  people: Dataset['people'];
  versionOf: Map<string, string>;
  from: number;
  now: number;
}

export function buildRoster({ data, people, versionOf, from, now }: Ctx): RosterUser[] {
  const ids = new Set(people.map((p) => p.id));
  const group = <T extends { id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) if (ids.has(r.id)) (m.get(r.id) ?? m.set(r.id, []).get(r.id)!).push(r);
    return m;
  };
  const overlayBy = group(data.overlay);
  const sessionsBy = group(buildSessions(data.overlay.filter((e) => ids.has(e.id)), data.sessions.filter((s) => ids.has(s.id))));
  const stepsBy = group((data.steps ?? []).filter((s) => s.account));
  const repliesBy = group(data.chatReplies);
  const turnsBy = group(data.chatTurns ?? []);
  const hasTurns = (data.chatTurns ?? []).length > 0;
  const costBy = group(data.aiCost);
  const activityBy = group(data.activity);
  const callsBy = group(data.overlayCalls);
  const today = istDay(now);
  const monthKey = new Date(now + IST).toISOString().slice(0, 7);
  const inMonth = (iso: string) => new Date(t(iso) + IST).toISOString().slice(0, 7) === monthKey;
  const inRange = (iso: string) => t(iso) >= from && t(iso) <= now;

  const rows = people.map((p): RosterUser => {
    const events = (overlayBy.get(p.id) ?? []).sort((a, b) => t(a.ts) - t(b.ts));
    const steps = (stepsBy.get(p.id) ?? []).sort((a, b) => t(a.ts) - t(b.ts));
    const firstOpenMs = Math.min(t(p.signupAt), ...steps.map((s) => t(s.ts)));
    const home = steps.find((s) => s.screen === 'Home');
    const drafts = events.filter((e) => e.action === 'draft');
    const delivered = drafts.filter((e) => e.status === 'ok');
    const acts = events.filter(isAct);
    const firstAct = acts[0] ?? null;
    const firstReply = (repliesBy.get(p.id) ?? []).map((r) => r.at).sort()[0] ?? null;
    // Setup counts as done on Home, or (older builds without screen events) on the first reply of any kind.
    const setupAt = home?.ts ?? ([delivered[0]?.ts, firstReply].filter(Boolean).sort()[0] as string | undefined) ?? null;
    let repeatAt: string | null = null;
    let repeat: RosterUser['journey']['repeat'] = 'na';
    if (firstAct) {
      const d0 = istDay(t(firstAct.ts));
      const later = acts.find((e) => istDay(t(e.ts)) > d0 && t(e.ts) - t(firstAct.ts) <= 7 * DAY);
      if (later) {
        repeatAt = later.ts;
        repeat = 'yes';
      } else repeat = now - t(firstAct.ts) >= 7 * DAY ? 'no' : 'pending';
    }

    const r = events.filter((e) => inRange(e.ts));
    // 7 Nov: a draft is a tap that reached the model (ok or failed), the same as the overview's requests.
    // needs_target / no_reply / unsupported taps made Karan's 5 drafts show as 6 and Aniket's 1 as 2.
    const rDrafts = r.filter((e) => e.action === 'draft' && !NOT_A_DRAFT.has(e.status));
    const sent = r.filter((e) => e.action === 'sent');
    const sessions = (sessionsBy.get(p.id) ?? []).filter((s) => s.start >= from && s.start <= now);
    const shown = sessions.filter((s) => s.ok > 0);
    const tally = (values: string[]) => {
      const m = new Map<string, number>();
      for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, n }));
    };
    const calls = (callsBy.get(p.id) ?? []).filter((c) => inRange(c.at));
    const overlayCost = calls.length ? calls.reduce((a, c) => a + (c.cost ?? 0), 0) : rDrafts.reduce((a, e) => a + (e.cost ?? 0), 0);

    const activeDaySet = new Map<number, number>();
    for (const a of activityBy.get(p.id) ?? []) {
      const d = istDay(t(a.hour));
      activeDaySet.set(d, Math.max(activeDaySet.get(d) ?? 0, a.surface === 'overlay' ? 2 : 1));
    }
    const lastMs = Math.max(0, ...(activityBy.get(p.id) ?? []).map((a) => Math.min(t(a.hour) + HOUR, now)), ...events.map((e) => t(e.ts)));
    const replies = (repliesBy.get(p.id) ?? []).filter((x) => inRange(x.at));

    return {
      id: p.id,
      name: p.name,
      team: p.team,
      returning: Boolean(p.returning),
      signupAt: p.signupAt,
      version: versionOf.get(p.id) ?? null,
      lastActive: lastMs ? new Date(lastMs).toISOString() : null,
      activeDays: activeDaySet.size,
      days: Array.from({ length: 14 }, (_, i) => activeDaySet.get(today - 13 + i) ?? 0),
      journey: {
        firstOpen: new Date(firstOpenMs).toISOString(),
        setupAt,
        firstDraftAt: delivered[0]?.ts ?? null,
        firstActAt: firstAct?.ts ?? null,
        repeatAt,
        repeat,
        lastScreen: [...steps].reverse().find((s) => !s.screen.startsWith('perm:'))?.screen ?? null,
        screens: steps.filter((s) => !s.screen.startsWith('perm:')).length,
        permissions: steps.filter((s) => s.screen.startsWith('perm:')).map((s) => s.screen.slice(5)),
      },
      overlay: {
        sessions: sessions.length,
        drafts: rDrafts.length,
        delivered: rDrafts.filter((e) => e.status === 'ok').length,
        failed: rDrafts.filter((e) => e.status === 'failed').length,
        copied: r.filter((e) => e.action === 'copied').length,
        inserted: r.filter((e) => e.action === 'inserted').length,
        sent: {
          asIs: sent.filter((e) => e.sentOutcome === 'as_is').length,
          edited: sent.filter((e) => e.sentOutcome === 'edited').length,
          own: sent.filter((e) => e.sentOutcome === 'own').length,
        },
        firstTryPct: pct(shown.filter((s) => s.firstUsed).length, shown.length),
        usedPct: pct(shown.filter((s) => s.used).length, shown.length),
        medianLatency: quantile(rDrafts.filter((e) => e.status === 'ok' && e.latency).map((e) => e.latency as number), 0.5),
        cost: overlayCost,
        apps: tally(sessions.map((s) => appLabel(s.app))),
        moods: tally(rDrafts.map((e) => e.mood ?? '')),
        relationships: tally(rDrafts.map((e) => e.relationship ?? '')),
      },
      app: (() => {
        const turns = (turnsBy.get(p.id) ?? []).filter((x) => inRange(x.at));
        const count = (o: string) => (hasTurns ? turns.filter((x) => x.outcome === o).length : null);
        return {
          replies: replies.length,
          cost: (costBy.get(p.id) ?? []).filter((c) => inRange(c.at)).reduce((a, c) => a + c.cost, 0),
          // 6 Nov: every message they sent, including ones Safety answered (those save no chat row).
          messages: hasTurns ? turns.length : null,
          answered: count('answered'),
          safety: count('safety'),
          failed: count('failed'),
        };
      })(),
      quota: {
        month: monthKey,
        drafts: drafts.filter((e) => e.status === 'ok' && inMonth(e.ts)).length,
        draftCap: PILOT_DRAFTS,
        answers: (repliesBy.get(p.id) ?? []).filter((x) => inMonth(x.at)).length,
        answerCap: PILOT_ANSWERS,
      },
      flags: [],
    };
  });

  // Flags: things worth a look, per person. Heavy = top tenth of overlay drafts (at least 10).
  const draftCounts = rows.map((u) => u.overlay.drafts).sort((a, b) => a - b);
  const heavyAt = Math.max(10, quantile(draftCounts, 0.9) ?? 0);
  for (const u of rows) {
    const f = u.flags;
    const o = u.overlay;
    const share = (list: { label: string; n: number }[], keys: string[]) => {
      const total = list.reduce((a, x) => a + x.n, 0);
      return total >= 5 ? list.filter((x) => keys.includes(x.label)).reduce((a, x) => a + x.n, 0) / total : 0;
    };
    if (o.drafts >= heavyAt) f.push({ key: 'heavy', label: 'Heavy user', tone: 'purple' });
    if (share(o.relationships, ['romantic']) >= 0.6) f.push({ key: 'romantic', label: 'Mostly romantic chats', tone: 'purple' });
    if (share(o.moods, ['playful', 'bold']) >= 0.5) f.push({ key: 'flirty', label: 'Playful / bold moods', tone: 'purple' });
    const sends = o.sent.asIs + o.sent.edited + o.sent.own;
    if (sends >= 4 && (o.sent.edited + o.sent.own) / sends >= 0.5) f.push({ key: 'rewrites', label: 'Often rewrites drafts', tone: 'tan' });
    if (u.quota.drafts >= u.quota.draftCap * 0.8 || u.quota.answers >= u.quota.answerCap * 0.8) f.push({ key: 'cap', label: 'Near free cap', tone: 'red' });
    if (o.failed >= 3) f.push({ key: 'failures', label: `${o.failed} failed drafts`, tone: 'red' });
    if (!u.journey.setupAt && !u.returning && now - t(u.journey.firstOpen) > DAY)
      f.push({ key: 'stuck', label: `Stuck at ${u.journey.lastScreen ? screenLabel(u.journey.lastScreen) : 'setup'}`, tone: 'red' });
    if (u.journey.repeat === 'yes') f.push({ key: 'repeat', label: 'Repeat user', tone: 'green' });
    if (u.lastActive && now - t(u.lastActive) > 3 * DAY && u.activeDays >= 2) f.push({ key: 'dormant', label: 'Quiet 3+ days', tone: 'tan' });
  }
  return rows.sort((a, b) => (b.lastActive ?? '').localeCompare(a.lastActive ?? '') || b.signupAt.localeCompare(a.signupAt));
}

/** The four gates, scaled from the 20-person targets to the cohort size. */
export function buildScorecard(roster: RosterUser[], snap: Pick<Snapshot, 'overlay'>, overlayUsersToday: number, now: number): Scorecard {
  const cohort = roster.filter((u) => !u.returning);
  const n = cohort.length;
  const within = (u: RosterUser, at: string | null, hours: number) => at !== null && t(at) - t(u.journey.firstOpen) <= hours * HOUR;
  const gate = (key: Gate['key'], label: string, help: string, hit: number, d: number, target: number, stretch: number, pending?: number): Gate => ({
    key, label, help, n: hit, d, pct: pct(hit, d), targetPct: target, stretchPct: stretch, pass: d ? (hit / d) * 100 >= target : null,
    ...(pending === undefined ? {} : { pending }),
  });
  const firstUseful = cohort.filter((u) => within(u, u.journey.firstActAt, 48));
  const eligible = cohort.filter((u) => u.journey.firstActAt && now - t(u.journey.firstActAt) >= 7 * DAY);
  const ov = snap.overlay;
  const ms = (v: number | null) => (v === null ? '–' : `${(v / 1000).toFixed(2)}s`);
  // Repeat is read only once enough people are 7 days past their first useful reply (15 of 20),
  // and needs enough repeaters in absolute terms too (8 of 20), scaled to the cohort.
  const repeatYes = eligible.filter((u) => u.journey.repeat === 'yes').length;
  const repeatReady = n > 0 && eligible.length >= Math.ceil(n * 0.75);
  const repeatGate = gate('repeat', 'Return and act again', `Acted again on a later day within 7 days; read once ${Math.ceil(n * 0.75)}+ users are 7 days past their first useful reply and needs ${Math.ceil(n * 0.4)}+ repeaters`,
    repeatYes, eligible.length, 50, 60,
    // Acted, but 7 days have not passed yet: counted once their window closes.
    cohort.filter((u) => u.journey.firstActAt && !eligible.includes(u)).length);
  repeatGate.pass = repeatReady ? repeatGate.pass === true && repeatYes >= Math.ceil(n * 0.4) : null;
  return {
    cohort: n,
    gates: [
      gate('setup', 'Finish setup', 'Reached Home within 24 h of first open', cohort.filter((u) => within(u, u.journey.setupAt, 24)).length, n, 80, 90),
      gate('useful', 'Get a useful reply', 'Acted on a draft within 48 h of first open', firstUseful.length, n, 75, 85),
      gate('acted', 'Act on a draft', 'Copied, inserted or sent a draft', cohort.filter((u) => u.journey.firstActAt).length, n, 60, 70),
      repeatGate,
    ],
    diagnostics: [
      { key: 'dou', label: 'Daily overlay users', value: String(overlayUsersToday), target: '4–6', ok: overlayUsersToday >= 4 ? true : null, help: 'Unique users with a delivered draft today (IST)' },
      { key: 'spu', label: 'Sessions per overlay day', value: ov.sessionsPerUser.value === null ? '–' : ov.sessionsPerUser.value.toFixed(1), target: '1–2', ok: ov.sessionsPerUser.value === null ? null : ov.sessionsPerUser.value >= 1, help: 'Per active overlay user per day' },
      { key: 'fda', label: 'First draft adoption', value: ov.firstReply.pct === null ? '–' : `${ov.firstReply.pct.toFixed(0)}%`, target: '≥50%', ok: ov.firstReply.pct === null ? null : ov.firstReply.pct >= 50, help: 'Sessions where the first draft was used' },
      { key: 'p50', label: 'Median response', value: ms(ov.latency.p50), target: '≤1.5s', ok: ov.latency.p50 === null ? null : ov.latency.p50 <= 1500, help: 'Tap to draft shown' },
      { key: 'p95', label: 'P95 response', value: ms(ov.latency.p95), target: '≤3s', ok: ov.latency.p95 === null ? null : ov.latency.p95 <= 3000, help: '95% of drafts within this time' },
      { key: 'fail', label: 'Failed requests', value: ov.failures.pct === null ? '–' : `${ov.failures.pct.toFixed(1)}%`, target: '<1%', ok: ov.failures.pct === null ? null : ov.failures.pct < 1, help: `${ov.failures.failed} of ${ov.failures.requests} requests` },
    ],
    nearCap: roster.filter((u) => u.flags.some((f) => f.key === 'cap')).length,
  };
}
