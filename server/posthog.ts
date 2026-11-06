import type { Config } from './config';

/** True when PostHog said "slow down" (rate limit), as opposed to a slow or failed query. */
export const isRateLimit = (error: unknown) => /PostHog 429|throttl|rate limit/i.test(error instanceof Error ? error.message : String(error));

/**
 * 6 Nov (Rahul: "PostHog is not reachable" right as users arrive): a slow or failed query is tried
 * once more after a short pause before the dashboard gives up on PostHog. A rate limit is not retried.
 */
export async function hogql<T extends Record<string, unknown>>(cfg: Config, query: string): Promise<T[]> {
  try {
    return await hogqlOnce<T>(cfg, query);
  } catch (error) {
    if (isRateLimit(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    return hogqlOnce<T>(cfg, query);
  }
}

async function hogqlOnce<T extends Record<string, unknown>>(cfg: Config, query: string): Promise<T[]> {
  if (!cfg.posthogApiKey) throw new Error('POSTHOG_PERSONAL_API_KEY is not set');
  const response = await fetch(`${cfg.posthogHost}/api/projects/${cfg.posthogProjectId}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.posthogApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query }, refresh: 'blocking' }),
    // Two tries must fit in the 60 s function limit.
    signal: AbortSignal.timeout(25_000),
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
