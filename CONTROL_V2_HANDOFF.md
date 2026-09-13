# Control v2 — preview only

Branch: `control-v2-preview` from `143feb37b30f7ea5f1e9a8c499d4c30efed72edf` in `sparkeefyhq/analytics`.

Do not merge or promote during Phase 0. This is the next version of the existing application, not a second maintained product.

## Isolation and production preservation

- Same Vercel project: `sparkeefys-projects/sparkeefy-launch-control`.
- New free Turso database: `sparkeefy-v2-preview`, resource `store_SZ3cdj1SN1vgDzMr`, connected to **Preview only**, with `V2_`-prefixed variables.
- Preview requires `V2_TURSO_DATABASE_URL` / `V2_TURSO_AUTH_TOKEN`. Missing configuration or equality with the production URL fails closed. There is no production database fallback.
- Build and database runtime reject `VERCEL_ENV=production`. The v2 endpoint also rejects production. Remove these locks only at an approved cutover.
- Preview Plan uses freshly seeded test state, copying only definition columns (labels, targets, phase scope). No production evidence, notes, timestamps, completion status or participant history was copied. Legacy Plan definitions, gating, timestamps, checklists, tracker route and Phase 0 PostHog calculations were not rewritten.
- Synthetic analytics is computed in memory, visibly labelled, and available only in preview or explicitly enabled local tests. It is never written to PostHog or the tracker database.
- Analytics/Users load a small access response instead of downloading the legacy tracker analytics payload. Real user investigation still requires the existing admin session. Synthetic users are not real people and can be inspected without login in preview.

Read-only inspection on 2026-09-13 found production's persisted Phase 0 status `ready`, `started_at=null`, and an empty cohort ledger. This is an observed discrepancy with the described running launch, not permission to repair/reset it. No attempt was made to change it.

## API

`GET /api/analytics/v2?cohort=phase-0&period=7d&dataset=live`

- Cohorts: `all`, `phase-0`, `phase-1a`, `phase-1b`, `phase-2`.
- Periods: `today`, `7d`, `30d`, `all`.
- Add `view=users` for the authorized pseudonymous investigation DTO.
- `dataset=test` is the clearly labelled synthetic QA dataset, isolated from live metrics.
- Shape: `version:2`, mode, source execution time, coverage start, active filters, metrics, retention, users, exclusion count.
- Every domain metric has `value`, `state`, `source`, `detail`, optional unit, and ratios have numerator/denominator/pending.
- States: `available` (including real zero), `no-data`, `not-connected`, `not-eligible`, `query-error`. Never infer zero from a null.
- UI refreshes every 30 seconds while visible; live source is cached in server memory for 30 seconds. This is near-real-time polling, not streaming. The timestamp is query execution time, not proof of the last product event.
- No raw PostHog properties, email, name, phone, prompts, responses, relationship text or memory content are in the v2 DTO. Source participant IDs are HMAC-pseudonymized; request/person IDs never leave the server.

## Cohort reconciliation required before enabling real v2 numbers

Existing Phase 0 production analytics deliberately queries the whole project after its launch-reset watermark. That is **not** a trustworthy immutable cohort ledger. V2 does not silently reuse it as Phase 0 membership.

Rahul/founder must reconcile a server-only manifest (`CONTROL_V2_COHORTS_JSON`) and a verified event coverage boundary (`CONTROL_V2_COVERAGE_FROM`). Do this in the preview environment first. Keep the manifest outside Git; identifiers can be sensitive. Format:

```json
[
  {
    "id": "stable-internal-participant-key",
    "distinctIds": ["verified-posthog-distinct-id"],
    "cohort": "phase-0",
    "from": "2026-09-13T10:01:00Z",
    "firstOpen": "2026-09-13T10:05:00Z",
    "internal": false,
    "test": false,
    "acquisition": "referral"
  }
]
```

Example timestamps above are illustrative, not actual launch evidence. Use verified original timestamps. `firstOpen` may be null when unobserved. Acquisition values: organic/referral/paid/founder/unknown. No free-text acquisition labels are accepted.

When a cohort closes, add its verified exclusive `to` timestamp. Freeze/version/archive that manifest with the historical reconciliation. Future cohorts get their own membership intervals. The same identity may occur in non-overlapping intervals, never overlapping ones, and must retain the same stable participant key. Duplicates/overlaps fail validation. `all` means unique people in all reconciled memberships, not all anonymous PostHog traffic. Returning people are deduplicated, membership gaps excluded, and user details list all selected cohort affiliations.

Current manifest is intentionally not populated with invented participants or inferred first-open dates. Live v2 therefore says **Not connected** until this reconciliation is supplied. An empty *configured* manifest/selected cohort produces **No data yet**, not a fabricated zero cohort.

## Definitions (v2 only)

| Measure | Rule |
|---|---|
| Cohort | Explicit allowlist, internal/test members excluded; events outside membership interval excluded. Explicit internal/test events and non-production environments are excluded too. Missing historical flags rely on the reconciled allowlist and must be audited before enabling coverage. |
| Time | Today starts at midnight Asia/Kolkata; 7D/30D are rolling elapsed periods; All is bounded by verified source coverage and cohort intervals. |
| Active | Distinct cohort users with foreground/product activity, not background response completions. |
| First milestones | First observed message/complete answer within cohort history must fall in the selected time range, with coverage from first open. |
| Adoption milestones | Distinct users with observed ordinal counts reaching at least N in the selected period. These are overlapping adoption counts, not a sequential conversion funnel. |
| People/memory averages | Observed peak counts up to snapshot time, among active users in the selected period. Explicitly labelled observed counts; they are not current inventory after deletion. Current inventory needs an authoritative backend snapshot. |
| Meaningfully activated | Explicitly verified activation among users who onboarded in the selected period. Never inferred from message volume or response ratings. |
| Retention Dn | `[firstOpen+n×24h, firstOpen+(n+1)×24h)`. Full window must close before admission. Time filter selects window-end dates, without changing the first-open anchor. Pending is excluded from both numerator and denominator. |
| Historical retention | Windows extending beyond a closed cohort's end, or anchored before reliable coverage, are excluded. Do not use later Phase 1 events to fill Phase 0 windows. |
| Wingman return | A distinct user request in the eligible window; opening alone is not a Wingman return. |
| Genuine situation | A separately verified, opaque situation identifier, not message count or an arbitrary chat opening. |
| Organic second situation | Second distinct verified situation in selected period, positive organic attribution and explicitly independent. Unknown attribution is not organic. |
| Messages | Deduplicated user request IDs; retries do not multiply message counts. |
| Sessions | Distinct session IDs, never calendar-day approximations. |
| Frequencies | Each named window intersects the global time filter; per-active-user denominators use activity in that same intersection. User drilldowns show raw counts. |
| Active days | Distinct Asia/Kolkata calendar dates with product activity. |
| Foreground time | Deduplicated measured foreground intervals only; no background or session-age approximation. |
| Response success | Complete / (complete + failed resolved requests). Completion supersedes a failed attempt for the same request. In-flight requests excluded. |
| Retries | Unique requests with `recovery_triggered=true`; not an inferred retry-attempt count. |
| Latency | Nearest-rank median/p95 over recorded completed-response latency, milliseconds. |
| AI cost/tokens | Complete billable-usage coverage, including failures/retries; missing fields withhold totals. No hardcoded model prices. |
| Cost ratios | Same selected population and period. A missing/zero denominator gives unavailable, never infinity or zero cost. |
| Projection | User-entered active-user scenario × measured cost/active user for selected period. Not a forecast. |
| Return attribution | Requests after first 24h split organic/reminder/founder/unknown; attribution is not causal evidence. |

Phase 0 **Plan** retains its legacy Day 2/3/4 in-progress measurement and server gates. The new closed-window v2 retention intentionally differs and must be reconciled explicitly, not silently substituted into gates.

## Source coverage / Rahul's next work

The typed server adapter lives in `lib/analytics-v2/source.ts`; calculations in `model.ts`; React contains no HogQL.

| Data | Existing source / next dependency |
|---|---|
| First opens/onboarding | Existing `first_open`, `onboarding_completed`. Reconcile identities and earliest reliable timestamps. |
| People 1/2/3/5 | Existing `person_context_created.person_count_after`. Missing ordinal fields disable these metrics. |
| Memory 1/3/5/20 | Existing `memory_added.memory_count_after`. Same coverage requirement. |
| Wingman open/message/response | Existing `wingman_opened`, `response_started`, `response_completed`, `response_failed`. Missing request IDs disable message/response metrics rather than inflate them. |
| Retries | Existing outcome `recovery_triggered` flag, deduplicated by request. |
| Wingman retention | Existing request events plus reconciled first-open and complete time coverage. |
| App return | Awaiting verified general app foreground/return instrumentation. Wingman opens alone must not be presented as all-app retention. |
| Downloads | Play Console connector, store population/date context. Cannot join downloads one-to-one to users. |
| Meaningful activation / genuine situations / organic repeat | Verified qualification, stable opaque situation ID, organic vs prompted attribution and assistance fields. No ratings assumed. |
| Sessions / foreground time | Stable session IDs and deduplicated foreground intervals with app lifecycle handling. |
| People actually used | Existing contact/context instrumentation needs verified join semantics and adapter mapping; a contact ID alone is not proof context was used. |
| Memory reused later | Actual memory injection capability and verified later-use event; creating a memory does not prove it was consumed. |
| Current people/memory inventory | Backend authoritative counts including deletion, not event-count guesses. |
| Fallbacks / latency | Explicit fields/events and complete coverage before enabling capabilities. |
| Tokens / cost | Backend billing usage with unique attempt IDs, input/output tokens, actual USD cost and coverage accounting for retries/failures. |

Adapter capabilities are explicit and deliberately conservative. Adding properties in PostHog alone does not automatically enable unsupported metrics: normalize them into the typed facts, implement coverage checks, add tests, then enable the corresponding capability. Never toggle capabilities just to eliminate empty states.

The query only selects allowlisted metadata, never a whole `properties` object. It is capped at 50,000 rows and fails closed on overflow instead of returning partial totals. Before scale, add proper server pagination or equivalent aggregate queries with identical definitions. Do not remove the bound without tests.

## Verification and cutover

Local API: `node scripts/build-vercel-api.mjs`, then `node scripts/dev-v2.mjs`; frontend: `npx vite --config vercel-static/vite.config.ts`. The local API creates a fresh temporary SQLite database, clears PostHog credentials, and never loads production env files. Open `/analytics?dataset=test`.

Checks: `npm run build`, `npx tsc --noEmit`, scoped `npx oxlint`, `npm test`. Tests cover maturity boundaries, half-open windows, all five retention days, cohort/time separation, exclusions, milestones, frequency windows, request deduplication, source states, privacy, authorization, and preview isolation. Existing Plan/auth/gating tests run against isolated SQLite.

Before production cutover:

1. Close Phase 0 operationally; export and hash its launch state, manifest, and reconciled PostHog results. Do not reset or edit historical events.
2. Reconcile each supported v2 metric independently against PostHog using the v2 definitions. Record intentional differences from Phase 0 v1.
3. Validate all identity aliases, membership windows, internal/test exclusions and time coverage. Unmapped traffic remains excluded; investigate it rather than auto-enrolling it.
4. Wire and validate remaining capabilities with known test records. Confirm source-state behavior and per-user privacy.
5. Obtain explicit production cutover approval, remove preview locks/test selector appropriately, and migrate only additive configuration/schema. Preserve historical cohorts and the existing Plan state.
6. Merge this branch into the single maintained application and deploy once approved. Retire disposable preview resources only after testing/history are safely retained.
