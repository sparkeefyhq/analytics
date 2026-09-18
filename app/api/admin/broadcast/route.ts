import { trackerAccess } from '../../../../lib/auth';

/**
 * Founder-only broadcast notification: proxies to sparkeefy-backend's
 * existing admin campaign API (create + send in one call). No segmentId is
 * passed, so resolveAudienceUserIds() on the backend defaults to
 * `{ type: 'all' }` — every user in auth.users.
 */

function backendConfig() {
  const baseUrl = process.env.V2_SPARKEEFY_BACKEND_URL;
  const adminKey = process.env.V2_SPARKEEFY_BACKEND_ADMIN_KEY;
  if (!baseUrl || !adminKey) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ''), adminKey };
}

async function backendFetch(path: string, init?: RequestInit) {
  const config = backendConfig();
  if (!config) throw new Error('Backend admin URL/key not configured');
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      'x-admin-api-key': config.adminKey,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  const body = (await response.json().catch(() => null)) as
    | { success?: boolean; data?: unknown; error?: { message?: string } | string }
    | null;
  if (!response.ok || !body?.success) {
    const message =
      (typeof body?.error === 'string' ? body.error : body?.error?.message) ||
      `Backend responded ${response.status}`;
    throw new Error(message);
  }
  return body.data;
}

export async function GET(request: Request): Promise<Response> {
  const access = await trackerAccess(request);
  if (!access.canEdit) return Response.json({ error: 'Admin sign-in required' }, { status: 403 });
  try {
    const campaigns = await backendFetch('/api/admin/notifications/campaigns');
    return Response.json({ campaigns }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (cause) {
    return Response.json(
      { error: cause instanceof Error ? cause.message : 'Unable to load campaigns.' },
      { status: 502 },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const access = await trackerAccess(request);
  if (!access.canEdit) return Response.json({ error: 'Admin sign-in required' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    body?: string;
    deepLink?: string | null;
    category?: string;
  };
  const title = (body.title || '').trim();
  const text = (body.body || '').trim();
  if (!title || !text)
    return Response.json({ error: 'Title and body are required.' }, { status: 400 });
  if (title.length > 120 || text.length > 500)
    return Response.json({ error: 'Title or body is too long.' }, { status: 400 });

  try {
    const campaign = (await backendFetch('/api/admin/notifications/campaigns', {
      method: 'POST',
      body: JSON.stringify({
        name: `Broadcast · ${new Date().toISOString()}`,
        category: body.category || 'product',
        title,
        body: text,
        deepLink: body.deepLink || null,
        createdBy: access.viewerEmail,
      }),
    })) as { id: string };

    const result = await backendFetch(`/api/admin/notifications/campaigns/${campaign.id}/send`, {
      method: 'POST',
    });
    return Response.json({ result });
  } catch (cause) {
    return Response.json(
      { error: cause instanceof Error ? cause.message : 'Unable to send broadcast.' },
      { status: 502 },
    );
  }
}
