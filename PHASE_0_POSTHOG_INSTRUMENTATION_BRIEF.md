# Phase 0 PostHog instrumentation brief

This is a tracking plan only. It does not change Control, phase gates, or analytics definitions yet.

## The Phase 0 question

Did the first 15 real users reach Wingman value on their own, return, and use the context features — without a founder artificially creating the behaviour?

The existing Control gate metrics remain the decision metrics. The events below make those metrics measurable. Setup depth (people, memories, calendar events) and message volume are diagnostic drivers: useful for understanding *why* activation worked or failed, but they should not block a Phase 0 decision by themselves.

## Source-of-truth rules

| Thing | Source |
| --- | --- |
| App downloads | Google Play Console, if literal downloads are required |
| Confirmed installed/opened app | PostHog `app first opened` |
| Product behaviour | PostHog custom/server events |
| Founder assistance, interview outcome, trust/safety incident | Control's D1 manual cohort evidence |
| Phase progress and advance/hold decision | Control backend only |

PostHog cannot reliably tell us an Android download that was never opened. In the UI, call the PostHog number **First app opens**, not downloads. If we want a literal download number, display it separately from Play Console.

## The scorecard

### Decision metrics — existing Control gates

| Control metric | Event-derived definition |
| --- | --- |
| Onboarding completion | Unique eligible users with `onboarding completed` |
| Meaningful activation | Unique eligible users with a genuine first Wingman request and a completed, usable response |
| Independent activation | Meaningful activations without founder navigation, rescue, prompted request, or prompted return recorded in D1 |
| First-answer usefulness | Eligible first completed Wingman answers rated useful; rating remains a specific product event or manual interview evidence |
| Wingman response success | Completed usable responses / genuine Wingman requests |
| Day 1 unprompted return | Activated users with a later organic Wingman return in the Day 1 window |
| Second real situation | Activated users who submit a second distinct genuine situation within 72 hours |

### Diagnostic drivers — display, do not gate Phase 0 on these yet

| Driver | What it tells us |
| --- | --- |
| First app opens | How many installs reached the product |
| First message on Day 0 | Time-to-first-value and onboarding handoff |
| Five messages on Day 0 | Early depth of Wingman engagement; it is not automatically quality |
| Second / third person added | Whether users establish enough relationship context |
| First / second memory added | Whether users understand and adopt memory |
| Calendar event created | Adoption of the reminder/planning feature |
| Day 2 and Day 3 Wingman return | Early retention trajectory beyond the current Day 1 gate |

## Exact event contract for Rahul

Use the `[object] [verb]` naming pattern. Capture the event only after the action succeeds — never on button tap or screen render. Use one stable pseudonymous `distinct_id` for a signed-in user. Do not send message text, person names, memory text, calendar titles, contact information, relationship detail, or email address as properties.

| Event | Fire when | Required properties | Used to derive |
| --- | --- | --- | --- |
| `app first opened` | First successful app launch after install | `app_version`, `build`, `platform`, `is_internal` | First app opens |
| `onboarding completed` | User completes the final onboarding step and can enter Wingman | `app_version`, `build`, `onboarding_version`, `is_internal` | Onboarding completion |
| `person added` | A relationship/person record has been saved | `person_count_after`, `is_internal` | First, second, third person added |
| `wingman opened` | Wingman is actually visible and usable | `entry_point`, `is_internal` | Returns to Wingman |
| `wingman request submitted` | A real request is accepted by the backend | `request_id`, `request_number_day`, `is_genuine_situation`, `is_internal` | First message, five messages on Day 0, first/second genuine situation |
| `wingman response completed` | The same request returns a complete renderable answer | `request_id`, `response_outcome: "success"`, `is_internal` | Response success, meaningful activation |
| `wingman response failed` | The same request cannot produce a usable answer | `request_id`, `failure_type`, `is_internal` | Response failure/reliability |
| `answer rated` | User submits a rating for the first completed answer | `request_id`, `rating: "useful" | "not_useful"`, `is_internal` | First-answer usefulness |
| `memory added` | A memory is successfully saved | `memory_count_after`, `is_internal` | First / second memory adoption |
| `calendar event created` | A calendar event is successfully saved | `is_internal` | Calendar adoption |

### Required shared properties

Every custom event above should also include these when known:

```ts
{
  app_version: string,
  build: string,
  platform: "android",
  is_internal: boolean,
  cohort_id?: "phase-0",
  acquisition_source?: string,
}
```

`request_id` must be the same on `wingman request submitted`, `wingman response completed` / `failed`, and `answer rated`. This is essential for response-success and usefulness denominators.

## Definitions that need to be locked before implementation

1. **Day 0** is the local calendar day (Asia/Kolkata) on which the user sends their first genuine Wingman request.
2. **Day 1 / Day 2 / Day 3 return** means a later `wingman opened` event on the next one, two, or three local calendar days. Track both:
   - return opened: they came back to Wingman;
   - return with request: they came back and submitted another request.
   The latter is stronger and is what should support the “second real situation” metric.
3. **Five messages on Day 0** means five successful `wingman request submitted` events on Day 0. Do not count retries, failed sends, or assistant response chunks as messages.
4. **Second/third person** and **second memory** are derived from `*_count_after >= 2/3`, rather than inventing separate events.
5. **Genuine situation** cannot be inferred purely from message volume. It needs `is_genuine_situation: true` from the product flow, with founder-assistance exclusions reconciled in D1.
6. **Internal activity** must be excluded in backend PostHog queries. It must never be hidden only in the Control UI.

## What Rahul should implement now

1. Add the nine events above to the Android/product code, using the existing PostHog SDK.
2. Identify the user once a stable app account ID exists; keep anonymous-to-identified identity handling consistent so pre-signup and post-signup activity does not become two users.
3. Capture successful completions from the server where possible for Wingman submission/completion, not only from the client. Client capture is appropriate for screen opens and local setup actions.
4. Add PostHog event schema validation for the required properties and test each event in the PostHog live-event view using a non-internal test account.
5. Share back: PostHog project region/host, project ID, final event names, property schema, and three sample event payloads with sensitive values removed.

## What we do after Rahul confirms instrumentation

1. Confirm the final event schema and test it against a Phase 0 test account.
2. Add a server-side, read-only PostHog connector to Control's isolated preview backend.
3. Map only the agreed aggregates into the existing Control Analytics and Plan metrics.
4. Keep manual D1 evidence for founder assistance, interviews, hard-zero safety gates, and checklist items.
5. Validate empty data, duplicate events, Day 1/2/3 boundaries, internal-user exclusion, and the one-user case before promoting anything to production.
