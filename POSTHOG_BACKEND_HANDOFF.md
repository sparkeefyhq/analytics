# Sparkeefy Control — PostHog backend handoff

> Historical pre-migration document. Hosting, repository, authentication and deployment instructions below are obsolete. Use README.md and RAHUL_POSTHOG_MASTER_PROMPT.md for the current Vercel/Turso architecture.

## Repository and deployed surfaces

| Item | Value |
| --- | --- |
| Local repository | `/Users/sarthak/Developer/Sparkeefy/sparkeefy-launch-tracker` |
| Git remote | `https://git.chatgpt-team.site/c394e6b7-4f7c-4777-b303-38bcb729a4e4/appgprj_6a9dc13c638c8191ac21a0b81d55e02a.git` |
| Baseline committed SHA | `5dc000d46242049b99efe1346314db4f374257ff` (`Harden Phase 1 gating audit fixes`) |
| Preview Control frontend | `https://sparkeefy-launch-control-44edk895t-sparkeefys-projects.vercel.app` |
| Preview Control backend | `https://sparkeefy-control-preview-backend.samarthvm-0302.chatgpt.site` |
| Production backend | `https://sparkeefy-launch-control.samarthvm-0302.chatgpt.site` |

The working tree contains uncommitted Control work on top of the baseline SHA. Do not use the SHA alone to reproduce the current Control UI. The preview backend was deployed from source revision `06392b057f0026c035ba443c35120ac2f50a9b25`; production must not be changed as part of preview integration work.

## Architecture today

```
Browser → Vercel static Control frontend → /api/proxy → Sites/Cloudflare worker → D1
                                                     ↘ later: PostHog query API
```

Vercel rewrites `/api/*` to `api/proxy.js`. The proxy chooses `SPARKEEFY_BACKEND_ORIGIN`, forwards cookies, and adds its server-only `OAI-Sites-Authorization` bearer token. The browser must never receive that token or a PostHog personal API key.

The worker is a Next-style edge route at `app/api/tracker/route.ts`. It uses Cloudflare D1 (`env.DB`) and Drizzle schema declarations in `db/schema.ts`. It has no PostHog SDK or PostHog API integration yet.

## Current API contract

### `GET /api/tracker`

Returns one Control snapshot. The frontend reads `analytics`, `phases`, `releaseGates`, `phase0Unmet`, and `phase1` from this response. The production backend requires its session cookie; the isolated preview has public read-only GET enabled. Never return raw event payloads, real names, emails, messages, or PostHog person properties to this endpoint.

Relevant response shape:

```ts
{
  phases: TrackerPhase[];
  releaseGates: { id, phaseId, position, name, actual }[];
  analytics: AnalyticsSnapshot;
  phase0Unmet: string[];
  phase1: {
    decision1A: string | null;
    finalDecision: string | null;
    phase1AReady: boolean;
    phase1BUnlocked: boolean;
    phase1Unmet: string[];
    wedgeSignals: { wedge, field, numericValue, textValue }[];
  };
}
```

`AnalyticsSnapshot` is assembled in `loadAnalyticsSnapshot()` in `app/api/tracker/route.ts`. Today it is entirely based on `cohort_evidence` and intentionally uses `null` plus a source-unavailable reason for unconnected telemetry. The frontend treats `null` as unavailable — it must not be converted to `0`, `100%`, or `1 / 1`.

### `PATCH /api/tracker`

Editor-only. It is the existing persistence API for manual launch evidence:

| Action | Identifier | Patch |
| --- | --- | --- |
| `metric` | `id` | `actual`, `actualDenominator` |
| `check` | `id` | `completed` |
| `release_gate` | `id` | `actual` non-negative integer |
| `cohort_create` | none | cohort participant fields |
| `cohort_update` | `id` | cohort participant fields |
| `cohort_delete` | `id` | none |
| `start` | `phaseId` | none |
| `advance` | `phaseId` | `{ confirmed: true }` |
| `phase1_decision` | none | `stage`, `decision` |
| `phase1_wedge` | none | `wedge`, `field`, `numericValue`, `textValue` |

The PostHog connector must be read-only with respect to PostHog and must not overwrite manual evidence through this endpoint. Keep human-entered evidence (interviews, founder assistance, trust/safety incidents, release checklist, and hard-zero gates) in D1.

## Launch state that must remain server-enforced

- Phase statuses are `ready`, `active`, `locked`, or `complete`.
- `start` records a server timestamp in `phases.started_at`; it must remain idempotent and must not use browser time.
- Only the active phase can advance.
- Advancement recomputes every gate on the server. A passed client UI is never authorization.
- A completed phase makes only the next phase `ready`; it does not start it.
- Phase 0 advancement is blocked by failed metrics, incomplete checks, and any non-zero hard-zero release gate.
- Phase 1A / 1B use the existing subset metrics, checks, and explicit decision gates.

Migration `drizzle/0006_superb_mysterio.sql` adds `phases.started_at`, `phase1_state`, and `phase1_wedge_signals`. It is additive. Do not reset D1 or delete legacy cohort, metric, checklist, or phase rows.

## What PostHog should supply

PostHog should become the canonical source for timestamped product behaviour, while D1 remains the canonical source for operational/manual evidence. The connector should calculate the existing definitions; it must not change them.

| Control output | Required canonical event / properties | Definition to preserve |
| --- | --- | --- |
| Active users | any qualifying app activity event; `$distinct_id`; event timestamp | Unique users active in selected period |
| Invited | D1 cohort ledger, or a dedicated invite event with stable participant mapping | Recorded eligible cohort participants |
| Play access / installed | install/access event; `$distinct_id`; timestamp | Users with canonical install/access evidence |
| Onboarding completed | `onboarding_completed`; `$distinct_id`; timestamp | Users completing onboarding and reaching Wingman |
| Genuine situation | `genuine_situation_submitted`; `$distinct_id`; timestamp; eligibility/source flags | A real user situation, not a test or seeded/founder-suggested event |
| First Wingman complete | `wingman_response_completed`; `$distinct_id`; timestamp; request ID; outcome | Complete/renderable first Wingman response |
| Meaningful activation | derived from the first genuine situation plus complete useful response | Existing Phase definition; do not broaden it |
| First-answer usefulness | `first_answer_rated`; request ID; rating; timestamp | Existing useful / not-useful classification; agree whether "somewhat" maps to useful before coding |
| Independent activation | founder-assistance/attribution properties, or reconciled D1 evidence | No live founder navigation, rescue, or prompted request |
| Organic second situation | second distinct `genuine_situation_submitted`; timestamp; no reminder/founder attribution | A distinct second genuine situation, not merely a return |
| D1 / D7 / D30 retention | first qualifying baseline event plus repeat qualifying event timestamps | Timestamped cohort retention; not an inferred return-source flag |
| Wingman response success / failures | response completion/error events; request ID; attempt outcome | Complete usable response without error/manual retry |
| Reminder reliability | reminder scheduled/delivered/opened events; reminder ID; destination result | Delivery and destination accuracy only for controlled reminder tests |
| AI cost / reliability | server-side invocation and billing/usage events | Keep unavailable until a canonical server-side source is approved |

### Minimum shared event envelope

Every event used by the connector should carry, directly or through a trusted lookup:

```ts
{
  distinct_id: string;          // stable pseudonymous product ID
  timestamp: string;            // UTC ISO timestamp
  event: string;
  properties: {
    request_id?: string;
    phase?: "phase-0" | "phase-1a" | "phase-1b";
    app_version?: string;
    build?: string;
    acquisition_source?: string;
    participant_id?: string;    // P0-001 style only if mapping is approved
    is_internal?: boolean;
    founder_assisted?: boolean;
    return_source?: "organic" | "reminder-assisted" | "founder-prompted" | "referral" | "internal-test";
  };
}
```

Do not send message bodies, relationship details, contact details, raw personal situations, or email addresses into the launch-control response. Prefer a server-held mapping from PostHog distinct IDs to pseudonymous cohort participant IDs. Exclude internal/team activity before every aggregate, rather than filtering it in the UI.

## Recommended implementation sequence

1. Agree and instrument event names and required properties in the mobile/product application. Validate them in a non-production PostHog project first.
2. Add only server-side PostHog configuration to the Sites worker: `POSTHOG_HOST`, `POSTHOG_PROJECT_ID`, and a read-only query credential. Mark credentials as runtime secrets. Do not add the credential to Vercel or the browser bundle.
3. Create a small connector module (for example `lib/posthog-analytics.ts`) that queries PostHog, validates the response, removes internal/test activity, and returns the existing `AnalyticsSnapshot` shape.
4. Keep source metadata explicit: `source.name`, `source.status`, `source.description`, and `updatedAt` should identify PostHog freshness. Return `null` for metrics whose requisite event stream or denominator is absent.
5. Make a source decision per field: PostHog for behaviour; D1 for manual evidence; where both are necessary, reconcile by pseudonymous participant ID and surface a mismatch as unavailable/needs review — never silently overwrite either source.
6. Do not auto-write PostHog values into gate evidence during the first rollout. First add a read-only, auditable analytics snapshot; then separately decide whether explicitly approved metrics should be server-synced into D1.
7. Add integration tests with a fake PostHog response covering: empty data, unavailable event, one eligible user (must not falsely imply success), internal-event exclusion, day-boundary retention, duplicate events, and source mismatch.
8. Test in the isolated preview backend and Vercel preview first. Production only after the snapshot and gate calculations are audited.

## Authentication and configuration

- Browser calls only same-origin `/api/tracker` and `/api/auth/*`.
- Preview requests pass through Vercel to the isolated preview Sites backend; production points to the production Sites backend.
- `SPARKEEFY_BACKEND_ORIGIN` selects the backend. Preview is deliberately prevented from falling back to production.
- `SPARKEEFY_BACKEND_ACCESS_TOKEN` is Vercel-server-only and permits the proxy to call the private Sites backend.
- Existing Control login/session settings are independent of PostHog. Do not alter session, password, or editor authorization while adding analytics.

## Acceptance checklist for the backend developer

- [ ] No raw PostHog data or credentials reach the frontend.
- [ ] `GET /api/tracker` remains backward compatible and always returns its current top-level fields.
- [ ] No unavailable input is reported as zero, 100%, or a one-user success rate.
- [ ] Existing D1 launch state is not reset or rewritten.
- [ ] Manual checklist, release-gate, and cohort-evidence PATCH flows remain intact.
- [ ] Server-side phase advancement behaviour is unchanged and still blocks on all gates.
- [ ] Public preview stays read-only; only an editor may mutate tracker state.
- [ ] Preview validation uses the isolated backend before any production deployment.
