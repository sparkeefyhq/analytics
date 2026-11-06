/**
 * /api/live?since=&audience=: what happened in the last few seconds (6 Nov, Rahul: "live, like
 * collaboration"). The page polls this every few seconds; when anything new arrives it shows it
 * in the live feed and re-reads the full dashboard so every number moves together.
 *
 * Source: the backend's /api/admin/analytics/v2/live (Postgres rows, never any message text).
 * Same people rules as the dashboard: excluded ids never appear, team ids only under Internal,
 * nothing before COUNT_FROM.
 */
import type { Config } from './config';
import type { Audience } from './types';

export type LiveKind =
  | 'signup'
  | 'chat_message'
  | 'chat_reply'
  | 'chat_failed'
  | 'overlay_call'
  | 'overlay_failed'
  | 'overlay_draft'
  | 'overlay_refine'
  | 'overlay_copied'
  | 'overlay_inserted'
  | 'overlay_closed'
  | 'overlay_sent';

export interface LiveRow {
  id: string;
  kind: LiveKind;
  user: string;
  at: string;
  name?: string | null;
  latency?: number | null;
  app?: string | null;
  status?: string | null;
  outcome?: string | null;
  option?: number | null;
}

export interface LiveFeed {
  now: string;
  rows: LiveRow[];
  truncated: boolean;
}

/** Overlap so a row committed a moment late is not missed; the page drops ids it already has. */
export const LIVE_OVERLAP_MS = 15_000;

export function filterLive(rows: LiveRow[], cfg: Pick<Config, 'teamIds' | 'excludedIds' | 'countFrom'>, audience: Audience): LiveRow[] {
  const cut = cfg.countFrom ? Date.parse(cfg.countFrom) : Number.NEGATIVE_INFINITY;
  return rows.filter((r) => {
    const id = r.user.toLowerCase();
    if (cfg.excludedIds.has(id)) return false;
    if (Number.isFinite(cut) && Date.parse(r.at) < cut) return false;
    return audience === 'internal' ? cfg.teamIds.has(id) : !cfg.teamIds.has(id);
  });
}

export async function getLive(cfg: Config, since: string | null, audience: Audience, names: Map<string, string | null>): Promise<LiveFeed> {
  if (!cfg.backendUrl || !cfg.backendAdminKey) throw new Error('backend not configured');
  const parsed = since ? Date.parse(since) : Number.NaN;
  const from = new Date((Number.isFinite(parsed) ? parsed : Date.now() - 10 * 60_000) - LIVE_OVERLAP_MS).toISOString();
  const response = await fetch(`${cfg.backendUrl}/api/admin/analytics/v2/live?since=${encodeURIComponent(from)}`, {
    headers: { 'x-admin-api-key': cfg.backendAdminKey },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`live ${response.status}`);
  const body = (await response.json()) as { data?: { now?: string; rows?: LiveRow[]; truncated?: boolean } };
  const rows = filterLive(Array.isArray(body.data?.rows) ? body.data.rows : [], cfg, audience).map((r) => ({
    ...r,
    name: r.name ?? names.get(r.user.toLowerCase()) ?? null,
  }));
  return { now: body.data?.now ?? new Date().toISOString(), rows, truncated: Boolean(body.data?.truncated) };
}

const sec = (ms: number | null | undefined) => (typeof ms === 'number' && ms > 0 ? ` · ${(ms / 1000).toFixed(1)} s` : '');
const APP_NAMES: Record<string, string> = {
  'com.whatsapp': 'WhatsApp',
  'com.whatsapp.w4b': 'WhatsApp Business',
  'com.instagram.android': 'Instagram',
  'com.snapchat.android': 'Snapchat',
};
const inApp = (app: string | null | undefined) => (app ? ` in ${APP_NAMES[app] ?? app}` : '');

/**
 * One line per row for the feed. `null` = not shown on its own (still refreshes the numbers):
 * a successful overlay model call is already shown by its "draft" row.
 */
export function describeLive(r: LiveRow): { text: string; tone: 'good' | 'bad' | 'plain' } | null {
  switch (r.kind) {
    case 'signup':
      return { text: 'signed up', tone: 'good' };
    case 'chat_message':
      return { text: 'asked Wingman in the app', tone: 'plain' };
    case 'chat_reply':
      return { text: `got a Wingman reply${sec(r.latency)}`, tone: 'plain' };
    case 'chat_failed':
      return { text: 'Wingman reply failed', tone: 'bad' };
    case 'overlay_call':
      return null;
    case 'overlay_failed':
      return { text: 'overlay reply failed', tone: 'bad' };
    case 'overlay_draft':
      return r.status && r.status !== 'ok'
        ? { text: `tapped the bubble${inApp(r.app)}: no reply (${r.status.replace(/_/g, ' ')})`, tone: 'bad' }
        : { text: `got an overlay draft${inApp(r.app)}${sec(r.latency)}`, tone: 'plain' };
    case 'overlay_refine':
      return { text: `changed the mood or tab${inApp(r.app)}${sec(r.latency)}`, tone: 'plain' };
    case 'overlay_copied':
      return { text: `copied ${r.option && r.option > 1 ? `option ${r.option}` : 'the first draft'}${inApp(r.app)}`, tone: 'good' };
    case 'overlay_inserted':
      return { text: `inserted ${r.option && r.option > 1 ? `option ${r.option}` : 'the first draft'}${inApp(r.app)}`, tone: 'good' };
    case 'overlay_closed':
      return { text: `closed the bubble${inApp(r.app)}`, tone: 'plain' };
    case 'overlay_sent':
      return r.outcome === 'as_is'
        ? { text: `sent Keefie's reply as-is${inApp(r.app)}`, tone: 'good' }
        : r.outcome === 'edited'
          ? { text: `sent Keefie's reply, edited${inApp(r.app)}`, tone: 'good' }
          : { text: `wrote their own reply${inApp(r.app)}`, tone: 'plain' };
    default:
      return null;
  }
}
