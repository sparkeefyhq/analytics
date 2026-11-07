# Keefie pilot analytics handoff

## Ready for Rahul’s review

| Page | What changed |
| --- | --- |
| Onboarding | Six checkpoint cards, a screen and permission funnel with stop counts and rates, and a filterable follow-up list for linked accounts. |
| Overlay | Phase 1 targets, first-draft use, recorded inserts and sends, compact P95, and interaction efficiency before platform distribution. User names lead the activity table. |
| Investor | DAU, WAU and MAU lead, followed by the Phase 1 scorecard and retention. Cost and reply details are expandable. |
| Users | Existing roster and detail pop-up. The live activity feed is visible on this tab only. The proposed roster redesign is deferred. |

Navigation is Onboarding → Overlay → Investor → Users. The 1D filter uses a trailing 24-hour window. The PR leaves production release with Rahul.

## Verify before merging

- **Filters and freshness.** Check 1D, 7D, 30D and All Time, plus surface, audience and build filters. Compare cards, tables and source events on the same window. Reconcile platform row totals against the request total. Check source lag and ensure stale or missing telemetry displays as such.
- **Onboarding.** Confirm the six checkpoint names, order and event mappings with the Android build. The preview uses provisional mappings. “Stopped here” means the last recorded step for someone who has yet to reach Home. The percentage uses users who reached that step. Validate permissions separately. The named follow-up list uses a provisional 24-hour rule and only covers linked accounts. Check anonymous users still appear in funnel totals.
- **Overlay.** Validate draft shown, copy, insert, confirmed send, rewrites, latency and failures on real Android devices. Compare counts and denominators with raw allowlisted events. Keep first-draft use separate from actual sends. Verify whether host-app sends can be observed reliably before adding first-draft send or insert-to-send timing. Timing alone cannot establish manual editing. Check failure and cost totals against request records.
- **Investor.** Verify what qualifies as active, deduplication across Overlay and in-app, and the scorecard denominator against the selected pilot cohort. Check that the seven-day gate stays pending until eligibility is met. Separate prompted use from independent return before calling it independent retention. Recheck safety, reliability and tracking before moving from 20 to 50.
- **Data inventory.** Review exactly which events and properties are collected, how fresh they are, and how long they are kept. Keep analytics to allowlisted metadata. Exclude chat and draft text, screenshots, audio, transcripts, contacts and recipient names. Keep replay and autocapture disabled and verify IP anonymization. Use the existing restricted roster for follow-up contact details.

## Deferred

- Users roster redesign and any dropout warning beyond the Onboarding follow-up list. If revived, use clear reasons such as setup stalled or previously active and now quiet, and sort flagged accounts to the top. Validate thresholds with pilot data before labeling users high risk.
- Confirmed first-draft send and send timing until device-level event coverage is verified.
- Test new flags with synthetic fixtures or isolated staging data. Remove temporary fixtures after review and keep production records out of tests.
