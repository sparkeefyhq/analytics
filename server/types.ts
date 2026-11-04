/** Raw, already-filtered inputs (see dataset.ts for who counts as real). */
export interface Dataset {
  /** When the data was last read from its sources (the older of PostHog and backend). */
  generatedAt: string;
  /** Set when the latest PostHog read failed and older rows are being shown. */
  sourceError: string | null;
  dataStart: string;
  people: { id: string; name: string | null; signupAt: string; team: boolean }[];
  /** Hourly activity counts per user and surface. */
  activity: { id: string; hour: string; surface: 'overlay' | 'app'; n: number }[];
  /** One row per overlay_used event (draft, inserted, copied, sent, closed, ...). */
  overlay: {
    id: string;
    ts: string;
    action: string;
    status: string;
    app: string;
    latency: number | null;
    /** null on drafts sent before cost tracking started (1 Nov 2026). */
    cost: number | null;
    panel: string;
  }[];
  /** overlay_session summaries (new app builds only). */
  sessions: {
    id: string;
    ts: string;
    panel: string;
    taps: number | null;
    firstTry: boolean | null;
    used: boolean | null;
    app: string;
  }[];
  /** In-app model calls with cost, from the backend's ai_call_telemetry. */
  aiCost: { id: string; at: string; cost: number }[];
  versions: { id: string; version: string }[];
  onboarding: { id: string; screen: string }[];
  /** Completed in-app chat replies, from the backend. */
  chatReplies: { id: string; at: string }[];
}

export type Range = '7d' | '30d' | 'all';
export type Surface = 'combined' | 'overlay' | 'app';
export type Audience = 'external' | 'internal';

export interface Filters {
  range: Range;
  surface: Surface;
  audience: Audience;
  version: string; // 'all' or an app version
}

export interface Ratio {
  n: number;
  d: number;
  pct: number | null;
}

export type RetentionCell =
  | { kind: 'value'; n: number; d: number; pct: number }
  | { kind: 'pending'; note: string };

export interface RetentionRow {
  label: string;
  start: string;
  users: number;
  d1: RetentionCell;
  d7: RetentionCell;
  d14: RetentionCell;
  state: 'Settled' | 'Measuring' | 'Active Intake';
}

export interface OverlayUserRow {
  id: string;
  name: string | null;
  sessions: number;
  requests: number;
  used: number;
  usedPct: number | null;
  app: string;
  lastActive: string;
}

export interface PlatformRow {
  key: string;
  label: string;
  users: number;
  requests: number;
  share: number;
}

export interface Snapshot {
  generatedAt: string;
  servedAt: string;
  stale: boolean;
  filters: Filters;
  rangeLabel: string;
  versions: string[];
  latestVersion: string | null;
  people: number;
  overview: {
    dau: { value: number; prev: number; deltaPct: number | null; overlay: number; app: number };
    wau: { value: number; pctOfMau: number | null };
    mau: { value: number; dauOverMau: number | null };
    overlayFrequency: { value: number | null; prev: number | null; deltaPct: number | null };
    cost: {
      perActiveUser: number | null;
      modelUsd: number;
      infraUsd: number;
      activeUsers: number;
      series: number[];
      target: number;
      grossMarginPct: number | null;
      estimated: boolean;
    };
    onboarding: {
      pct: number | null;
      completed: number;
      total: number;
      benchmark: number;
      dropped: number;
      topDropStep: string | null;
      /** Last onboarding screen seen by accounts that have not reached a first reply. */
      dropSteps: { step: string; count: number }[];
    };
    replyUse: { pct: number | null; used: number; total: number; notUsed: number };
    retention: { rows: RetentionRow[]; avgD1: number | null; target: number };
  };
  overlay: {
    sessionsPerUser: { value: number | null; deltaPct: number | null; sessionsToday: number; usersToday: number };
    firstReply: { pct: number | null; deltaPts: number | null; used: number; total: number };
    latency: { p50: number | null; p95: number | null; p99: number | null; slaMs: number; series: { hour: string; p95: number | null }[] };
    cost: {
      perRequest: number | null;
      /** Reported spend plus untracked drafts at the tracked average. */
      total: number;
      requests: number;
      /** Drafts that carry a real cost value. */
      tracked: number;
      estimated: boolean;
      deltaPct: number | null;
    };
    failures: { failed: number; requests: number; pct: number | null; slaPct: number };
    platforms: PlatformRow[];
    pairedUsers: number;
    taps: { perSession: number | null; firstUsed: number; other: number; total: number };
    users: OverlayUserRow[];
  };
}
