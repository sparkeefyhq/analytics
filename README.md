# Keefie Control Plane

The team analytics dashboard for Keefie: **Overview** (founder & investor summary), **Overlay** (overlay analytics) and **Onboarding** (product overview, retention, drop-off). Built from the Figma file *SPARKEEFY – Product Design* (frames 14223-28386, 14223-28732, 14223-28987).

## Stack

- **Front end:** Vite + React + TypeScript, plain CSS with the Figma tokens (`src/styles.css`). Fonts: Inter, Space Grotesk, Cousine (metric match for Liberation Mono).
- **API:** one Vercel Node function, `api/index.js`, bundled from `server/` by `scripts/build-api.mjs`. No runtime dependencies.
- **Data:** two read-only sources, each the owner of specific numbers:

| Number | Source | If PostHog is down |
|---|---|---|
| Accounts, signups, onboarding completion, chat replies, in-app cost | Backend `/api/admin/analytics/v2` | Unchanged |
| Overlay requests and overlay cost | Backend `overlay` list (`ai_call_telemetry`, live since backend #357); PostHog drafts only before the backend's first row | Unchanged |
| Overlay latency and failures | PostHog draft events: what the user waits for and sees (end to end, a retried model call is not a failure) | Backend model calls (retries merged) |
| Activity (DAU/WAU/MAU) | Backend chat + overlay calls, plus PostHog app opens and overlay events | Backend activity only |
| Reply use, apps, taps, onboarding screens | PostHog | Paused, with a banner |

PostHog is on the free plan (~120 queries/hour), so history is re-read every 15 min and the minutes since come from one small query each minute. On a throttle the last rows stay and PostHog is left alone for 5 min.

## Who counts as a real user

Decided in `server/dataset.ts`, in one place:

1. The id must be a current account in the backend. Deleted temp and smoke accounts disappear.
2. It must not be on `EXCLUDED_USER_IDS` (smoke leftovers, Play reviewer, test lab).
3. It must never have sent an event labelled `traffic_class = test`. `system` traffic (warm-up) is never read.
4. Team accounts (`TEAM_USER_IDS`, or any event labelled `internal`) appear **only** under the *Internal* toggle.

Anonymous pre-login ids (`anon_*`) are not users. The app creates a new one per launch, so they are never counted.

## Metric definitions (`server/metrics.ts`, tested in `tests/metrics.test.ts`)

| Metric | Definition |
|---|---|
| DAU / WAU / MAU | Real users with any activity in the trailing 24 h / 7 d / 30 d. Activity = app events (`app_open`, `wingman_opened`, `response_completed`, …) and overlay events. The surface toggle limits this to overlay or in-app. |
| Overlay session | One bubble session: the overlay `panel_id` when present, otherwise a new session after 5 min idle. |
| Daily overlay frequency | Sessions ÷ user-days with at least one session, in the range. |
| Reply-use rate | Sessions where a reply was shown and then inserted/copied/sent ÷ sessions where a reply was shown. |
| First-reply use rate | Same, but the first reply was used, with no regenerate before it. |
| Onboarding completion | Accounts created in the range that reached a first reply (overlay draft or in-app chat reply) ÷ accounts created in the range. Drop-off step = last onboarding screen seen. |
| Retention | Monday-start IST signup weeks. D1 = active the day after signup; D7 = active on days 7–13; D14 = days 14–20. A cell shows a number only once every user's window has closed. |
| Cost per active user | (Overlay draft cost + in-app model cost + `INFRA_MONTHLY_USD` share) ÷ active users in the range. Overlay drafts before 1 Nov 2026 have no `cost_usd`; they are valued at the tracked average and labelled as an estimate. |
| Latency | p50 / p95 / p99 of `latency_ms` on successful overlay drafts. The 24 h curve is the hourly p95. |
| Failures | Overlay drafts with `status = failed` ÷ all drafts. |

All days are India days (IST, UTC+5:30).

## Settings (Vercel environment variables)

| Name | Purpose |
|---|---|
| `POSTHOG_PERSONAL_API_KEY` | PostHog personal key with query read access (secret). |
| `POSTHOG_PROJECT_ID` | Default `599431`. |
| `V2_SPARKEEFY_BACKEND_URL`, `V2_SPARKEEFY_BACKEND_ADMIN_KEY` | Backend admin analytics endpoint (secret key). |
| `SPARKEEFY_LOGIN_PASSWORD`, `SPARKEEFY_SESSION_SECRET` | Team sign-in (secret). |
| `POSTHOG_PROJECT_API_KEY` | Optional. When set, the server stamps `keefie_account` = real / team / excluded / deleted on PostHog persons (changes only, at most every 10 min), so PostHog insights can filter on the same real users. |
| `TEAM_USER_IDS` | Comma-separated team account ids (same list as the backend's `INTERNAL_USER_IDS`). |
| `EXCLUDED_USER_IDS` | Accounts never counted anywhere. |
| `INFRA_MONTHLY_USD`, `REVENUE_MONTHLY_USD` | Optional. Without revenue, gross margin shows *Pre-revenue*. |
| `COST_TARGET_PER_MAU_USD`, `ONBOARDING_BENCHMARK_PCT`, `LATENCY_SLA_MS`, `FAILURE_SLA_PCT` | Optional targets (defaults 0.40, 45, 3000, 3). |

## Freshness

The page refreshes every 60 s while open. The function reads PostHog at most once a minute per instance and shares that read across all viewers and filters. If a read fails, the last good numbers stay on screen and the sidebar shows *STALE*.

## Develop

```bash
npm ci
# export the settings above, then:
npm run dev        # http://localhost:5173, API served by the same handler
npm test           # metric definitions
npm run build      # api/index.js + dist/
```
