import { clearCookie, emailAllowed, getSession, normaliseEmail, passwordMatches, sessionCookie } from './auth';
import { config } from './config';
import { getDataset, knownNames } from './dataset';
import { getLive } from './live';
import { computeSnapshot } from './metrics';
import { pendingSync } from './posthog-sync';
import { getTruthReport, logFeedback, removeFeedback } from './truth';
import { getUserDetail, isUserId } from './user-detail';
import type { Audience, Filters, Range, Surface } from './types';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.searchParams.get('path') ?? url.pathname;
  const method = request.method;

  if (method !== 'GET' && request.headers.get('origin') && request.headers.get('origin') !== url.origin)
    return json({ error: 'Origin not allowed' }, 403);

  if (path === '/api/health') return json({ ok: true });

  if (path === '/api/session' && method === 'GET') {
    const session = await getSession(request);
    return json({ authenticated: Boolean(session), email: session?.email ?? null });
  }

  if (path === '/api/login' && method === 'POST') {
    let body: { email?: unknown; password?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      /* empty body */
    }
    const email = typeof body.email === 'string' ? normaliseEmail(body.email) : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password || !emailAllowed(email) || !(await passwordMatches(password)))
      return json({ error: 'That email and password did not match.' }, 401);
    return json({ authenticated: true, email }, 200, { 'Set-Cookie': await sessionCookie(email) });
  }

  if (path === '/api/logout' && method === 'POST') return json({ authenticated: false }, 200, { 'Set-Cookie': clearCookie() });

  if (path === '/api/dashboard' && method === 'GET') {
    if (!(await getSession(request))) return json({ error: 'Sign in required' }, 401);
    const filters: Filters = {
      range: pick<Range>(url.searchParams.get('range'), ['1d', '7d', '30d', 'all'], '30d'),
      surface: pick<Surface>(url.searchParams.get('surface'), ['combined', 'overlay', 'app'], 'combined'),
      audience: pick<Audience>(url.searchParams.get('audience'), ['external', 'internal'], 'external'),
      version: /^(all|\d+(\.\d+){0,3})$/.test(url.searchParams.get('version') ?? '') ? (url.searchParams.get('version') as string) : 'all',
    };
    try {
      const data = await getDataset(config());
      const body = computeSnapshot(data, filters, config());
      // Finish a running PostHog account sync before the serverless instance is frozen (bounded wait).
      const sync = pendingSync();
      if (sync) await Promise.race([sync, new Promise((r) => setTimeout(r, 8000))]);
      return json(body);
    } catch (error) {
      console.error('dashboard failed', error);
      return json({ error: 'Analytics sources are unavailable right now. Retrying shortly.' }, 503);
    }
  }

  if (path === '/api/live' && method === 'GET') {
    if (!(await getSession(request))) return json({ error: 'Sign in required' }, 401);
    const audience = pick<Audience>(url.searchParams.get('audience'), ['external', 'internal'], 'external');
    try {
      const person = url.searchParams.get('user');
      return json(await getLive(config(), url.searchParams.get('since'), audience, knownNames(), isUserId(person) ? person.toLowerCase() : null));
    } catch (error) {
      console.error('live failed', error);
      return json({ error: 'Live feed unavailable' }, 503);
    }
  }

  // 7 Nov: this dashboard checked against the production database, person by person.
  if (path === '/api/truth' && method === 'GET') {
    if (!(await getSession(request))) return json({ error: 'Sign in required' }, 401);
    try {
      const data = await getDataset(config());
      return json(await getTruthReport(config(), data, url.searchParams.get('fresh') === '1'));
    } catch (error) {
      console.error('truth failed', error);
      return json({ status: 'down', error: 'Dashboard data unavailable', diffs: [], database: null, dashboard: null, feedback: [], checkedAt: null, databaseAt: null, from: null }, 503);
    }
  }

  // 7 Nov: founder feedback log (WhatsApp, calls), recorded under the signed-in email.
  if (path === '/api/feedback' && method === 'POST') {
    const session = await getSession(request);
    if (!session) return json({ error: 'Sign in required' }, 401);
    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Send JSON' }, 400);
    }
    const out = await logFeedback(config(), session.email, body);
    return json(out.body, out.status);
  }

  if (path === '/api/feedback/remove' && method === 'POST') {
    if (!(await getSession(request))) return json({ error: 'Sign in required' }, 401);
    let body: { id?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      /* empty body */
    }
    const out = await removeFeedback(config(), typeof body.id === 'string' ? body.id : '');
    return json({ removed: out.status === 200 }, out.status === 200 ? 200 : out.status);
  }

  if (path === '/api/user' && method === 'GET') {
    if (!(await getSession(request))) return json({ error: 'Sign in required' }, 401);
    const id = url.searchParams.get('id');
    if (!isUserId(id)) return json({ error: 'id must be a user id' }, 400);
    return json(await getUserDetail(config(), id));
  }

  return json({ error: 'Not found' }, 404);
}
