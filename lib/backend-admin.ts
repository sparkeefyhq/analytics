import { env } from "@/lib/runtime-env";

/**
 * Server-only client for sparkeefy-backend's authenticated /api/admin
 * routes. Distinct from lib/posthog.ts: this resolves a PostHog distinct_id
 * (which, for a signed-in user, is the same Supabase user id — see
 * AuthContext.tsx's trackEvent('user_signup', { user_id: data.user.id }) on
 * the mobile side) back to the profile name the user actually set, since
 * PostHog itself is never sent a name (privacy rule in
 * PHASE_0_POSTHOG_INSTRUMENTATION_BRIEF.md).
 *
 * SPARKEEFY_BACKEND_ADMIN_KEY must only ever exist as a server-side secret —
 * never a Vite public env var — and must match the backend's ADMIN_API_KEY.
 */

function backendAdminConfig() {
  const record = env as unknown as Record<string, string | undefined>;
  const baseUrl = record.SPARKEEFY_BACKEND_URL;
  const adminKey = record.SPARKEEFY_BACKEND_ADMIN_KEY;
  if (!baseUrl || !adminKey) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ""), adminKey };
}

/**
 * userId -> the profile name/nickname they set during onboarding, or null
 * when unknown/not yet onboarded. Never throws — a missing or unreachable
 * backend degrades every caller back to today's raw-id display rather than
 * breaking the analytics page.
 */
export async function fetchUserNames(): Promise<Map<string, string>> {
  const config = backendAdminConfig();
  if (!config) return new Map();
  try {
    const response = await fetch(`${config.baseUrl}/api/admin/overview`, {
      headers: { "x-admin-api-key": config.adminKey },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return new Map();
    const body = (await response.json()) as {
      data?: { users?: { userId: string; name: string | null }[] };
    };
    const users = body.data?.users ?? [];
    const names = new Map<string, string>();
    for (const user of users) {
      const name = user.name?.trim();
      if (user.userId && name) names.set(user.userId, name);
    }
    return names;
  } catch {
    return new Map();
  }
}
