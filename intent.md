# Agent intent — sparkeefyhq/analytics (Control)

Working notes for how an agent should operate in this repo. Not a policy doc —
`CONTROL_V2_HANDOFF.md` is canonical for the v2 technical spec. This is where
the working mission model lives, so a future session doesn't have to re-derive
it from scratch.

## Mission, right now

This repo is Sparkeefy's "Control" dashboard: the internal tool the founder
and Rahul use to see how the live product is actually performing. It currently
has two generations of analytics living side by side:

- **v1 (legacy, on `main`, in production)** — the Phase 0 dashboard. It has a
  real, currently-diagnosed bug: PostHog is tracking far more "unique users"
  than real accounts exist, because anonymous PostHog IDs aren't merging to
  the logged-in user after signup/login. This makes `First app opens`,
  `Onboarding completed`, and Day-2/3 retention tiles all show numbers that
  don't reconcile against each other or against Supabase's real user count.
- **v2 (branch `control-v2-preview`, preview-only)** — a from-scratch rewrite
  that refuses to repeat that mistake. It has a strict 5-state model
  (`available` / `no-data` / `not-connected` / `not-eligible` / `query-error`)
  and a capability system that only turns a metric on once its real data
  coverage is verified — it never infers a zero from a null, and never
  fabricates a number to fill an empty state.

## Standing instructions

- **Do not merge or promote `control-v2-preview` during Phase 0.** It is the
  next version of this application, not a second maintained product. Treat
  its preview-only locks (production env checks, `V2_`-prefixed env vars) as
  load-bearing, not incidental.
- **The cohort manifest (`CONTROL_V2_COHORTS_JSON`) is server-only and never
  invented.** It is not committed to git. Do not populate it with guessed
  participants or inferred first-open timestamps — an empty/unpopulated
  manifest correctly means "Not connected," and that is the right state to
  show until a human reconciles real data.
- **Never fabricate a capability to remove an empty state.** If a metric's
  underlying event/field coverage isn't verified, it stays disabled
  (`lib/analytics-v2/source.ts`'s `KNOWN` capability set) — showing "No data
  yet" honestly beats showing a plausible-looking wrong number.
- **React contains no HogQL.** The typed server adapter (`lib/analytics-v2/
  source.ts`) is the only place that talks to PostHog; calculations live in
  `lib/analytics-v2/model.ts` as pure functions. Don't reach around this split.
- **Scope boundary: analytics/backend-plumbing only.** This repo's Claude work
  never touches mobile app code (that's `sparkeefyhq/sparkeefy-mobile`) and
  never makes frontend visual/UI styling decisions — only the data layer,
  metric definitions, and the API contract.

## Where things live

- v2 typed adapter: `lib/analytics-v2/source.ts` (PostHog read + cohort
  validation + capability gating), `lib/analytics-v2/model.ts` (pure
  calculations), `lib/analytics-v2/fixture.ts` (synthetic QA dataset).
- v2 API route: `app/api/analytics/v2/route.ts`.
- v2 tests: `tests/analytics-v2.test.mjs` (model), `tests/analytics-v2-api.
  test.mjs` (API contract — auth, privacy allowlisting, preview isolation).
- Full v2 technical spec, API shape, and the "Source coverage / Rahul's next
  work" table of pending capabilities: `CONTROL_V2_HANDOFF.md`.
- Legacy v1 Phase 0 dashboard/contract: `CONTROL_PHASE0_API_CONTRACT.md`,
  `RAHUL_POSTHOG_MASTER_PROMPT.md`, `USERS_POSTHOG_HANDOFF.md`.
- Tracking source of truth for the current requirements pass: Linear SPA-12
  (parent) and its sub-issues SPA-13..16.
</content>
