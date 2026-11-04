/**
 * Runtime settings. Everything comes from Vercel environment variables; nothing
 * secret is ever sent to the browser.
 */

const list = (value: string | undefined) =>
  new Set(
    (value ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

const num = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && value !== undefined && value !== '' ? n : fallback;
};

export function config() {
  const env = process.env;
  return {
    posthogHost: (env.POSTHOG_HOST ?? 'https://us.posthog.com').replace(/\/$/, ''),
    posthogProjectId: env.POSTHOG_PROJECT_ID ?? '599431',
    posthogApiKey: env.POSTHOG_PERSONAL_API_KEY ?? '',
    /** Project (capture) key, used only to stamp keefie_account on persons. Empty = no sync. */
    posthogProjectApiKey: env.POSTHOG_PROJECT_API_KEY ?? '',
    posthogIngestHost: (env.POSTHOG_INGEST_HOST ?? 'https://us.i.posthog.com').replace(/\/$/, ''),
    backendUrl: (env.V2_SPARKEEFY_BACKEND_URL ?? '').replace(/\/$/, ''),
    backendAdminKey: env.V2_SPARKEEFY_BACKEND_ADMIN_KEY ?? '',
    /** Team accounts: shown only under "Internal", never mixed into real numbers. */
    teamIds: new Set([...list(env.TEAM_USER_IDS), ...list(env.CONTROL_V2_INTERNAL_USER_IDS)]),
    /** Smoke leftovers, Play reviewer and test-lab accounts: never counted anywhere. */
    excludedIds: list(env.EXCLUDED_USER_IDS),
    /** Monthly fixed infrastructure cost in USD, spread across active users. 0 = model cost only. */
    infraMonthlyUsd: num(env.INFRA_MONTHLY_USD, 0),
    /** Monthly revenue in USD. 0 = pre-revenue (gross margin is not shown as a number). */
    revenueMonthlyUsd: num(env.REVENUE_MONTHLY_USD, 0),
    costTargetPerMau: num(env.COST_TARGET_PER_MAU_USD, 0.4),
    onboardingBenchmark: num(env.ONBOARDING_BENCHMARK_PCT, 45),
    latencySlaMs: num(env.LATENCY_SLA_MS, 3000),
    failureSlaPct: num(env.FAILURE_SLA_PCT, 3),
    /** Earliest date the dashboard reads ("All Time"). */
    dataStart: env.DATA_START ?? '2026-09-11',
  };
}

export type Config = ReturnType<typeof config>;
