import type { Config } from './config';

/** Runs one HogQL query against PostHog's query API and returns rows as objects. */
export async function hogql<T extends Record<string, unknown>>(cfg: Config, query: string): Promise<T[]> {
  if (!cfg.posthogApiKey) throw new Error('POSTHOG_PERSONAL_API_KEY is not set');
  const response = await fetch(`${cfg.posthogHost}/api/projects/${cfg.posthogProjectId}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.posthogApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query }, refresh: 'blocking' }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`PostHog ${response.status}: ${text.slice(0, 200)}`);
  }
  const body = (await response.json()) as { columns?: string[]; results?: unknown[][]; error?: unknown };
  // PostHog reports query timeouts as 200 + error; never treat that as "zero rows".
  if (body.error || !Array.isArray(body.results)) throw new Error(`PostHog query error: ${String(body.error ?? 'no results').slice(0, 200)}`);
  const columns = body.columns ?? [];
  return (body.results ?? []).map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]])) as T);
}
