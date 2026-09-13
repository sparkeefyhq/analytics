# Users + live analytics handoff

## What is implemented

- `/analytics` and `/plan` re-read same-origin `GET /api/tracker` every 30 seconds while visible. Only analytics fields are replaced: polling cannot overwrite a checklist save or gate evidence. A 15-second timeout and exponential error backoff (up to 120 seconds) limit stalled requests. Visible-tab return refreshes immediately. Source timestamps must remain truthful. This is near-real-time, not guaranteed instantaneous delivery.
- `/users` is below Plan. Staff can browse onboarded users, search the current page, open a user, and see totals, daily counts and activity. No profile content, message text or memory content is displayed.
- The Vercel `api/control-users.js` gateway checks the existing backend's editor authorization on EVERY call, then forwards to the backend's `/api/control/users`. Public callers receive 403 before any user lookup. Browser calls and private responses use no-store. Nothing private belongs in `analytics.phase0`.
- Backend route missing: authorized callers receive `status: unavailable`, never fake users. The backend endpoint is not implemented or connected to PostHog yet. Rahul must implement it, including its own authorization check: the gateway is defense in depth, not a substitute.

## Rahul's connection steps

1. Confirm PostHog project ID, US/EU/self-hosted API origin, shipped event names/properties and app user-ID mapping. Use the actual verified schema, not guessed HogQL names. Send non-secret config and event samples without personal content; store query credentials only in backend secrets.
2. Map `analytics.phase0` per `CONTROL_PHASE0_API_CONTRACT.md`; merge into tracker responses. Use cached aggregate queries with a bounded refresh interval (suggest 30–60 seconds), shared across viewers rather than one PostHog query per tile per browser. Include source watermark, not HTTP request time. Handle 429/timeout, late events and unavailable sources.
3. Implement the private backend endpoints below. Join app profile/onboarding records with PostHog using stable app user ID, not email/phone as the identity key. The app database is authoritative for profile name/contact and onboarding status. PostHog supplies behavioral evidence. Existing onboarded users must be included even if analytics events are missing; their usage is null, not zero. Restrict all reads to authorized staff and configured P0 cohort; never expose an arbitrary SQL/query endpoint.
4. For analytics queries, use PostHog's private query API (`POST /api/projects/{project_id}/query/`) or an agreed saved Endpoint. Use a scoped server-held credential appropriate to the account. Never put it in Vite env variables or browser requests. PostHog project event-capture tokens are not query credentials.
5. Deploy into the isolated preview backend first. Verify the fixtures/acceptance cases below, then validate a consented real test user's events against the source. Do not mutate existing launch evidence or auto-advance phases. No production rollout is authorized here.

## Private API contract, version 1

`GET /api/control/users?cursor=<opaque optional cursor>`

```json
{
  "version": 1,
  "status": "available",
  "updatedAt": "2026-09-13T10:00:00Z",
  "users": [{
    "id": "opaque-app-user-id",
    "name": "Profile name",
    "email": null,
    "phone": null,
    "onboardedAt": "2026-09-13T08:00:00Z",
    "firstOpenAt": "2026-09-13T07:50:00Z",
    "lastActiveAt": "2026-09-13T09:00:00Z"
  }],
  "nextCursor": null
}
```

Use stable ordering/pagination, maximum 50 users per page. Cursor and user IDs must be opaque, at most 256 characters. P0 cohort only; completed onboarding only. `status` is available / pending / unavailable; unavailable is not a measured empty cohort. Return null for unknown contact details. Do not expose emails or phone numbers in URLs.

`GET /api/control/users?id=<opaque app user ID>` returns:

```json
{
  "version": 1,
  "status": "available",
  "updatedAt": "2026-09-13T10:00:00Z",
  "user": {"id":"opaque-app-user-id","name":"Profile name","email":null,"phone":null,"onboardedAt":"2026-09-13T08:00:00Z","firstOpenAt":"2026-09-13T07:50:00Z","lastActiveAt":null},
  "totals": {"wingmanSessions":null,"messages":null,"activeSeconds":null,"profiles":null,"memories":null,"calendarEvents":null},
  "days": [{"day":0,"startedAt":"2026-09-13T07:50:00Z","status":"pending","wingmanSessions":null,"messages":null,"activeSeconds":null,"profiles":null,"memories":null,"calendarEvents":null}],
  "activities": [],
  "activityTruncated": false
}
```

Unknown IDs should return 404 from the backend; no fallback to another user's record. Reject unauthenticated/unauthorized requests with 401/403. `Cache-Control: private, no-store`. Backend verifies staff access and tenant/cohort scope before retrieving the detail. Activity rows are `{id,at,label}` with stable event ID, UTC timestamp and a safe predefined action label, e.g. “Sent a Wingman message”, not message content. Return newest first, bounded to latest 100 events and set activityTruncated when applicable. Daily rows include all observed days, with nulls for uninstrumented days, measured zero only with verified coverage. No future days as zeros.

## Exact per-user measurements

- **Day 0:** [0,24h) after first app open; Day 1 [24,48h), etc. Users deliberately uses developer-style zero-based labels requested by the user. Analytics uses Day 1 for the same first 24h, visibly explained in Users. This changes no legacy advancement definition. An ongoing day is pending and shows observed-to-date counts, not a mature retention result.
- **Wingman sessions:** distinct sessions with at least one accepted user message, not page opens. Retain SDK session ID or documented equivalent; define session boundary consistently. Do not call conversations, messages and sessions the same thing.
- **Messages:** distinct accepted user-message IDs. Retries/regeneration and assistant messages excluded. Daily assignment uses original accepted event time.
- **App time:** measured foreground active seconds, not last-event minus first-event and not raw session duration. Capture lifecycle foreground/background plus periodic activity heartbeats (suggest 15s); cap last unclosed heartbeat at one interval, dedupe intervals, clip to each day and union overlaps across devices. Label this as estimated foreground activity if heartbeats are used. Unknown coverage stays null. A session can include inactivity and is not equivalent to active time.
- **People, memories, calendar:** successful persisted user-created record counts within cohort observation, excluding demo/preloaded records and duplicate delivery. Totals count distinct record IDs created; daily counts assign first successful creation to a day. Deletion/re-add of the same ID is not a new creation. Existing saved-object inventory is separate and must not be relabeled as newly added.
- **Activity:** safe action type + timestamp only. No chat transcripts, names of added contacts, memory content, calendar descriptions or automatic session replay exposure.
- Totals cover cohort observation through the watermark, not necessarily entire account lifetime. User identity/onboarding can exist before instrumentation; do not invent historical events. Day rows and totals must reconcile over the same window.

## Acceptance before calling the connection complete

- Public, signed-out, expired and non-editor sessions cannot fetch list or detail, including direct backend URLs; logout removes displayed private data.
- Real onboarding record appears once; stable ID survives anonymous-to-account merge; email/profile change does not create a new user.
- A test user's accepted message increments their total/day and relevant aggregate; retry does not. Confirm boundary events at exactly 24h and 48h, timezone independence and late arrivals.
- Background the app for ten minutes: foreground-time total must not increase by ten minutes. Test crash, missing background event, overlapping devices and offline heartbeat delivery.
- Check missing source vs available zero, current partial day, source failure, schema mismatch, deleted user, pagination and wrong-ID requests.
- With an authorized isolated test user, verify ingestion-to-UI latency and record actual results; no hard promise of real-time speed before this. Refreshing analytics must not revert checklist edits or advance phases.

References checked: [PostHog API/authentication and rate limits](https://posthog.com/docs/api), [Queries](https://posthog.com/docs/api/queries), [Sessions](https://posthog.com/docs/data/sessions). Official session duration is not automatically a measurement of foreground attention.
