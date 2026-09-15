import { createHmac } from 'node:crypto';
import type { Capability, Dataset, Fact, Member } from './model';

/**
 * Direct-to-production adapter: reads sparkeefy-backend's
 * `GET /api/admin/analytics/v2` (Postgres-backed, zero PostHog) instead of
 * PostHog HogQL. Same contract as `source.ts` (returns a `Dataset`) — only
 * `model.ts` consumes this, and it was already source-agnostic.
 *
 * Unlike the PostHog-era `source.ts`, this adapter needs no hand-maintained
 * per-user manifest. The backend's own `user_profiles`/`auth.users` tables
 * are already the trustworthy identity source (one row per real human, a
 * real signup timestamp) — there is no PostHog-style alias-reconciliation
 * problem to solve here. Every real signup is included automatically, live,
 * on every request. The only two things a human still configures are:
 *
 * - `CONTROL_V2_INTERNAL_USER_IDS`: a short, comma-separated list of the
 *   team's own backend user ids to exclude (nothing in the schema marks an
 *   account as internal, so this can't be derived).
 * - `CONTROL_V2_PHASE1_FROM` / `CONTROL_V2_PHASE1B_FROM` /
 *   `CONTROL_V2_PHASE2_FROM`: the launch date of each later phase. Cohort
 *   membership is then purely a function of signup date vs these
 *   boundaries — never a per-user list to maintain.
 */

const KNOWN: Capability[] = [
  'activity',
  'app-return',
  'onboarding',
  'people',
  'memory',
  'wingman',
  'responses',
  'sessions',
  'situations',
  'activation',
  'people-use',
  'attribution',
  'retries',
  'fallbacks',
  'latency',
  'tokens',
  'cost',
];
const ATTRIBUTIONS = ['organic', 'reminder', 'founder', 'unknown'] as const;

interface BackendFact {
  user: string;
  at: string;
  kind: string;
  request?: string;
  session?: string;
  person?: string;
  situation?: string;
  people?: number;
  memories?: number;
  latency?: number;
  input?: number;
  output?: number;
  cost?: number;
  attribution?: string;
  assisted?: boolean;
}

interface BackendMember {
  id: string;
  firstOpen: string;
  name?: string | null;
}

interface BackendResponse {
  generatedAt: string;
  capabilities: string[];
  members: BackendMember[];
  facts: BackendFact[];
}

function backendConfig() {
  const baseUrl = process.env.V2_SPARKEEFY_BACKEND_URL;
  const adminKey = process.env.V2_SPARKEEFY_BACKEND_ADMIN_KEY;
  if (!baseUrl || !adminKey) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ''), adminKey };
}

async function fetchBackendAnalytics(): Promise<BackendResponse> {
  const config = backendConfig();
  if (!config) throw Error('Backend admin URL/key not configured');
  const response = await fetch(`${config.baseUrl}/api/admin/analytics/v2`, {
    headers: { 'x-admin-api-key': config.adminKey },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Error(`Backend responded ${response.status}`);
  const body = (await response.json()) as { data?: BackendResponse };
  if (!body.data || !Array.isArray(body.data.facts) || !Array.isArray(body.data.members))
    throw Error('Unexpected backend response shape');
  return body.data;
}

function internalIds(): Set<string> {
  return new Set(
    (process.env.CONTROL_V2_INTERNAL_USER_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function cohortFor(firstOpenMs: number): Member['cohort'] {
  const boundary = (name: string) => {
    const v = process.env[name];
    return v && Number.isFinite(Date.parse(v)) ? Date.parse(v) : undefined;
  };
  const phase2 = boundary('CONTROL_V2_PHASE2_FROM');
  const phase1b = boundary('CONTROL_V2_PHASE1B_FROM');
  const phase1a = boundary('CONTROL_V2_PHASE1_FROM');
  if (phase2 !== undefined && firstOpenMs >= phase2) return 'phase-2';
  if (phase1b !== undefined && firstOpenMs >= phase1b) return 'phase-1b';
  if (phase1a !== undefined && firstOpenMs >= phase1a) return 'phase-1a';
  return 'phase-0';
}

/**
 * Display names keyed by opaque participant id. Kept *outside* the Dataset so
 * `calculate()` (and every aggregate DTO) stays name-free by construction;
 * only the admin-gated `view=users` route consults this, after calculation.
 * Refreshed together with the cached dataset.
 */
let names = new Map<string, string>();
export function backendDisplayNames(): ReadonlyMap<string, string> {
  return names;
}
/**
 * Opaque participant id → backend user id, for the admin-gated conversation
 * reader only. Never exposed in any DTO; refreshed with the cached dataset.
 */
let backendIds = new Map<string, string>();
export function backendUserIdFor(participant: string): string | undefined {
  return backendIds.get(participant);
}

export async function fetchBackendConversations(userId: string): Promise<unknown> {
  const config = backendConfig();
  if (!config) throw Error('Backend admin URL/key not configured');
  const response = await fetch(
    `${config.baseUrl}/api/admin/analytics/v2/conversations?user=${encodeURIComponent(userId)}`,
    { headers: { 'x-admin-api-key': config.adminKey }, signal: AbortSignal.timeout(10000) },
  );
  if (!response.ok) throw Error(`Backend responded ${response.status}`);
  const body = (await response.json()) as { data?: unknown };
  if (!body.data) throw Error('Unexpected backend response shape');
  return body.data;
}

let cached: { at: number; data: Dataset } | undefined;
let pending: Promise<Dataset> | undefined;
export async function liveDatasetFromBackend(): Promise<Dataset> {
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
    source: 'Backend',
    state: 'not-connected',
    detail: 'Awaiting backend connection configuration.',
    asOf: new Date().toISOString(),
    coverageFrom: new Date().toISOString(),
    members: [],
    facts: [],
    capabilities: KNOWN,
  };
  if (
    !process.env.V2_SPARKEEFY_BACKEND_URL ||
    !process.env.V2_SPARKEEFY_BACKEND_ADMIN_KEY ||
    !process.env.SPARKEEFY_SESSION_SECRET
  )
    return base;
  try {
    const secret = process.env.SPARKEEFY_SESSION_SECRET;
    const opaque = (value: string) =>
      `participant-${createHmac('sha256', secret).update(value).digest('hex').slice(0, 16)}`;
    const remote = await fetchBackendAnalytics();
    const excluded = internalIds();
    const realMembers = remote.members.filter(
      (m) => typeof m.id === 'string' && Number.isFinite(Date.parse(m.firstOpen)),
    );
    if (!realMembers.length)
      return {
        ...base,
        state: 'no-data',
        detail: 'No real signups observed yet.',
      };
    const coverageFrom = new Date(
      Math.min(...realMembers.map((m) => Date.parse(m.firstOpen))),
    ).toISOString();
    const allowed = realMembers.filter((m) => !excluded.has(m.id));
    const nextNames = new Map<string, string>();
    const nextIds = new Map<string, string>();
    for (const m of realMembers) {
      const name = typeof m.name === 'string' ? m.name.trim() : '';
      if (name) nextNames.set(opaque(m.id), name);
      nextIds.set(opaque(m.id), m.id);
    }
    names = nextNames;
    backendIds = nextIds;
    base.members = realMembers.map((m) => ({
      id: opaque(m.id),
      cohort: cohortFor(Date.parse(m.firstOpen)),
      from: new Date(m.firstOpen).toISOString(),
      firstOpen: new Date(m.firstOpen).toISOString(),
      internal: excluded.has(m.id),
      test: false,
      acquisition: 'unknown',
    }));
    base.coverageFrom = coverageFrom;
    if (!allowed.length)
      return {
        ...base,
        state: 'available',
        detail: 'All observed signups are internal/test accounts.',
      };
    const allowedIds = new Set(allowed.map((m) => m.id));
    const facts: Fact[] = [];
    for (const row of remote.facts) {
      if (
        typeof row.user !== 'string' ||
        typeof row.at !== 'string' ||
        typeof row.kind !== 'string' ||
        !Number.isFinite(Date.parse(row.at)) ||
        !allowedIds.has(row.user)
      )
        continue;
      const owner = opaque(row.user);
      const fact: Fact = {
        id: `${owner}-${row.kind}-${row.at}-${facts.length}`,
        user: owner,
        kind: row.kind,
        at: new Date(row.at).toISOString(),
      };
      if (row.request)
        fact.request = createHmac('sha256', owner).update(row.request).digest('hex');
      if (row.session)
        fact.session = createHmac('sha256', owner).update(row.session).digest('hex');
      if (row.person)
        fact.person = createHmac('sha256', owner).update(row.person).digest('hex');
      if (row.situation)
        fact.situation = createHmac('sha256', owner).update(row.situation).digest('hex');
      if (typeof row.attribution === 'string' && (ATTRIBUTIONS as readonly string[]).includes(row.attribution))
        fact.attribution = row.attribution as Fact['attribution'];
      if (typeof row.assisted === 'boolean') fact.assisted = row.assisted;
      if (typeof row.people === 'number' && Number.isFinite(row.people))
        fact.people = row.people;
      if (typeof row.memories === 'number' && Number.isFinite(row.memories))
        fact.memories = row.memories;
      if (typeof row.latency === 'number' && Number.isFinite(row.latency))
        fact.latency = row.latency;
      if (typeof row.input === 'number' && Number.isFinite(row.input))
        fact.input = row.input;
      if (typeof row.output === 'number' && Number.isFinite(row.output))
        fact.output = row.output;
      if (typeof row.cost === 'number' && Number.isFinite(row.cost) && row.cost >= 0)
        fact.cost = row.cost;
      facts.push(fact);
    }
    let capabilities = KNOWN.filter((c) => remote.capabilities.includes(c));
    if (
      facts.some(
        (f) => ['message', 'complete', 'failed'].includes(f.kind) && !f.request,
      )
    )
      capabilities = capabilities.filter((c) => c !== 'wingman' && c !== 'responses');
    if (facts.some((f) => f.kind === 'person' && f.people === undefined))
      capabilities = capabilities.filter((c) => c !== 'people');
    if (facts.some((f) => f.kind === 'memory' && f.memories === undefined))
      capabilities = capabilities.filter((c) => c !== 'memory');
    // Economics: tokens need every billable record to carry both counts; cost
    // additionally needs every record priced. Partial coverage disables the
    // capability rather than summing what happens to be present.
    const usage = facts.filter((f) => f.kind === 'usage');
    if (!usage.length || usage.some((f) => f.input === undefined || f.output === undefined))
      capabilities = capabilities.filter((c) => c !== 'tokens' && c !== 'cost');
    if (usage.some((f) => f.cost === undefined))
      capabilities = capabilities.filter((c) => c !== 'cost');
    return {
      ...base,
      state: 'available',
      detail: 'Backend Postgres (sparkeefy-backend) · live signup roster · 30-second cache',
      capabilities,
      facts,
    };
  } catch {
    names = new Map();
    backendIds = new Map();
    return {
      ...base,
      state: 'query-error',
      detail: 'V2 backend source query failed. No partial totals are shown.',
      facts: [],
    };
  }
}
