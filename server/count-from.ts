import type { Dataset } from './types';

/**
 * Analytics reset (6 Nov, Sarthak + Rahul): every number counts from COUNT_FROM onward.
 *
 * Applied once to the whole dataset, before any metric is computed, so totals, filters,
 * PostHog-sourced and backend-sourced numbers all use the same cutoff and can't disagree.
 * Nothing is deleted at the source; unset COUNT_FROM to see the full history again.
 *
 * Rules:
 *  - Every timestamped row (activity, overlay events, sessions, chat replies, model calls,
 *    costs) before the cutoff is dropped.
 *  - An account counts if it signed up after the cutoff OR was active after it. An older
 *    account that comes back counts as an active user, but never as a new signup.
 *  - Signups, onboarding and retention cohorts only include accounts created after the
 *    cutoff, because only those were watched from their first screen.
 */
export function applyCountFrom(data: Dataset, countFrom: string | null): Dataset {
  if (countFrom === null) return data;
  const cut = Date.parse(countFrom);
  if (!Number.isFinite(cut)) return data;

  const after = (value: string) => Date.parse(value) >= cut;
  // Hourly buckets from the cutoff's hour on (IST midnight is a whole UTC hour).
  const activity = data.activity.filter((r) => Date.parse(r.hour) >= cut - (cut % 3_600_000));
  const overlay = data.overlay.filter((r) => after(r.ts));
  const sessions = data.sessions.filter((r) => after(r.ts));
  const aiCost = data.aiCost.filter((r) => after(r.at));
  const chatReplies = data.chatReplies.filter((r) => after(r.at));
  const overlayCalls = data.overlayCalls.filter((r) => after(r.at));

  const newSince = new Set(data.people.filter((p) => after(p.signupAt)).map((p) => p.id));
  const activeSince = new Set<string>([
    ...activity.map((r) => r.id),
    ...overlay.map((r) => r.id),
    ...sessions.map((r) => r.id),
    ...chatReplies.map((r) => r.id),
    ...overlayCalls.map((r) => r.id),
  ]);
  const people = data.people
    .filter((p) => newSince.has(p.id) || activeSince.has(p.id))
    // A returning account counts as active but is never a signup or in a retention cohort.
    .map((p) => (newSince.has(p.id) ? p : { ...p, returning: true }));

  const cutDay = new Date(cut + 5.5 * 3_600_000).toISOString().slice(0, 10); // IST date
  return {
    ...data,
    dataStart: cutDay > data.dataStart ? cutDay : data.dataStart,
    countFrom: new Date(cut).toISOString(),
    people,
    activity,
    overlay,
    sessions,
    aiCost,
    chatReplies,
    overlayCalls,
    // Onboarding screens have no time: only accounts created after the cutoff.
    onboarding: data.onboarding.filter((r) => newSince.has(r.id)),
    versions: data.versions.filter((v) => newSince.has(v.id) || activeSince.has(v.id)),
    sources: {
      ...data.sources,
      overlayCallsFrom:
        data.sources.overlayCallsFrom === null ? null : after(data.sources.overlayCallsFrom) ? data.sources.overlayCallsFrom : overlayCalls.length ? new Date(cut).toISOString() : null,
    },
  };
}
