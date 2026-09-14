export type Period = 'today' | 'week' | 'month' | 'all';
export type Observation = {
  count: number | null;
  denominator?: number | null;
  pending?: number;
  excluded?: number;
  status: 'available' | 'pending' | 'unavailable' | 'error';
  source: 'posthog' | 'play-console' | 'manual' | 'reconciled';
};
export type TopUser = { distinctId: string; email: string | null; name: string | null; messageCount: number };

/** Optional, additive GET /api/tracker.analytics.phase0 contract. */
export type Phase0Snapshot = {
  version: 1;
  cohort: 'phase-0';
  updatedAt: string | null;
  metrics: Record<string, Observation>;
  activeUsers?: Partial<Record<Period, Observation>>;
  topUsers?: TopUser[];
  topUsersNameSource?: 'ok' | 'not_configured' | 'unauthorized' | 'backend_error' | 'network_error';
  /** The backend's live ANALYTICS_PHASE, read off recent events — not a UI assumption. */
  activePhase?: 'phase_0' | 'phase_1' | null;
};
export const groups = [
  { title: 'Getting started', rows: [
    ['downloads', 'Downloads', 'Google Play installs · store aggregate'],
    ['first_open', 'First app opens', 'Opened the installed app'],
    ['onboarding', 'Onboarding completed', 'Finished account setup'],
    ['wingman_open_day1', 'Opened Wingman', 'Day 1 · first 24 hours'],
    ['first_message_day1', 'Sent their first message', 'Day 1 · accepted by Wingman'],
    ['five_messages_day1', 'Sent 5 messages', 'Day 1 · distinct user messages'],
    ['first_answer', 'Received a complete answer', 'First response rendered in the app'],
  ] },
  { title: 'People & memory', rows: [
    ['person_1', 'Added a person', 'At least 1 saved person'],
    ['person_2', 'Added a second person', 'At least 2 saved people'],
    ['person_3', 'Added a third person', 'At least 3 saved people'],
    ['memory_1', 'Added a memory', 'At least 1 user-saved memory'],
    ['memory_2', 'Added a second memory', 'At least 2 user-saved memories'],
    ['calendar_created', 'Added a calendar event', 'Successfully saved'],
  ] },
  { title: 'Repeat value', rows: [
    ['organic_second', 'Second real situation', 'Organic · within 72h of first complete answer'],
    ['request_days_2', 'Used Wingman on 2+ days', 'Days 1–3 · sent a message'],
    ['request_days_3', 'Used Wingman on all 3 days', 'Days 1–3 · sent a message'],
    ['person_reused', 'Reused saved person context', 'Used in a later Wingman session'],
    ['memory_reused', 'Reused saved memory', 'Included in a later complete response'],
    ['reminder_return', 'Returned from a reminder', 'Reminder-assisted · sent a message'],
    ['opportunity_repeat', 'Returned when a new situation arose', 'Interview-confirmed opportunity'],
  ] },
  { title: 'Response health', rows: [
    ['total_messages_sent', 'Total messages sent', 'Every Wingman request, all users'],
    ['responses_complete', 'Complete responses', 'Completed / accepted requests'],
    ['responses_failed', 'Failed responses', 'Unique requests with a terminal failure'],
    ['responses_retried', 'Retried requests', 'Retries do not count as new messages'],
  ] },
] as const;

export function observation(snapshot: Phase0Snapshot | undefined, key: string): Observation | undefined {
  if (snapshot?.version !== 1 || snapshot.cohort !== 'phase-0') return undefined;
  return snapshot.metrics?.[key];
}
export function countText(item?: Observation): string {
  if (!item || item.status !== 'available' || !Number.isSafeInteger(item.count) || item.count! < 0) return '—';
  return item.count!.toLocaleString('en-IN');
}
export function statusText(item?: Observation): string {
  if (!item || item.status === 'unavailable') return 'Not connected';
  if (item.status === 'pending') return 'Observing';
  if (item.status === 'error') return 'Source unavailable';
  return {posthog:'PostHog', 'play-console':'Google Play', manual:'Manual', reconciled:'Reconciled'}[item.source];
}
