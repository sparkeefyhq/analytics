# Sparkeefy Phase 0 — retention and stickiness measurement map

## The decision this must answer

For the first 15 eligible users: **does Wingman become the tool they return to when another real relationship situation appears, without founder prompting or artificial notifications?**

This is not a DAU game. A relationship situation may not occur every day, so a user who does not open the app tomorrow is not automatically churned. Phase 0 therefore measures two separate things:

1. **Short-horizon return** — did the first useful interaction make the product worth reopening?
2. **Repeat value** — when another genuine situation happened, did the user use Wingman again?

The second is the stronger retention signal.

## The one primary Phase 0 retention metric

### Repeat genuine-situation rate within 72 hours

```
activated users who submit a second distinct genuine Wingman request within 72h
─────────────────────────────────────────────────────────────────────────────
all meaningfully activated eligible users with a 72h observation window
```

Rules:

- Start the clock when the first **completed usable** Wingman response is received, not when a screen opens.
- A second request must have a different `request_id` and be manually confirmed as a distinct, genuine situation in the Phase 0 ledger.
- Exclude internal users, test/seed requests, founder-suggested requests, founder-prompted returns, and reminder-assisted returns from the *organic* numerator.
- Keep these excluded events in a separate assisted/test breakdown; deleting them would hide the reason the result moved.
- Display both raw count and denominator, e.g. `4 / 11 users`, never only a percentage.

This maps directly to the existing Control metric **Second real situation**. It is the clearest early proof of retention for this product.

## Phase 0 scorecard

### A. Reach and first value

| Measure | Exact definition | Why it matters | Source |
| --- | --- | --- | --- |
| Recruited cohort | Eligible people in the Phase 0 ledger | The fixed Phase 0 denominator | Control/D1 manual ledger |
| Play downloads | Store installs from Google Play Console | Acquisition context only | Play Console |
| First app opens | Distinct eligible users with first successful foreground app launch | Confirms an install became a reachable user | PostHog |
| Onboarding completion | Eligible users completing the last onboarding step | Current Control gate; shows setup friction | PostHog |
| First Wingman request | Eligible users with one server-accepted request | The user crossed from setup into product use | PostHog |
| First usable answer | First requests with one complete renderable answer | Separates product access from experienced value | PostHog/server |
| Meaningful activation | A genuine first situation + completed usable answer + manual usefulness evidence | Current Control gate; first evidence of value | Combined PostHog + D1 interview ledger |

### B. Engagement depth on Day 0 — diagnostic, not a gate

| Measure | Exact definition | Interpretation |
| --- | --- | --- |
| Five requests on Day 0 | At least five distinct server-accepted Wingman request IDs before the end of the first 24h | Strong curiosity/engagement, but may also indicate a poor answer; pair with quality |
| First / second / third person added | `person_count_after >= 1 / 2 / 3` after a successful save | Context setup depth; not every user needs three people |
| First / second memory added | `memory_count_after >= 1 / 2` after a successful save | Memory adoption; not proof that memory helped later |
| Calendar event created | A calendar/reminder event is successfully persisted | Planning/reminder adoption; must later be paired with delivery/opening |

### C. Return and repeat value — the retention view

| Measure | Denominator | Numerator | Purpose |
| --- | --- | --- | --- |
| D1 Wingman open return | Activated users observed for 24–48h | Later `wingman opened` in that window, organic | Lightweight interest |
| D1 request return | Activated users observed for 24–48h | Later `wingman request submitted`, organic | Stronger return than an open |
| D2 request return | Activated users observed for 48–72h | Later organic request in that window | Early continuing demand |
| D3 request return | Activated users observed for 72–96h | Later organic request in that window | Early retention trajectory |
| Repeat genuine-situation rate | Activated users observed for 72h | Second manually confirmed genuine request within 72h | Primary Phase 0 retention signal |
| Opportunity-adjusted repeat rate | Activated users who said in interview they had a second relevant situation | Those users who brought it to Wingman | Distinguishes “no opportunity” from product non-return |

Use rolling windows from the first usable answer: `D1 = 24–48h`, `D2 = 48–72h`, and `D3 = 72–96h`. This avoids a misleading midnight boundary. Show India local timestamps in the UI, but compute windows from UTC timestamps.

### D. Feature stickiness — measure repeat use of a feature, not first use

| Feature | Adoption measure | Stickiness measure | Required evidence |
| --- | --- | --- | --- |
| Person context | Person was added | On a later Wingman request, that saved person was selected or server-side person context was used | `person selected` or response property `used_person_context: true` |
| Memory | Memory was added | A later completed response used saved memory context | server-side `used_memory_context: true` |
| Calendar/reminder | Calendar event was created | Event was delivered, opened, then led to a Wingman request | scheduled → delivered → opened → request chain |

This prevents a false conclusion such as “memory is sticky” merely because someone added one memory during onboarding.

## Event specification for Rahul

Capture after success, not on a button tap. All server-authoritative events must be emitted by the backend after persistence. Client-side events are appropriate for actual screen visibility and local UI completion. Use one stable pseudonymous PostHog `distinct_id` after sign-in; never use an email address as the analytics identity.

| Event | Authoritative emitter | Fire exactly when | Required properties |
| --- | --- | --- | --- |
| `app opened` | client | App enters foreground and is usable | `app_version`, `build`, `platform`, `is_internal` |
| `app first opened` | client, once per account/device install | First successful foreground launch | same as above |
| `onboarding started` | client | First onboarding screen is shown | `onboarding_version`, `is_internal` |
| `onboarding completed` | client or backend if persisted | Final step succeeds and Wingman is available | `onboarding_version`, `app_version`, `build`, `is_internal` |
| `person added` | backend after save | Person/context record persists | `person_count_after`, `is_internal` |
| `person selected` | client/backend | Existing person is selected for a Wingman interaction | `person_count_available`, `is_internal` |
| `memory added` | backend after save | Memory persists | `memory_count_after`, `is_internal` |
| `calendar event created` | backend after save | Calendar/reminder event persists | `reminder_id`, `due_offset_bucket`, `is_internal` |
| `reminder delivered` | notification/backend worker | Delivery provider confirms delivery | `reminder_id`, `delivery_result`, `is_internal` |
| `reminder opened` | client | User opens the delivered reminder | `reminder_id`, `is_internal` |
| `wingman opened` | client | Wingman screen is visible and interactive | `entry_point`, `is_internal` |
| `wingman request submitted` | backend after acceptance | Request is accepted for generation | `request_id`, `wingman_session_id`, `request_number_day`, `is_internal` |
| `wingman response completed` | backend | Same request has a complete renderable answer | `request_id`, `wingman_session_id`, `response_outcome: "success"`, `used_person_context`, `used_memory_context`, `is_internal` |
| `wingman response failed` | backend | Same request cannot return a usable answer | `request_id`, `wingman_session_id`, `failure_type`, `is_internal` |
| `person removed` | backend after save | Existing person is removed | `person_count_after`, `is_internal` |
| `memory removed` | backend after save | Existing memory is removed | `memory_count_after`, `is_internal` |

### Shared properties on every custom event

```ts
{
  app_version: string,
  build: string,
  platform: "android",
  is_internal: boolean,
  cohort_id?: "phase-0",
  acquisition_source?: string,
  event_id?: string, // idempotency/deduplication key when client-generated
}
```

Never send: message text, AI answer text, person names, memory text, calendar titles, relationship status, contacts, phone numbers, emails, or images. `request_id`, `wingman_session_id`, and `reminder_id` must be opaque random IDs.

## Derived metrics — no extra event for each milestone

The following are PostHog queries/aggregates, not events Rahul must manually invent:

| Requested tracking item | Derivation |
| --- | --- |
| Number of people who downloaded | Google Play installs; PostHog counterpart is distinct users with `app first opened` |
| Completed onboarding | Distinct `onboarding completed` users |
| Added 2nd / 3rd person | `person added` where `person_count_after >= 2 / 3` |
| Opened Wingman and sent first message Day 0 | First `wingman request submitted` after onboarding, matched to a completed response |
| Sent five messages Day 0 | Five distinct `request_id`s in first 24h |
| Returned Day 2 / Day 3 | `wingman opened` and separately `wingman request submitted` in the defined return window |
| Added 1 / 2 memories | `memory added` where `memory_count_after >= 1 / 2` |
| Added calendar event | Distinct `calendar event created` users |

## How the data should appear in Control

The Plan gates remain the existing controlled metrics. Analytics should add a Phase 0 behaviour panel with raw counts and denominators, not a big percentage dashboard:

```
15 recruited
12 completed onboarding
11 reached first usable Wingman answer
 8 added a person       5 added a second person
 6 added memory         3 added a second memory
 4 created an event

6 returned with a request on D1
4 returned with a request on D2
4 returned with a request on D3
4 / 11 brought a second genuine situation within 72h
```

For every row, show `source = PostHog`, `source = manual ledger`, or `source = reconciled`. If no source is connected, show `—` and a short source-unavailable state. Never show `100%` from one person.

## Minimum sample and quality controls

With a 15-person cohort, percentages are volatile. For every Phase 0 decision metric:

- Show the count, denominator, and excluded users alongside the percentage.
- Do not mark a percentage as passed until the intended cohort/required observation window is complete.
- `Onboarding`: denominator is all 15 eligible recruits.
- `Meaningful activation`: denominator is all 15 eligible recruits; numerator requires the full event chain plus quality evidence.
- `Response success`: denominator is genuine accepted requests; require the pre-existing 50-request observation target.
- `First-answer usefulness`: collect the result through the Phase 0 interview/manual-evidence process; there is no in-product rating event yet.
- `D1 unprompted return` and `second real situation`: denominator is meaningfully activated eligible users who have had the full observation window.
- Do not count an event twice because of retries, offline replay, screen refresh, or a duplicate client capture. `request_id` is the dedupe key for the Wingman chain.

## Founder/manual reconciliation that PostHog cannot replace

Keep these in Control's D1 cohort ledger and review them per participant:

- whether the request was a genuine relationship situation;
- whether the founder explained, navigated, rescued, suggested the situation, or prompted the return;
- whether the user had a second relevant real-world opportunity but chose not to return;
- interview usefulness/outcome and the top failure reason;
- trust, privacy, safety, and release-blocking incidents.

PostHog tells us **what happened in the product**. The ledger tells us **whether it was organic and meaningful**. The backend must reconcile the two before a phase gate can pass.

## Implementation order

1. Rahul instruments the event contract and PostHog schemas; no Control UI changes yet.
2. Validate the event chain with two non-internal test accounts, including an offline/retry case.
3. Verify that one request produces exactly one accepted → completed/failed chain under the same `request_id`.
4. Run the 15-person Phase 0 cohort with no proactive lifecycle notifications; user-created calendar reminders are labelled `reminder-assisted`, never organic.
5. Build the read-only Control connector and compare each aggregate to the D1 ledger.
6. Only then decide which existing Control rows should auto-populate from reconciled PostHog data. Keep phase advancement server-enforced.
