/** Raw, already-filtered inputs (see dataset.ts for who counts as real). */
export interface Dataset {
  /** When the data was last read from its sources (the older of PostHog and backend). */
  generatedAt: string;
  /** Set when the latest PostHog read failed and older rows are being shown. */
  sourceError: string | null;
  dataStart: string;
  /** Analytics reset: every number counts from here (COUNT_FROM). Absent = full history. */
  countFrom?: string;
  /** returning = an account created before COUNT_FROM that was active after it (active, never a signup). */
  people: { id: string; name: string | null; signupAt: string; team: boolean; returning?: boolean }[];
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
    /** sent only: as_is | edited | own (what the user actually sent after a suggestion). */
    sentOutcome?: string;
    /** drafts: the mood that shaped the reply, and who the chat is with (romantic / friend / family / work / unknown). */
    mood?: string;
    relationship?: string;
  }[];
  /**
   * Onboarding screens reached, one row per person and screen (earliest time). `perm:<name>` rows are
   * permissions turned on. id = account uuid, or `anon:<posthog person>` for installs that never signed in.
   */
  steps?: { id: string; screen: string; ts: string; account: boolean }[];
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
  /** 6 Nov: every in-app message sent, with what happened (answered / safety / failed), from our ledger. */
  chatTurns?: { id: string; at: string; outcome: string }[];
  /** Overlay reply model calls from the backend's ai_call_telemetry (empty until backend PR #357 is live). */
  overlayCalls: { id: string; at: string; request: string; ok: boolean; latency: number | null; cost: number | null }[];
  sources: {
    /** When PostHog rows were last read; null = never (PostHog unavailable). */
    posthogAt: string | null;
    backendAt: string;
    /** First backend overlay call; from here on overlay requests/latency/cost come from the backend. */
    overlayCallsFrom: string | null;
    /** 6 Nov: first row of our own ledger (overlay use, sessions, onboarding); from here on, not PostHog. */
    ledgerFrom?: string | null;
  };
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
  sources: { posthog: 'live' | 'stale' | 'down'; posthogAt: string | null; backendAt: string; overlayCalls: 'backend' | 'posthog'; ledgerFrom?: string | null };
  filters: Filters;
  rangeLabel: string;
  /** Analytics reset time, when set: every number counts from here. */
  countFrom: string | null;
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
  /** Onboarding funnel: how many people reached each screen, in app order. */
  funnel: FunnelStep[];
  /** 6 Nov: installs seen only mid-onboarding (their anonymous id changed); not counted as starts. */
  funnelPartial?: number;
  /** Phase 1 benchmark (BENCHMARK - Phase 1, 20 users): the four gates to expand 20 -> 50. */
  scorecard: Scorecard;
  /** Users tab: one row per account in this audience, with everything the detail panel shows. */
  roster: RosterUser[];
}

export interface FunnelStep {
  screen: string;
  label: string;
  /** People who reached this screen (accounts + installs that never signed in). */
  reached: number;
  /** Share of everyone who started onboarding. */
  pctOfStart: number | null;
  /** Share of the previous step. */
  pctOfPrev: number | null;
  /** Last screen for people who stopped here (did not reach Home). */
  stoppedHere: number;
  permission: boolean;
}

export interface Gate {
  key: 'setup' | 'useful' | 'acted' | 'repeat';
  label: string;
  help: string;
  n: number;
  d: number;
  pct: number | null;
  /** Minimum and stretch, as shares of the cohort (16/20 = 80%). */
  targetPct: number;
  stretchPct: number;
  pass: boolean | null;
  pending?: number;
}

export interface Scorecard {
  cohort: number;
  gates: Gate[];
  diagnostics: { key: string; label: string; value: string; target: string; ok: boolean | null; help: string }[];
  /** Users at or above 80% of a free pilot monthly allowance. */
  nearCap: number;
}

export interface RosterUser {
  id: string;
  name: string | null;
  team: boolean;
  returning: boolean;
  signupAt: string;
  version: string | null;
  lastActive: string | null;
  activeDays: number;
  /** Last 14 IST days, oldest first: 0 none, 1 in-app only, 2 overlay. */
  days: number[];
  journey: {
    firstOpen: string;
    setupAt: string | null;
    firstDraftAt: string | null;
    firstActAt: string | null;
    repeatAt: string | null;
    /** yes | no | pending (7-day window still open) | na (never acted). */
    repeat: 'yes' | 'no' | 'pending' | 'na';
    lastScreen: string | null;
    screens: number;
    permissions: string[];
  };
  overlay: {
    sessions: number;
    drafts: number;
    delivered: number;
    failed: number;
    copied: number;
    inserted: number;
    sent: { asIs: number; edited: number; own: number };
    firstTryPct: number | null;
    usedPct: number | null;
    medianLatency: number | null;
    cost: number;
    apps: { label: string; n: number }[];
    moods: { label: string; n: number }[];
    relationships: { label: string; n: number }[];
  };
  app: { replies: number; cost: number; messages?: number | null; answered?: number | null; safety?: number | null; failed?: number | null };
  /** This IST calendar month vs the free pilot allowance (monetization doc: 100 drafts / 40 answers). */
  quota: { month: string; drafts: number; draftCap: number; answers: number; answerCap: number };
  flags: { key: string; label: string; tone: 'purple' | 'green' | 'red' | 'tan' }[];
}

/** /api/user: details read on demand for one person. */
export interface UserDetail {
  id: string;
  person: { city: string | null; region: string | null; country: string | null; email: string | null } | null;
  conversations: { sessionId: string; startedAt: string; personName: string | null; messages: { role: string; content: string; at: string }[] }[];
  truncated: boolean;
  errors: string[];
}
