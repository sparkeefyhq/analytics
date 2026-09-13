import { createHmac } from 'node:crypto';
import { postHogQuery, hogqlString } from '../posthog';
import {
  COHORTS,
  type Capability,
  type Dataset,
  type Fact,
  type Member,
} from './model';

const EVENTS: Record<string, string> = {
  first_open: 'first_open',
  app_opened: 'app',
  onboarding_completed: 'onboarding',
  person_context_created: 'person',
  memory_added: 'memory',
  calendar_event_created: 'calendar',
  wingman_opened: 'wingman',
  response_started: 'message',
  response_completed: 'complete',
  response_failed: 'failed',
};
const NUMBERS = [
  'people',
  'memories',
  'seconds',
  'latency',
  'input',
  'output',
  'cost',
] as const;
const KNOWN: Capability[] = [
  'activity',
  'onboarding',
  'people',
  'memory',
  'wingman',
  'responses',
  'retries',
];
type Mapping = Member & { distinctIds: string[] };
const opaque = (value: string) =>
  `participant-${createHmac('sha256', process.env.SPARKEEFY_SESSION_SECRET!).update(value).digest('hex').slice(0, 16)}`;
const numeric = (n: unknown) =>
  n !== null && n !== '' && Number.isFinite(Number(n)) && Number(n) >= 0
    ? Number(n)
    : undefined;

/** A server-only immutable cohort manifest, reviewed before cutover. No schema writes. */
export function readMembership(raw: string): Mapping[] {
  const rows: unknown = JSON.parse(raw);
  if (!Array.isArray(rows)) throw Error('Invalid cohort manifest');
  const aliases = new Map<string, Mapping[]>(),
    participants = new Set<string>();
  return rows.map((value: unknown) => {
    if (!value || typeof value !== 'object')
      throw Error('Invalid cohort manifest');
    const row = value as Record<string, unknown>;
    if (
      typeof row.cohort !== 'string' ||
      !COHORTS.slice(1).includes(row.cohort as Member['cohort']) ||
      !Array.isArray(row.distinctIds) ||
      !row.distinctIds.length ||
      typeof row.id !== 'string' ||
      typeof row.from !== 'string' ||
      !Number.isFinite(Date.parse(row.from)) ||
      (row.to !== undefined &&
        (typeof row.to !== 'string' ||
          !Number.isFinite(Date.parse(row.to)) ||
          Date.parse(row.to) <= Date.parse(row.from))) ||
      typeof row.acquisition !== 'string' ||
      !['organic', 'referral', 'paid', 'founder', 'unknown'].includes(
        row.acquisition,
      ) ||
      typeof row.internal !== 'boolean' ||
      typeof row.test !== 'boolean' ||
      !(
        row.firstOpen === null ||
        (typeof row.firstOpen === 'string' &&
          Number.isFinite(Date.parse(row.firstOpen)))
      )
    )
      throw Error('Invalid cohort manifest');
    const member = {
      id: row.id,
      distinctIds: row.distinctIds,
      cohort: row.cohort,
      from: row.from,
      to: row.to,
      firstOpen: row.firstOpen,
      internal: row.internal,
      test: row.test,
      acquisition: row.acquisition,
    } as Mapping;
    const key = `${member.cohort}:${member.id}`;
    if (participants.has(key)) throw Error('Duplicate cohort participant');
    participants.add(key);
    for (const alias of row.distinctIds) {
      if (typeof alias !== 'string' || !alias) throw Error('Invalid identity');
      const previous = aliases.get(alias) ?? [];
      if (previous.some((m) => m.id !== member.id))
        throw Error(
          'Identity must retain the same stable participant key across cohorts',
        );
      if (
        previous.some(
          (m) =>
            Date.parse(m.from) <
              (member.to ? Date.parse(member.to) : Infinity) &&
            Date.parse(member.from) < (m.to ? Date.parse(m.to) : Infinity),
        )
      )
        throw Error('Overlapping cohort identity');
      aliases.set(alias, [...previous, member]);
    }
    return member;
  });
}

let cached: { at: number; data: Dataset } | undefined;
let pending: Promise<Dataset> | undefined;
export async function liveDataset(): Promise<Dataset> {
  if (cached && Date.now() - cached.at < 30000) return cached.data;
  if (pending) return pending;
  pending = load().finally(() => {
    pending = undefined;
  });
  const data = await pending;
  cached = { at: Date.now(), data };
  return data;
}
async function load(): Promise<Dataset> {
  const base: Dataset = {
    mode: 'live',
    state: 'not-connected',
    detail:
      'Awaiting reconciled cohort membership and v2 coverage manifest. Project-wide Phase 0 counts are not substituted.',
    asOf: new Date().toISOString(),
    coverageFrom:
      process.env.CONTROL_V2_COVERAGE_FROM || new Date().toISOString(),
    members: [],
    facts: [],
    capabilities: KNOWN,
  };
  if (
    !process.env.POSTHOG_API_KEY ||
    !process.env.CONTROL_V2_COHORTS_JSON ||
    !process.env.CONTROL_V2_COVERAGE_FROM ||
    !process.env.SPARKEEFY_SESSION_SECRET
  )
    return base;
  try {
    const mapping = readMembership(process.env.CONTROL_V2_COHORTS_JSON);
    if (!Number.isFinite(Date.parse(base.coverageFrom)))
      throw Error('Invalid coverage');
    base.members = mapping.map(({ distinctIds: _, ...m }) => ({
      ...m,
      id: opaque(m.id),
    }));
    const allowed = mapping.filter((m) => !m.internal && !m.test);
    if (!allowed.length)
      return {
        ...base,
        state: 'available',
        detail: 'Reconciled membership contains no eligible users.',
      };
    const ids = allowed.flatMap((m) => m.distinctIds);
    // Only allowlisted, non-text properties. Never SELECT properties, person properties or email.
    const query = `SELECT uuid, distinct_id, event, timestamp, properties.request_id, properties.contact_id, properties.person_count_after, properties.memory_count_after, properties.recovery_triggered, properties.is_internal, properties.is_test, properties.environment FROM events WHERE distinct_id IN (${ids.map(hogqlString).join(',')}) AND timestamp >= toDateTime(${hogqlString(base.coverageFrom)}) AND timestamp <= toDateTime(${hogqlString(base.asOf)}) AND event IN (${Object.keys(EVENTS).map(hogqlString).join(',')}) ORDER BY timestamp, uuid LIMIT 50001`;
    const rows = await postHogQuery(query);
    if (rows.length > 50000)
      throw Error(
        'Query coverage limit exceeded; add server-side pagination before increasing traffic',
      );
    const facts: Fact[] = [];
    for (const row of rows) {
      if (row.length !== 12) throw Error('Unexpected event schema');
      const [
        id,
        user,
        event,
        at,
        request,
        person,
        people,
        memories,
        recovery,
        internal,
        test,
        environment,
      ] = row;
      if (
        [true, 1, 'true'].includes(internal as string | number | boolean) ||
        [true, 1, 'true'].includes(test as string | number | boolean) ||
        (typeof environment === 'string' &&
          environment &&
          !['production', 'prod'].includes(environment))
      )
        continue;
      if (
        typeof user !== 'string' ||
        typeof event !== 'string' ||
        typeof at !== 'string' ||
        typeof id !== 'string' ||
        !Number.isFinite(Date.parse(at))
      )
        throw Error('Invalid event row');
      const member = allowed.find(
        (m) =>
          m.distinctIds.includes(user) &&
          Date.parse(at) >= Date.parse(m.from) &&
          (!m.to || Date.parse(at) < Date.parse(m.to)),
      );
      if (!member) continue;
      const owner = opaque(member.id),
        kind = EVENTS[event];
      if (!kind) throw Error('Invalid event row');
      const fact: Fact = {
        id: String(id),
        user: owner,
        kind,
        at: new Date(String(at)).toISOString(),
      };
      if (typeof request === 'string' && request)
        fact.request = createHmac('sha256', owner)
          .update(request)
          .digest('hex');
      // Merely having contact_id does not prove saved context was actually used. Capability stays unavailable.
      if (typeof person === 'string' && person)
        fact.person = createHmac('sha256', owner).update(person).digest('hex');
      fact.people = numeric(people);
      fact.memories = numeric(memories);
      for (const key of NUMBERS)
        if (fact[key] !== undefined && !Number.isFinite(fact[key]))
          throw Error('Invalid numeric property');
      facts.push(fact);
      if (
        (kind === 'complete' || kind === 'failed') &&
        (recovery === true || recovery === 1)
      )
        facts.push({
          ...fact,
          id: `retry-${fact.request ?? fact.id}`,
          kind: 'retry',
        });
    }
    // Dedup requires request IDs; partial coverage cannot silently inflate messages/success rates.
    if (
      facts.some(
        (f) => ['message', 'complete', 'failed'].includes(f.kind) && !f.request,
      )
    )
      base.capabilities = KNOWN.filter(
        (c) => c !== 'wingman' && c !== 'responses',
      );
    if (facts.some((f) => f.kind === 'person' && f.people === undefined))
      base.capabilities = base.capabilities.filter((c) => c !== 'people');
    if (facts.some((f) => f.kind === 'memory' && f.memories === undefined))
      base.capabilities = base.capabilities.filter((c) => c !== 'memory');
    return {
      ...base,
      state: 'available',
      detail: 'PostHog · reconciled identity allowlist · 30-second cache',
      facts,
    };
  } catch {
    return {
      ...base,
      state: 'query-error',
      detail:
        'V2 source query or coverage validation failed. No partial totals are shown.',
      facts: [],
    };
  }
}
