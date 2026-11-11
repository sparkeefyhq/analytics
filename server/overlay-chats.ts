/**
 * Founder-only overlay chat reader (11 Nov). Reads the stored overlay 1:1 chats
 * straight from prod Postgres, read-only, so the dashboard can show them without
 * waiting on a backend release. This is the one place the dashboard touches the
 * database directly; everything else goes through the backend API.
 *
 * Founder gating happens in the handler (by signed-in email) before any of
 * these run; nothing here is reachable by a non-founder session.
 *
 * Uses OVERLAY_CHATS_DB_URL (a read-only Postgres connection string, Supabase
 * pooler). One pooled connection, no prepared statements (pooler-safe).
 */

import postgres from 'postgres';
import type { Config } from './config';

export interface OverlayChatUser {
  userId: string;
  name: string | null;
  trafficClass: string | null;
  chats: number;
  lines: number;
  apps: string[];
  lastActivity: string | null;
}

export interface OverlayChatLine {
  from: string;
  text: string;
  fromOverlay: boolean;
}

export interface OverlayChat {
  sourceApp: string;
  titleHash: string;
  updatedAt: string;
  expiresAt: string | null;
  lines: OverlayChatLine[];
}

export interface OverlayUserChats {
  userId: string;
  name: string | null;
  generatedAt: string;
  usage: { drafts: number; inserted: number; sent: number };
  chats: OverlayChat[];
  truncated: boolean;
}

const MAX_CHATS = 200;

/** Collapse whitespace + case so "ok  Cool" and "ok cool" match. */
const norm = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

let client: ReturnType<typeof postgres> | null = null;
function db(cfg: Config) {
  if (!cfg.overlayChatsDbUrl) throw new Error('overlay chat database not configured');
  if (!client) {
    client = postgres(cfg.overlayChatsDbUrl, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 15,
      prepare: false,
      ssl: 'require',
    });
  }
  return client;
}

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export async function fetchOverlayChatUsers(cfg: Config): Promise<OverlayChatUser[]> {
  const sql = db(cfg);
  const rows = await sql<
    { user_id: string; name: string | null; traffic_class: string | null; chats: number; lines: number; apps: string[] | null; last_activity: Date | null }[]
  >`
    SELECT p.user_id::text AS user_id,
           p.name,
           (SELECT e.traffic_class FROM overlay_usage_events e
              WHERE e.owner_user_id = p.user_id
              ORDER BY e.occurred_at DESC LIMIT 1) AS traffic_class,
           COUNT(m.id)::int AS chats,
           COALESCE(SUM(jsonb_array_length(m.lines)), 0)::int AS lines,
           ARRAY_AGG(DISTINCT m.source_app) AS apps,
           MAX(m.updated_at) AS last_activity
      FROM user_profiles p
      JOIN overlay_chat_memory m ON m.owner_user_id = p.user_id
     GROUP BY p.user_id, p.name
     ORDER BY MAX(m.updated_at) DESC NULLS LAST
  `;
  return rows.map((r) => ({
    userId: r.user_id,
    name: r.name,
    trafficClass: r.traffic_class,
    chats: Number(r.chats),
    lines: Number(r.lines ?? 0),
    apps: (r.apps ?? []).filter((a): a is string => typeof a === 'string'),
    lastActivity: r.last_activity ? new Date(r.last_activity).toISOString() : null,
  }));
}

export async function fetchOverlayUserChats(cfg: Config, userId: string): Promise<OverlayUserChats> {
  if (!isUuid(userId)) throw new Error('user must be a uuid');
  const sql = db(cfg);
  const [profile, chats, drafts, usage] = await Promise.all([
    sql<{ name: string | null }[]>`SELECT name FROM user_profiles WHERE user_id = ${userId}`,
    sql<{ source_app: string; title_hash: string; lines: unknown; updated_at: Date; expires_at: Date | null }[]>`
      SELECT source_app, title_hash, lines, updated_at, expires_at
        FROM overlay_chat_memory
       WHERE owner_user_id = ${userId}
       ORDER BY updated_at DESC
       LIMIT ${MAX_CHATS + 1}`,
    sql<{ reply: string | null }[]>`
      SELECT reply FROM overlay_eval_captures
       WHERE owner_user_id = ${userId} AND reply IS NOT NULL AND reply <> ''`,
    sql<{ action: string | null; n: number }[]>`
      SELECT action, COUNT(*)::int AS n
        FROM overlay_usage_events
       WHERE owner_user_id = ${userId} AND action IN ('draft', 'inserted', 'sent')
       GROUP BY action`,
  ]);

  const draftTexts = new Set(drafts.map((d) => norm(d.reply ?? '')).filter((t) => t.length > 0));

  const truncated = chats.length > MAX_CHATS;
  const kept = truncated ? chats.slice(0, MAX_CHATS) : chats;

  const mapped: OverlayChat[] = kept.map((row) => {
    const rawLines = Array.isArray(row.lines) ? row.lines : [];
    const lines: OverlayChatLine[] = rawLines
      .filter((l): l is { from?: unknown; text?: unknown } => typeof l === 'object' && l !== null)
      .map((l) => {
        const from = typeof l.from === 'string' ? l.from : 'unknown';
        const text = typeof l.text === 'string' ? l.text : '';
        return { from, text, fromOverlay: from === 'me' && draftTexts.has(norm(text)) };
      });
    return {
      sourceApp: row.source_app,
      titleHash: row.title_hash,
      updatedAt: new Date(row.updated_at).toISOString(),
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
      lines,
    };
  });

  const counts = { drafts: 0, inserted: 0, sent: 0 };
  for (const u of usage) {
    if (u.action === 'draft') counts.drafts = Number(u.n);
    else if (u.action === 'inserted') counts.inserted = Number(u.n);
    else if (u.action === 'sent') counts.sent = Number(u.n);
  }

  return {
    userId,
    name: profile[0]?.name ?? null,
    generatedAt: new Date().toISOString(),
    usage: counts,
    chats: mapped,
    truncated,
  };
}
