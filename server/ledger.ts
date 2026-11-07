/**
 * Our own analytics ledger (6 Nov, backend /api/admin/analytics/v2/events): overlay usage rows,
 * one row per overlay session, onboarding/app events and the anonymous-id -> account links,
 * written by the backend as they happen. Read incrementally and kept in this instance's memory.
 *
 * From the first ledger row onwards, overlay drafts/uses, sessions, onboarding steps and in-app
 * activity come from here (seconds old, every instance identical); PostHog only fills in the time
 * before that. So no number is ever counted twice or from two sources at once.
 */
import type { Config } from './config';

export interface LedgerOverlay {
  id: string; user: string; at: string; recorded: string; action: string; app: string; tc: string;
  status: string | null; latency: number | null; cost: number | null; panel: string | null; outcome: string | null;
  mood: string | null; moodApplied: string | null; refinement: string | null; relationship: string | null; option: number | null;
  taps: number | null; firstTry: boolean | null; used: boolean | null; drafts: number | null; durationMs: number | null;
}
export interface LedgerFunnel {
  id: string; distinct: string; user: string | null; event: string; at: string; recorded: string; tc: string;
  screen: string | null; permission: string | null; granted: boolean | null; appVersion: string | null;
  /** chat_turn: answered / safety / failed. Absent on older backends. */
  outcome?: string | null;
}

/** Re-read this much before the newest row seen: a batch committed a moment late is not missed (ids de-duplicate). */
export const LEDGER_OVERLAP_MS = 30_000;

const state = {
  overlay: new Map<string, LedgerOverlay>(),
  funnel: new Map<string, LedgerFunnel>(),
  links: new Map<string, string>(),
  cursor: new Date(0).toISOString(),
  readAt: 0,
  available: true,
  lastError: null as string | null,
};

type Page = {
  until: string;
  more: boolean;
  columns: { overlay: string[]; funnel: string[]; links: string[] };
  overlay: unknown[][];
  funnel: unknown[][];
  links: unknown[][];
};

const zip = <T>(columns: string[], row: unknown[]) => Object.fromEntries(columns.map((c, i) => [c, row[i]])) as T;

/** Applies one page to the in-memory ledger. Exported for tests. */
export function applyPage(page: Page, into = state): void {
  for (const r of page.overlay) {
    const row = zip<LedgerOverlay>(page.columns.overlay, r);
    into.overlay.set(row.id, row);
  }
  for (const r of page.funnel) {
    const row = zip<LedgerFunnel>(page.columns.funnel, r);
    into.funnel.set(row.id, row);
  }
  for (const r of page.links) into.links.set(String(r[0]), String(r[1]).toLowerCase());
}

/**
 * Brings the ledger up to date. First call pages through everything (90-day retention bounds it);
 * later calls fetch only what's new. Never throws: on error the last good ledger is kept.
 */
export async function refreshLedger(cfg: Config): Promise<{ ok: boolean; error?: string }> {
  if (!cfg.backendUrl || !cfg.backendAdminKey) return { ok: false, error: 'backend not configured' };
  try {
    for (let page = 0; page < 50; page += 1) {
      const response = await fetch(`${cfg.backendUrl}/api/admin/analytics/v2/events?since=${encodeURIComponent(state.cursor)}&limit=20000`, {
        headers: { 'x-admin-api-key': cfg.backendAdminKey },
        signal: AbortSignal.timeout(15_000),
      });
      // An older backend (before the ledger) answers 404: PostHog stays the source, nothing breaks.
      if (response.status === 404) {
        state.available = false;
        state.lastError = null;
        return { ok: false, error: 'ledger not deployed' };
      }
      if (!response.ok) throw new Error(`ledger ${response.status}`);
      const body = (await response.json()) as { data?: Page };
      if (!body.data) throw new Error('ledger: empty response');
      applyPage(body.data);
      state.available = true;
      if (body.data.more) {
        const next = new Date(Date.parse(body.data.until) - 1).toISOString();
        // 7 Nov (audit): a page that doesn't move the cursor forward would repeat forever; stop and say so.
        if (!(Date.parse(next) > Date.parse(state.cursor))) throw new Error('ledger cursor did not advance');
        state.cursor = next;
        continue;
      }
      state.cursor = new Date(Math.max(0, Date.parse(body.data.until) - LEDGER_OVERLAP_MS)).toISOString();
      state.readAt = Date.now();
      state.lastError = null;
      return { ok: true };
    }
    // 7 Nov (audit): still more pages after the cap = only part of the history is loaded. Not "up to date".
    throw new Error('ledger partially read (page cap reached)');
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    return { ok: false, error: state.lastError };
  }
}

/** The last ledger refresh error, or null when the latest refresh read everything. */
export const ledgerError = (): string | null => state.lastError;

export interface LedgerView {
  overlay: LedgerOverlay[];
  funnel: LedgerFunnel[];
  links: Map<string, string>;
  /** First moment each source has rows; PostHog is used only before it. null = no rows yet. */
  overlayFrom: string | null;
  funnelFrom: string | null;
  readAt: number;
}

export function ledgerView(): LedgerView {
  const overlay = [...state.overlay.values()];
  const funnel = [...state.funnel.values()];
  const min = (xs: string[]) => (xs.length ? xs.reduce((a, b) => (b < a ? b : a)) : null);
  return {
    overlay,
    funnel,
    links: state.links,
    overlayFrom: min(overlay.map((r) => r.at)),
    funnelFrom: min(funnel.map((r) => r.at)),
    readAt: state.readAt,
  };
}

/** Test hook. */
export function resetLedger(): void {
  state.overlay.clear();
  state.funnel.clear();
  state.links.clear();
  state.cursor = new Date(0).toISOString();
  state.readAt = 0;
  state.available = true;
  state.lastError = null;
}
