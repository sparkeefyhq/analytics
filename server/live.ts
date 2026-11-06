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
  | 'overlay_sent'
  | 'overlay_session'
  | 'app_event';

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
  mood?: string | null;
  refinement?: string | null;
  drafts?: number | null;
  firstTry?: boolean | null;
  used?: boolean | null;
  durationMs?: number | null;
  event?: string | null;
  screen?: string | null;
  granted?: boolean | null;
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
const inMood = (r: LiveRow) => (r.refinement ? ` (${r.refinement.replace(/_/g, ' ')})` : r.mood ? ` (${r.mood})` : '');
const words = (s: string) => s.replace(/_/g, ' ');
const secsLong = (ms: number | null | undefined) => (typeof ms === 'number' && ms > 0 ? ` in ${Math.round(ms / 1000)} s` : '');

const APP_EVENT_TEXT: Record<string, string> = {
  onboarding_started: 'started onboarding',
  onboarding_completed: 'finished onboarding',
  signup_completed: 'created an account',
  login_completed: 'signed in',
  auth_failed: 'sign-in failed',
  accessibility_permission_granted: 'turned on Accessibility',
  accessibility_permission_not_granted: 'did not turn on Accessibility',
  overlay_permission_granted: 'allowed display over apps',
  overlay_permission_not_granted: 'did not allow display over apps',
  notification_permission_granted: 'allowed notifications',
  home_first_viewed: 'reached Home for the first time',
  person_profile_created: 'added their first person',
};

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
        ? { text: `tapped the bubble${inApp(r.app)}: no reply (${words(r.status)})`, tone: 'bad' }
        : { text: `got an overlay draft${inMood(r)}${inApp(r.app)}${sec(r.latency)}`, tone: 'plain' };
    case 'overlay_refine':
      return r.refinement
        ? { text: `switched to the ${words(r.refinement)} tab${inApp(r.app)}${sec(r.latency)}`, tone: 'plain' }
        : { text: `switched mood to ${r.mood ?? 'another mood'}${inApp(r.app)}${sec(r.latency)}`, tone: 'plain' };
    case 'overlay_copied':
      return { text: `copied ${r.option && r.option > 1 ? `option ${r.option}` : 'the first draft'}${inMood(r)}${inApp(r.app)}`, tone: 'good' };
    case 'overlay_inserted':
      return { text: `inserted ${r.option && r.option > 1 ? `option ${r.option}` : 'the first draft'}${inMood(r)}${inApp(r.app)}`, tone: 'good' };
    case 'overlay_session': {
      const n = r.drafts ?? 0;
      const how = r.used ? (r.firstTry ? 'used the first draft' : 'used a reply after changing it') : 'left without using a reply';
      return { text: `ended an overlay session${inApp(r.app)}: ${n} draft${n === 1 ? '' : 's'}, ${how}${secsLong(r.durationMs)}`, tone: r.used ? 'good' : 'plain' };
    }
    case 'app_event': {
      if (r.event === 'chat_turn') {
        return r.outcome === 'safety'
          ? { text: 'sent an in-app message: Safety answered it', tone: 'bad' }
          : r.outcome === 'failed'
            ? { text: 'sent an in-app message: it failed', tone: 'bad' }
            : null; // answered turns already show as "asked Wingman" + "got a reply"
      }
      if (r.event === 'onboarding_step') return r.screen ? { text: `onboarding: ${words(r.screen)}`, tone: 'plain' } : null;
      if (r.event === 'onboarding_permission') return r.screen ? { text: `${r.granted ? 'granted' : 'declined'} ${words(r.screen)} permission`, tone: r.granted ? 'good' : 'bad' } : null;
      const text = r.event ? APP_EVENT_TEXT[r.event] : undefined;
      if (!text) return null;
      return { text, tone: /not_granted|failed/.test(r.event ?? '') ? 'bad' : r.event === 'onboarding_completed' || r.event?.endsWith('_granted') ? 'good' : 'plain' };
    }
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
