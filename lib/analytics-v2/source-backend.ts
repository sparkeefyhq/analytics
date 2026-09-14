import { createHmac } from 'node:crypto';
import type { Capability, Dataset, Fact } from './model';
import { readMembership } from './source';

/**
 * Direct-to-production adapter: reads sparkeefy-backend's
 * `GET /api/admin/analytics/v2` (Postgres-backed, zero PostHog) instead of
 * PostHog HogQL. Same contract as `source.ts` (returns a `Dataset`) and the
 * same cohort manifest (`CONTROL_V2_COHORTS_JSON`/`CONTROL_V2_COVERAGE_FROM`,
 * `readMembership` reused as-is) — only the origin of `facts`/raw members
 * changes. `model.ts` is untouched: it already only depends on `Dataset`.
 *
 * `distinctIds` in the manifest now hold real backend user ids (not PostHog
 * distinct_ids) — the backend already has canonical identities, so this is
 * an exact-match allowlist rather than an alias-reconciliation exercise.
 */

const KNOWN: Capability[] = [
  'activity',
  'onboarding',
  'people',
  'memory',
  'wingman',
  'responses',
  'retries',
  'fallbacks',
  'latency',
  'tokens',
];

interface BackendFact {
  user: string;
  at: string;
  kind: string;
  request?: string;
  session?: string;
  people?: number;
  memories?: number;
  latency?: number;
  input?: number;
  output?: number;
}

interface BackendMember {
  id: string;
  firstOpen: string;
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
    !process.env.V2_SPARKEEFY_BACKEND_URL ||
    !process.env.V2_SPARKEEFY_BACKEND_ADMIN_KEY ||
    !process.env.CONTROL_V2_COHORTS_JSON ||
    !process.env.CONTROL_V2_COVERAGE_FROM ||
    !process.env.SPARKEEFY_SESSION_SECRET
  )
    return base;
  try {
    const mapping = readMembership(process.env.CONTROL_V2_COHORTS_JSON);
    if (!Number.isFinite(Date.parse(base.coverageFrom)))
      throw Error('Invalid coverage');
    const secret = process.env.SPARKEEFY_SESSION_SECRET;
    const opaque = (value: string) =>
      `participant-${createHmac('sha256', secret).update(value).digest('hex').slice(0, 16)}`;
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
    const remote = await fetchBackendAnalytics();
    const facts: Fact[] = [];
    for (const row of remote.facts) {
      if (
        typeof row.user !== 'string' ||
        typeof row.at !== 'string' ||
        typeof row.kind !== 'string' ||
        !Number.isFinite(Date.parse(row.at))
      )
        continue;
      const member = allowed.find(
        (m) =>
          m.distinctIds.includes(row.user) &&
          Date.parse(row.at) >= Date.parse(m.from) &&
          (!m.to || Date.parse(row.at) < Date.parse(m.to)),
      );
      if (!member) continue;
      const owner = opaque(member.id);
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
    return {
      ...base,
      state: 'available',
      detail: 'Backend Postgres (sparkeefy-backend) · reconciled identity allowlist · 30-second cache',
      capabilities,
      facts,
    };
  } catch {
    return {
      ...base,
      state: 'query-error',
      detail:
        'V2 backend source query or coverage validation failed. No partial totals are shown.',
      facts: [],
    };
  }
}
