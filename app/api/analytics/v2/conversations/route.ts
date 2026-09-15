import { trackerAccess } from '../../../../../lib/auth';
import {
  backendUserIdFor,
  fetchBackendConversations,
  liveDatasetFromBackend,
} from '../../../../../lib/analytics-v2/source-backend';

/**
 * Founder conversation reader. Admin session only; one pseudonymous
 * participant per request; the backend user id never leaves the server.
 */
export async function GET(request: Request): Promise<Response> {
  if (!(await trackerAccess(request)).canEdit)
    return Response.json({ error: 'Admin sign-in required' }, { status: 403 });
  const participant = new URL(request.url).searchParams.get('user') ?? '';
  if (!/^participant-[0-9a-f]{16}$/.test(participant))
    return Response.json({ error: 'Invalid participant' }, { status: 400 });
  // Ensure the roster is loaded so the opaque id can be resolved.
  await liveDatasetFromBackend();
  const userId = backendUserIdFor(participant);
  if (!userId) return Response.json({ error: 'Unknown participant' }, { status: 404 });
  try {
    const data = (await fetchBackendConversations(userId)) as Record<string, unknown>;
    const { userId: _drop, ...rest } = data;
    return Response.json(
      { participant, ...rest },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch {
    return Response.json({ error: 'Conversation source unavailable' }, { status: 503 });
  }
}
