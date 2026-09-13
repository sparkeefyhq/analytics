# Master prompt: connect Sparkeefy Control to real Phase 0 data

You are implementing the backend integration for the existing Sparkeefy Control website. The Analytics, Plan and private Users screens already exist. Connect them to verified app records and PostHog data; do not redesign the UI, introduce unrelated features, reset launch state, or weaken advancement gates. Work in preview first. Do not production-deploy without separate approval.

## 1. Establish the exact code and deployment

Repository: https://github.com/sparkeefyhq/analytics (private), branch main. Use the latest migration commit; older Sites SHAs and proxy instructions are obsolete.

Read README.md, CONTROL_PHASE0_API_CONTRACT.md, USERS_POSTHOG_HANDOFF.md, vercel-static/src/phase0-data.ts, phase0.tsx, users.tsx, live-data.ts, control.tsx, server/vercel-handler.ts, lib/vercel-database.ts and app/api/tracker/route.ts.

Vercel account: sparkeefy@gmail.com. Team: sparkeefys-projects. Project: sparkeefy-launch-control. Project ID: prj_jnhFefxVNmT70PzO2gED37mHtCti. Live URL: https://sparkeefy-launch-control.vercel.app. Frontend AND backend now run on Vercel. Turso database resource: sparkeefy-analytics. No ChatGPT runtime or proxy credentials are needed.

The owner removed password login. Public analytics are view-only; editing and personal user analytics are denied. Before enabling Users list/detail with email, phone or individual behavior, establish an owner-approved staff authentication mechanism. Never remove authorization merely to populate that screen.

TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are server-only environment variables supplied by the Vercel integration. Keep SPARKEEFY_DATABASE_IMPORTED=true and SPARKEEFY_PUBLIC_READONLY=true. Never reset/import over the launch database. Use an isolated development/preview database for mutation tests. The initial migration preview reads the migrated database, so it is NOT a writable sandbox.

Implement API handlers here directly; do not restore api/proxy.js, api/control-users.js, or SPARKEEFY_BACKEND_ORIGIN. The /api/control/users handler in server/vercel-handler.ts currently returns unavailable for authorized users, not real measurements. The aggregate adapter belongs in the server tracker response as analytics.phase0.

## 2. Audit PostHog before writing queries

Confirm the real project ID and regional/self-hosted API origin. Obtain a scoped server-side query credential via secret configuration, not chat, source code or a Vite public environment variable. Do not confuse the public event-capture token with a private query credential.

Inspect actual emitted event names, properties, identity handling, timestamps, SDK/session behavior and app build/environment. Produce a mapping from each required metric to the verified source event or database record. Do not invent event names or claim data exists because an SDK was installed. Resolve missing instrumentation explicitly. Preserve a measurement-start timestamp and show unknown historical periods as unknown rather than fabricating backfills.

App/backend must supply stable pseudonymous app user IDs, event/message/request IDs, event time, received time, session ID, environment/build, cohort membership and return attribution where known. Merge anonymous-to-account identity correctly; email/phone changes or reinstall must not duplicate or restart the same user. Exclude staff/test/demo activity from real cohort metrics.

## 3. Implement the three existing frontend contracts

A. `GET /api/tracker`: preserve the entire existing response and add `analytics.phase0`:
```json
{"version":1,"cohort":"phase-0","updatedAt":null,"metrics":{},"activeUsers":{}}
```
Each observation is `{count:number|null, denominator?:number|null, pending?:number, excluded?:number, status:"available"|"pending"|"unavailable"|"error", source:"posthog"|"play-console"|"manual"|"reconciled"}`.

Populate the canonical metric IDs:
- `downloads`, `first_open`, `onboarding`, `first_answer`.
- `wingman_open_day1`, `first_message_day1`, `five_messages_day1`.
- `person_1`, `person_2`, `person_3`, `memory_1`, `memory_2`, `calendar_created`.
- `return_open_day2`, `return_open_day3`, `return_open_day4`.
- `return_request_day2`, `return_request_day3`, `return_request_day4`.
- `organic_second`, `request_days_2`, `request_days_3`, `person_reused`, `memory_reused`, `reminder_return`, `opportunity_repeat`.
- `responses_complete`, `responses_failed`, `responses_retried`.

`activeUsers` supplies separate `today`, `week`, `month`, `all` observations. Use Asia/Kolkata calendar boundaries, Monday week start and month-to-date. These filters affect active-user counts, not the fixed per-user cohort day windows.

B. `GET /api/control/users?cursor=<optional opaque cursor>` on the backend: return `{version:1,status,updatedAt,users,nextCursor}`. Each user has `id,name,email,phone,onboardedAt,firstOpenAt,lastActiveAt`. Include actual onboarded P0 cohort users from the app database, even if their event data is missing. Use null usage values for those users. The app DB is authoritative for name/contact/onboarding; join PostHog by stable app user ID. Maximum 50 per page, stable ordering, opaque cursors no longer than 256 characters.

C. `GET /api/control/users?id=<opaque user ID>`: return `{version:1,status,updatedAt,user,totals,days,activities,activityTruncated}`. `totals` contains nullable `wingmanSessions,messages,activeSeconds,profiles,memories,calendarEvents`. Each daily row contains the same fields plus `day,startedAt,status`. Activity rows contain only `{id,at,label}`, newest first, capped at 100 with truncation disclosed. Use safe predefined action labels, never private content. Follow exact JSON examples in USERS_POSTHOG_HANDOFF.md. Unknown users return 404, never another user's data.

## 4. Preserve meaningful definitions

- The 15-user cohort target is not automatically an observed denominator. “Total” in launch gates is the existing `actualDenominator`; this was a label change, not a schema or gating change.
- Count distinct users for adoption/retention; count distinct requests for response health. Never sum overlapping users or average subgroup percentages.
- Analytics Day 1 is the first 24 hours after first app open, Day 2 is [24,48h), Day 3 [48,72h), Day 4 [72,96h). Users labels the same initial window Day 0 and explains this mapping. Keep one immutable first-open anchor per user. Legacy server gate definitions stay unchanged.
- Mature retention denominators include only users whose complete observation window ended; disclose pending/excluded users. Do not classify an unobserved day as a failed return. Current user-detail days may show observed-to-date activity with pending status.
- Five messages means five distinct accepted user messages, excluding retries, regenerated answers and assistant output. Wingman sessions require at least one accepted user message, not just an open.
- Google Play downloads/install aggregates are not first app opens and may not be linkable to the P0 cohort. Leave downloads unavailable without the appropriate source.
- People/memories/calendar events require successful persistence, deduped stable record IDs and exclusion of preloaded/demo records. Do not conflate existing inventory with new creation events.
- Organic second real situation is within 72h of the first complete answer and requires situation evidence. A second message or new conversation is not automatically a second real situation. Unknown founder/reminder attribution is unknown, not organic. Opportunity-adjusted repeat requires interview evidence and does not replace overall retention.
- No in-product response rating exists: do not build a rating feature/event or fake a usefulness score. Existing manual gate evidence stays intact.
- No proactive notifications exist in P0. Leave unsupported reminder metrics unavailable; do not introduce a notification feature merely to fill analytics.
- Foreground app time must exclude background/idle intervals. Use lifecycle events and bounded activity heartbeats, dedupe/union overlapping intervals across devices, clip intervals to day boundaries and cap missing final heartbeats. Label estimates appropriately. Raw session duration or last-event minus first-event is not foreground usage. Leave unavailable without sufficient instrumentation.
- Null is unknown, available zero is measured zero. Source freshness must be a real data watermark, not the time an HTTP request was served. Late events must safely correct aggregates.

## 5. Enforce privacy and authorization

Public tracker data must contain only approved aggregates: never names, emails, phones, raw events identifying users, chat text, memory content, contact names or calendar titles. Names/contact and individual analytics belong only in the private Users endpoint.

The native Vercel Users handler checks `canEdit` before any lookup. Password login is now disabled at the owner's request, so the public deployment denies this endpoint. Establish owner-approved staff authentication before wiring personal data, then enforce staff authorization and cohort/tenant restrictions inside every handler. Public, signed-out, expired and non-editor sessions must fail closed before any private lookup. Return private/no-store headers, never public CDN-cache private responses, and do not log personal details or credentials. Test direct `/api/native?path=/api/control/users` access as well as the friendly route. Do not introduce a public query proxy.

## 6. Make the existing refresh path work

Browser -> same-origin Control API -> trusted backend -> PostHog private query API or agreed saved Endpoint.

The UI checks every 30 seconds while visible, refreshes on return, uses a 15-second timeout and backs off on errors up to 120 seconds. Analytics refresh replaces analytics only, preserving optimistic checklist edits and manual gates. No direct browser PostHog calls are needed.

Use bounded server-side caching/materialization (initially 30–60 seconds) shared across viewers; do not query PostHog separately for every tile and poll. Keep private results properly scoped. Respect 429/Retry-After and failures. Return truthful freshness/unavailable states rather than silently stale values. Use the verified regional private endpoint, such as `POST /api/projects/{project_id}/query/`; inspect actual PostHog docs/schema before finalizing queries. This is near-real-time subject to SDK buffering, ingestion, cache and polling delay—not an instantaneous guarantee.

## 7. Smoke and acceptance checks

Run the existing build and tests:
```sh
npx vite build --config vercel-static/vite.config.ts
node --experimental-strip-types --test tests/users-api.test.mjs tests/phase0-contract.test.mjs tests/control-interactions.test.mjs
```
Four existing TypeScript errors in legacy main.tsx were reported before this integration; record separately and do not claim a clean full typecheck without resolving them.

Use isolated fixtures and a consented test user, never reset or advance valuable launch state. Verify:
1. Tracker fields, phase timestamps, manual evidence, checklist history and all hard-zero/release/server advancement gates remain unchanged.
2. All required aggregate IDs and four active-user periods match independent source counts. Filters change the correct fields.
3. Onboarding appears once in the private Users list; opening that user returns the matching profile and activity only.
4. One accepted message updates user/day and aggregate counts after ingestion; retries do not add messages. Test events exactly at 24/48/72/96h and late/offline delivery.
5. Missing data, measured zero, pending maturity, source failure, wrong schema, deleted/wrong user, pagination and identity merge are handled honestly.
6. Background the app for ten minutes: app-time totals must not grow by ten minutes. Test crash, missing background event, and multi-device overlap.
7. Signed-out/non-editor users receive 401/403 for private list/detail, including direct backend URLs. Logout clears private UI. No personal rows or credentials appear in public API responses or frontend assets.
8. Automatic refresh works without reloading and cannot revert pending checklist edits. Verify hidden-tab pause, resume, timeout and failure recovery.
9. Browser desktop/mobile, navigation/back, Users search/detail, timestamps and console/network errors pass.
10. Measure actual event-to-dashboard latency and report it; do not merely say “real-time works.”

## 8. Deliverables

Return exact repo/commit SHAs containing the implementation, backend deployment identity, preview URL, non-secret configuration names, event-to-metric mapping, supported/unavailable metrics, tests and measured latency, data/schema changes and rollback steps. Confirm no production promotion, no historical data loss, no weakened gates and no private information exposed publicly. If access or instrumentation is missing, state the exact blocker and leave affected metrics unavailable. Do not call the connection complete until it is verified through the real preview backend and browser.

Reference docs: https://posthog.com/docs/api · https://posthog.com/docs/api/queries · https://posthog.com/docs/data/sessions
