import type { Observation, Phase0Snapshot, TopUser } from '../posthog';
import { unavailable } from '../posthog';
import type { Capability, Dataset, Fact, Member } from './model';
import { backendDisplayNames, liveDatasetFromBackend } from './source-backend';

/**
 * The legacy Phase 0 Plan snapshot (`analytics.phase0` on GET /api/tracker),
 * rebuilt from sparkeefy-backend's Postgres facts instead of PostHog HogQL.
 * Same keys and Observation shapes the Plan page already renders, same
 * "live progress" semantics for day windows (count what has happened in the
 * elapsed part of a window; never wait for it to close), and the same rule
 * that anything without a verified source stays `unavailable` rather than
 * being approximated.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const IST_OFFSET_MS = 5.5 * HOUR;
const ACTIVE_KINDS = new Set([
  'first_open',
  'onboarding',
  'person',
  'memory',
  'wingman',
  'message',
  'calendar',
]);

type Facts = Map<string, Fact[]>;

function group(data: Dataset): { members: Member[]; facts: Facts } {
  const members = data.members.filter((m) => !m.internal && !m.test);
  const facts: Facts = new Map(members.map((m) => [m.id, []]));
  for (const f of data.facts) {
    const list = facts.get(f.user);
    if (list) list.push(f);
  }
  return { members, facts };
}

function available(count: number, extra: Partial<Observation> = {}): Observation {
  return { count, status: 'available', source: 'backend', ...extra };
}

function usersWith(
  members: Member[],
  facts: Facts,
  pred: (f: Fact) => boolean,
): Observation {
  return available(
    members.filter((m) => (facts.get(m.id) ?? []).some(pred)).length,
  );
}

/** Unique requests: retries never multiply a message; a completion supersedes a failure. */
function requestOutcomes(facts: Facts) {
  const messages = new Set<string>(),
    complete = new Set<string>(),
    failed = new Set<string>();
  let retries = 0;
  for (const list of facts.values())
    for (const f of list) {
      const key = `${f.user}:${f.request ?? f.id}`;
      if (f.kind === 'message') messages.add(key);
      else if (f.kind === 'complete') complete.add(key);
      else if (f.kind === 'failed') failed.add(key);
      else if (f.kind === 'retry') retries++;
    }
  for (const key of complete) failed.delete(key);
  return {
    messages: messages.size,
    complete: complete.size,
    failed: failed.size,
    retries,
  };
}

/**
 * Day-N window since each user's own first open, N in 1..4 ⇒
 * [0,24h) / [24,48h) / [48,72h) / [72,96h). Numerator counts anyone who
 * already reached `minimumEvents` of `kind` inside the elapsed part of their
 * window; denominator is everyone whose window has started; `pending` is
 * everyone whose window has not started yet.
 */
export function dayWindow(
  members: Member[],
  facts: Facts,
  kind: 'wingman' | 'message',
  dayIndex: number,
  minimumEvents: number,
  now: number,
): Observation {
  let eligible = 0,
    returned = 0,
    pending = 0;
  for (const m of members) {
    if (!m.firstOpen) continue;
    const start = Date.parse(m.firstOpen) + (dayIndex - 1) * DAY,
      end = start + DAY;
    if (now < start) {
      pending++;
      continue;
    }
    eligible++;
    const seen = new Set<string>();
    for (const f of facts.get(m.id) ?? [])
      if (f.kind === kind) {
        const at = Date.parse(f.at);
        if (at >= start && at < end) seen.add(f.request ?? f.session ?? f.id);
      }
    if (seen.size >= minimumEvents) returned++;
  }
  return available(returned, { denominator: eligible, pending });
}

/** Users who sent a message on at least `minDays` distinct day-indexes inside their first 72 hours. */
export function daysActive(
  members: Member[],
  facts: Facts,
  minDays: number,
): Observation {
  let reached = 0,
    total = 0;
  for (const m of members) {
    if (!m.firstOpen) continue;
    total++;
    const first = Date.parse(m.firstOpen);
    const days = new Set<number>();
    for (const f of facts.get(m.id) ?? [])
      if (f.kind === 'message') {
        const at = Date.parse(f.at);
        if (at >= first && at < first + 72 * HOUR)
          days.add(Math.floor((at - first) / DAY));
      }
    if (days.size >= minDays) reached++;
  }
  return available(reached, { denominator: total });
}

export function istDayStart(now: number): number {
  return Math.floor((now + IST_OFFSET_MS) / DAY) * DAY - IST_OFFSET_MS;
}
export function istWeekStart(now: number): number {
  // Monday 00:00 IST.
  const day = istDayStart(now);
  const weekday = new Date(day + IST_OFFSET_MS).getUTCDay(); // 0 = Sunday
  return day - ((weekday + 6) % 7) * DAY;
}
export function istMonthStart(now: number): number {
  const d = new Date(now + IST_OFFSET_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - IST_OFFSET_MS;
}

export function activeUsers(
  members: Member[],
  facts: Facts,
  since: number,
): Observation {
  return usersWith(
    members,
    facts,
    (f) => ACTIVE_KINDS.has(f.kind) && Date.parse(f.at) >= since,
  );
}

export function topUsers(
  members: Member[],
  facts: Facts,
  names: ReadonlyMap<string, string>,
  limit = 10,
): TopUser[] {
  return members
    .map((m) => ({
      distinctId: m.id,
      email: null,
      name: names.get(m.id) ?? null,
      messageCount: new Set(
        (facts.get(m.id) ?? [])
          .filter((f) => f.kind === 'message')
          .map((f) => f.request ?? f.id),
      ).size,
    }))
    .filter((u) => u.messageCount > 0)
    .sort((a, b) => b.messageCount - a.messageCount)
    .slice(0, limit);
}

const METRIC_KEYS = [
  'first_open',
  'onboarding',
  'first_answer',
  'wingman_open_day1',
  'first_message_day1',
  'five_messages_day1',
  'person_1',
  'person_2',
  'person_3',
  'memory_1',
  'memory_2',
  'calendar_created',
  'return_open_day2',
  'return_open_day3',
  'return_open_day4',
  'return_request_day2',
  'return_request_day3',
  'return_request_day4',
  'organic_second',
  'request_days_2',
  'request_days_3',
  'person_reused',
  'memory_reused',
  'reminder_return',
  'responses_complete',
  'responses_failed',
  'responses_retried',
  'total_messages_sent',
] as const;

export function phase0SnapshotFromDataset(
  data: Dataset,
  names: ReadonlyMap<string, string>,
  now = Date.now(),
): Phase0Snapshot {
  const status: Observation['status'] =
    data.state === 'available'
      ? 'available'
      : data.state === 'query-error'
        ? 'error'
        : 'unavailable';
  if (status !== 'available') {
    const off = (): Observation => ({ count: null, status, source: 'backend' });
    return {
      version: 1,
      cohort: 'phase-0',
      updatedAt: null,
      metrics: Object.fromEntries(METRIC_KEYS.map((key) => [key, off()])),
      activeUsers: { today: off(), week: off(), month: off(), all: off() },
      topUsers: [],
    };
  }
  const { members, facts } = group(data);
  const gated = (cap: Capability, observation: () => Observation) =>
    data.capabilities.includes(cap) ? observation() : unavailable('backend');
  const outcomes = requestOutcomes(facts);
  const people = (n: number) =>
    gated('people', () =>
      usersWith(members, facts, (f) => f.kind === 'person' && (f.people ?? 0) >= n),
    );
  const memory = (n: number) =>
    gated('memory', () =>
      usersWith(members, facts, (f) => f.kind === 'memory' && (f.memories ?? 0) >= n),
    );
  const window = (kind: 'wingman' | 'message', day: number, min = 1) =>
    gated('wingman', () => dayWindow(members, facts, kind, day, min, now));
  return {
    version: 1,
    cohort: 'phase-0',
    updatedAt: data.asOf,
    metrics: {
      downloads: unavailable('play-console'),
      first_open: gated('activity', () =>
        usersWith(members, facts, (f) => f.kind === 'first_open'),
      ),
      onboarding: gated('onboarding', () =>
        usersWith(members, facts, (f) => f.kind === 'onboarding'),
      ),
      first_answer: gated('responses', () =>
        usersWith(members, facts, (f) => f.kind === 'complete'),
      ),
      wingman_open_day1: window('wingman', 1),
      first_message_day1: window('message', 1),
      five_messages_day1: window('message', 1, 5),
      person_1: people(1),
      person_2: people(2),
      person_3: people(3),
      memory_1: memory(1),
      memory_2: memory(2),
      // The backend feed carries no calendar facts yet; do not substitute.
      calendar_created: unavailable('backend'),
      return_open_day2: window('wingman', 2),
      return_open_day3: window('wingman', 3),
      return_open_day4: window('wingman', 4),
      return_request_day2: window('message', 2),
      return_request_day3: window('message', 3),
      return_request_day4: window('message', 4),
      // No verified situation / context-reuse / reminder-return signal exists
      // in the backend feed; these stay unavailable rather than inferred.
      organic_second: unavailable('backend'),
      request_days_2: gated('wingman', () => daysActive(members, facts, 2)),
      request_days_3: gated('wingman', () => daysActive(members, facts, 3)),
      person_reused: unavailable('backend'),
      memory_reused: unavailable('backend'),
      reminder_return: unavailable('backend'),
      responses_complete: gated('responses', () => available(outcomes.complete)),
      responses_failed: gated('responses', () => available(outcomes.failed)),
      responses_retried: gated('retries', () => available(outcomes.retries)),
      total_messages_sent: gated('wingman', () => available(outcomes.messages)),
    },
    activeUsers: {
      today: activeUsers(members, facts, istDayStart(now)),
      week: activeUsers(members, facts, istWeekStart(now)),
      month: activeUsers(members, facts, istMonthStart(now)),
      all: activeUsers(members, facts, -Infinity),
    },
    topUsers: topUsers(members, facts, names),
  };
}

export async function phase0SnapshotFromBackend(): Promise<Phase0Snapshot> {
  const data = await liveDatasetFromBackend();
  return phase0SnapshotFromDataset(data, backendDisplayNames());
}
