# Phase 0 frontend integration contract

The new Plan and Analytics views consume the same optional `analytics.phase0` field from GET /api/tracker. Rahul adds this field when PostHog is connected. Existing backend responses continue working; absent fields display a dash. Do not reuse the legacy manual analytics fields as live-event substitutes.

Canonical TypeScript definitions and metric IDs: `vercel-static/src/phase0-data.ts`. UI: `vercel-static/src/phase0.tsx`.

## Response shape

```json
{
  "analytics": {
    "phase0": {
      "version": 1,
      "cohort": "phase-0",
      "updatedAt": null,
      "metrics": {},
      "activeUsers": {}
    }
  }
}
```

Merge this into the existing analytics object. Each metric value is `{count: number|null, denominator?: number|null, pending?: number, excluded?: number, status: 'available'|'pending'|'unavailable'|'error', source: 'posthog'|'play-console'|'manual'|'reconciled'}`. Zero with available status is a measured zero; null/absent is unknown. No percentages or automatic pass status are rendered. `updatedAt` is source freshness, not request time. Unknown IDs are ignored. All other tracker fields, authorization, checks, historical evidence and server gates are preserved.

`activeUsers` has `today`, `week`, `month`, `all` keys containing observations; frontend switching reads the matching aggregate, never relabels a single number. Use Asia/Kolkata calendar boundaries, Monday start for week, month-to-date, all since measurement start. Count unique eligible cohort users with actual foreground activity. Return all four snapshots together.

## Time convention (clarifies earlier draft/PDF)

For the user-facing adoption panel, Day 1 is [0,24h), Day 2 [24,48h), Day 3 [48,72h), Day 4 [72,96h) since first app open. This avoids excluding users who never sent a message. Anchor once per identified cohort user; reinstallation must not restart it. Compute from event time in UTC. The legacy launch retention gates are NOT redefined by this convention.

Organic second situation is separately anchored to the first complete answer and observed for 72h. Since the last participant needs a full observation window, the phase countdown reaching zero must not auto-complete these metrics. Days 1-3 stickiness needs 72h maturity; Day 4 needs 96h.

## Metric IDs and denominators

All counts are unique eligible users unless marked request/store counts. Enrollment target 15 is a target, not automatically a measured denominator. Only confirmed cohort membership supplies the recruited population.

- `downloads`: Google Play store-defined aggregate, no cohort denominator unless independently linkable. Never substitute first open. Use unavailable if Play data is absent.
- `first_open`, `onboarding`, `first_answer`: users reaching each milestone, denominator eligible enrolled cohort. No forced ordering through optional people/memory features.
- `wingman_open_day1`, `first_message_day1`, `five_messages_day1`: first 24h since first open. Denominator users with a finished first 24h; unfinished users in pending. Five distinct accepted user-message IDs; retries, regeneration and assistant output do not add messages.
- `person_1`, `person_2`, `person_3`, `memory_1`, `memory_2`, `calendar_created`: unique users achieving persisted milestones during cohort observation; denominator enrolled cohort. Exclude preloaded/demo records, count only user-created/user-confirmed memory. Re-adding the same record is not a new person. Include an initial state snapshot for existing users rather than fabricating old creation events.
- `return_open_day2`, `return_open_day3`, `return_open_day4`: unique cohort first-open users with an organic foreground Wingman open in that exact window / first-open users whose full window ended.
- `return_request_day2`, `return_request_day3`, `return_request_day4`: same population/window, accepted user message required. Count opens and requests separately.
- `organic_second`: verified second distinct real situation within 72h after first complete answer / eligible first-value users with 72h maturity. Verify situation identity in manual evidence; a new request or conversation alone does not establish a new situation.
- `request_days_2`, `request_days_3`: users with accepted messages on >=2 or all 3 first-open-relative days / users with full 72h maturity. Show observed counts, no pass thresholds.
- `person_reused`, `memory_reused`: prior adopters with the saved context included in a later completed Wingman session / adopters with a full 72h post-adoption opportunity. Context included is a technical reuse signal, not proof the answer helped. UI must not claim usefulness automatically.
- `reminder_return`: reminder open linked by opaque reminder ID to an accepted request within the same session (30-minute inactivity rule) / users with an observable reminder open. Always assisted, not organic. If scheduling/delivery/opening is absent in shipped P0, leave unavailable; do not build notifications for analytics.
- `opportunity_repeat`: interview-confirmed users who brought their new situation to Wingman / interviewed users who reported a new relevant opportunity. Missing interviews remain pending, not no opportunity. Never replace the all-eligible retention result with this selected denominator.
- `responses_complete`: complete usable responses / unique accepted requests (request counts).
- `responses_failed`, `responses_retried`: unique requests with terminal failure or retry; request counts, not users.

## Instrumentation and ownership

Reuse existing product event names if they already represent the agreed success point; map to these IDs. Use app foreground/first open, onboarding completed, person and memory saved, calendar saved, Wingman visible, message accepted, response completed/failed, and retry events. Capture backend completion separately from client response-rendered acknowledgement. Missing render acknowledgement does not prove failure.

Use pseudonymous user identity, stable event/message/request IDs, session ID, event timestamp, environment, app/build version and fixed cohort membership. Resolve anonymous-to-account identity, shared-device signout, duplicates and offline event delivery. Derive message counts on the server. Keep source event time and received time so late events can correct snapshots. Unknown founder/reminder attribution is unknown, not organic.

No in-product response-rating events, ratings widget, or new rating feature. Existing manual usefulness gate remains persisted historical evidence. No secret, raw message, contact name, memory content, calendar title or personal cohort rows in this public aggregate API. Query PostHog with a server-held scoped credential.

## Verification before Rahul connects

Test absent source, available zero, one measured user, pending observation window, malformed count, cohort mismatch, all four user periods, open/request return switching, duplicate request, event at exactly 24/48/72/96h, and identity merge. Use fixtures or isolated test users; no writes to real launch state.

The frontend loads GET on entry and rechecks every 30 seconds while visible, with timeout and error backoff. It calls only the same-origin backend, never PostHog directly. After backend connection the snapshot fills both pages automatically. Do not auto-write these values into the manual launch metric table: gate reconciliation is a separate explicit step. See USERS_POSTHOG_HANDOFF.md for the private user endpoints, identity mapping, foreground app time and connection acceptance checks.
