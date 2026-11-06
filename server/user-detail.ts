/**
 * /api/user?id=: what the detail panel loads on demand for one person (never for the whole list):
 *  - their in-app Wingman conversations, from the backend's admin conversation reader,
 *  - where they are (PostHog person: city / region / country) and their email if they gave one.
 * Location is cached per person for a few minutes (it costs a PostHog query); conversations are
 * read fresh every time (one small Postgres read) so a new chat shows up right away (6 Nov).
 */
import type { Config } from './config';
import { hogql } from './posthog';
import type { UserDetail } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TTL_MS = 3 * 60_000;
const personCache = new Map<string, { at: number; person: UserDetail['person'] }>();

export const isUserId = (id: string | null): id is string => Boolean(id && UUID.test(id));

export async function getUserDetail(cfg: Config, id: string): Promise<UserDetail> {
  const key = id.toLowerCase();
  const hit = personCache.get(key);
  const errors: string[] = [];
  const [person, convo] = await Promise.all([
    hit && Date.now() - hit.at < TTL_MS
      ? Promise.resolve(hit.person)
      : readPerson(cfg, key)
          .then((p) => {
            personCache.set(key, { at: Date.now(), person: p });
            return p;
          })
          .catch((e) => {
            errors.push(`PostHog: ${e instanceof Error ? e.message : String(e)}`);
            return null;
          }),
    readConversations(cfg, key).catch((e) => {
      errors.push(`Backend: ${e instanceof Error ? e.message : String(e)}`);
      return { sessions: [], truncated: false };
    }),
  ]);
  return { id: key, person, conversations: convo.sessions, truncated: convo.truncated, errors };
}

async function readPerson(cfg: Config, id: string): Promise<UserDetail['person']> {
  const rows = await hogql<{ city: string; region: string; country: string; email: string }>(
    cfg,
    `SELECT ifNull(toString(properties.$geoip_city_name), '') AS city, ifNull(toString(properties.$geoip_subdivision_1_name), '') AS region,
            ifNull(toString(properties.$geoip_country_name), '') AS country, ifNull(toString(properties.email), '') AS email
     FROM persons WHERE id IN (SELECT person_id FROM person_distinct_ids WHERE distinct_id = '${id}') LIMIT 1`,
  );
  const r = rows[0];
  if (!r) return null;
  const v = (s: string) => (s && s !== 'null' ? s : null);
  return { city: v(r.city), region: v(r.region), country: v(r.country), email: v(r.email) };
}

async function readConversations(cfg: Config, id: string) {
  if (!cfg.backendUrl || !cfg.backendAdminKey) throw new Error('backend not configured');
  const response = await fetch(`${cfg.backendUrl}/api/admin/analytics/v2/conversations?user=${id}`, {
    headers: { 'x-admin-api-key': cfg.backendAdminKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`conversations ${response.status}`);
  const body = (await response.json()) as {
    data?: { sessions?: { sessionId: string; startedAt: string; personName: string | null; messages: { role: string; content: string; at: string }[] }[]; truncated?: boolean };
  };
  const sessions = (body.data?.sessions ?? [])
    .map((s) => ({ sessionId: s.sessionId, startedAt: s.startedAt, personName: s.personName, messages: (s.messages ?? []).map((m) => ({ role: m.role, content: m.content, at: m.at })) }))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return { sessions, truncated: Boolean(body.data?.truncated) };
}
