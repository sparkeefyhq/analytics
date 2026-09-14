---
name: analytics-conventions
description: Conventions for working on Sparkeefy Control's analytics data layer (v1 legacy and v2 preview) — the state model, cohort manifest rules, and capability gating. Use whenever touching lib/analytics-v2/*, app/api/analytics/*, or any PostHog/metric definition work in this repo.
---

# Analytics conventions — sparkeefyhq/analytics

This skill covers analytics/backend-plumbing work in this repo only.
**Out of scope**: mobile app code (`sparkeefyhq/sparkeefy-mobile`), and any
frontend visual/UI styling decisions. See `intent.md` for the current mission
context.

## The 5-state model (v2)

Every v2 metric reports one of exactly five states — never a bare number:

- `available` — including a real, verified zero.
- `no-data` — the metric is enabled and eligible, but the cohort/period has
  zero qualifying members or events.
- `not-connected` — a required dependency is missing (PostHog credentials,
  the cohort manifest, coverage boundary, session secret).
- `not-eligible` — the metric's capability isn't turned on because its
  underlying data coverage hasn't been verified.
- `query-error` — the query failed or was rejected (e.g. row-cap overflow).

**Rule: never infer a zero from a null, and never fabricate a capability
just to remove an empty state.** An honest "No data yet" or "Not connected"
is correct behavior, not a bug to paper over.

## Capability gating

`lib/analytics-v2/source.ts` only enables a capability (`KNOWN` set) once its
facts carry the fields it needs — e.g. `wingman`/`responses` require every
message/complete/failed fact to carry a `request` id, or those capabilities
get dropped for that load. Adding a property in PostHog does **not**
automatically enable a metric: normalize it into the typed `Fact` shape in
`source.ts`, add a coverage check, add a test in `tests/analytics-v2.test.
mjs`, then enable the capability.

## Cohort manifest rules

`CONTROL_V2_COHORTS_JSON` (env var, never committed to git) is validated by
`readMembership()` in `source.ts`:
- No duplicate `cohort:id` pairs.
- The same `distinctId` alias can't map to two different stable `id`s.
- No overlapping membership intervals for the same alias — a closed cohort
  needs a verified exclusive `to`; a new cohort for the same person gets a
  new non-overlapping interval under the same stable key.

Never populate this manifest with invented participants or inferred
first-open dates. An empty/unpopulated manifest correctly shows
"Not connected" or "No data yet" — that's expected, not a defect to fix by
guessing values.

## Architectural split

- `lib/analytics-v2/source.ts` — the only place that queries PostHog. Reads
  a fixed 9-event allowlist, never selects a whole `properties` object,
  pseudonymizes identities via HMAC, caps rows at 50,000 and fails closed
  (`query-error`) on overflow.
- `lib/analytics-v2/model.ts` — pure calculation functions only (no I/O).
  Implements Asia/Kolkata day boundaries, half-open D1/D3/D7/D15/D30
  retention windows, ordinal milestone counting, response success/retry
  accounting.
- React/UI code never contains HogQL or PostHog calls directly.

## Preview isolation (v2)

`control-v2-preview` is preview-only. Do not merge or promote it during
Phase 0 — it's the next version of the existing app, not a second product.
Build/database code rejects `VERCEL_ENV=production`; the v2 API route does
too. Synthetic test data (`dataset=test`) is computed in memory and never
written to PostHog or the tracker database.

## Reference

Full technical spec: `CONTROL_V2_HANDOFF.md`. Current tracking: Linear
SPA-12 (parent) and sub-issues SPA-13..16.
</content>
