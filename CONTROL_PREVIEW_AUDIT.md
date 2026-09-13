# Control compatibility preview audit

## Deployment architecture verified

- Vercel project: `prj_jnhFefxVNmT70PzO2gED37mHtCti`, team `team_sypLNO52lHCpU82bDyEkp2ri`.
- Production frontend: `dpl_8EycUwKWKPzHF9mpVu9MMgR7cDx9` (`sparkeefy-launch-control.vercel.app`). Existing preview: `dpl_89q2ZQt6oHn2tMgpkXBQwi1jNeGx`.
- Vercel project API and CLI confirm Vite, static output, one `api/proxy` function, and no project environment variables at audit time.
- Both deployed source inventories have the same proxy file hash `90bb63e3d68b81ce1ab34b0225b09252f92280c7`. Retrieved deployed proxy source hardcodes `https://sparkeefy-launch-control.samarthvm-0302.chatgpt.site`.
- `/api/tracker` therefore runs on the Sites Cloudflare Worker through Vercel's `/api/(.*)` → `/api/proxy?path=api/$1` rewrite. Vercel does not run `app/api/tracker/route.ts`.
- Sites production project `appgprj_6a9dc13c638c8191ac21a0b81d55e02a`: version 17, source `b56dacf89d71ebaafc8cc222115918a5e33c6e14`, successful deployment `appgdep_6a9e06e847dc81918f8df092282f1417`.
- The Vercel frontend source metadata references newer `5dc000d46242049b99efe1346314db4f374257ff` plus dirty local changes. Deploying this frontend never updated the Sites Worker.
- Sites persistence is D1 binding `DB`; no R2 binding. Production runtime has secret login-password and session-secret settings (values not readable). No product telemetry/billing integration was found or added.

## Data preservation and isolation

Production D1 was inspected through read-only Sites database tools. All six historical phases remain; Phase 0 is Active, remaining phases Locked. `phases.started_at`, `phase1_state`, and `phase1_wedge_signals` were absent. The cohort ledger was empty. Existing Phase 0 metric denominators include recorded values, which must not be overwritten. Nine release gates were present.

The pending initializer deleted legacy Phase 1 metrics/checks when its new marker was absent. Removed those deletes; current Phase 1 gates already select 1A/1B IDs. Legacy rows remain queryable. Phase 0 migration now refuses incompatible existing evidence instead of deleting it. Invalid nonnumeric/negative incident evidence is rejected rather than converted to zero.

The additive generated migration `0006_superb_mysterio.sql` adds nullable `started_at` and two Phase 1 decision/wedge tables. No table drops or evidence updates occur in it. New schema is applied before Worker deployment, not created by new runtime DDL. Old applied migrations were not rewritten.

Only the isolated preview database receives this migration. Production backend, database, access policy and Vercel production aliases are unchanged. Re-read production phase/cohort/release-gate rows and the inspected metric/check pages match the before snapshots exactly. No production mutation API tests were performed.

## Isolated backend

- Project: `appgprj_6aa5ac2114e081918214abe146a3158f`.
- Private backend: `https://sparkeefy-control-preview-backend.samarthvm-0302.chatgpt.site`.
- Version 1; commit `da4e15e4ed9eef1978cd321b1294fa49cf06ff1a`.
- Deployment: `appgdep_6aa5ad40bf3c8191a274b45b29f751c0` (succeeded).
- Separate D1, login password and session secret. Synthetic data only, including explicit historical metric/check fixtures. Preview-only seeding exists solely in its separate source checkout/repository and never resets populated state.
- Vercel proxy accepts server-only `SPARKEEFY_BACKEND_ORIGIN` and `SPARKEEFY_BACKEND_ACCESS_TOKEN`. Preview configuration rejects a missing origin or the production backend. Caller-supplied Sites authorization is discarded. Production default is retained.
- `.vercelignore` excludes local state, secrets and generated backend artifacts. Dry-run upload check found no such files.

## Verification

Vercel preview: https://sparkeefy-launch-control-79460lr74-sparkeefys-projects.vercel.app/analytics

Deployment `dpl_DKtA2d8WtZRmF5rfzqzXK1DsBmgf` is Ready, target Preview, with no production aliases assigned. The production target remains `dpl_8EycUwKWKPzHF9mpVu9MMgR7cDx9`. Vercel deployment protection remains enabled. Preview-only app credentials are stored in ignored, mode-600 `.env.preview.local`, not source or deployment uploads.

- Isolated Worker build and unchanged Control static build pass.
- Proxy isolation/header unit test passes; targeted lint of proxy, schema and test scripts passes; `git diff --check` passes.
- Full typecheck retains four pre-existing errors in legacy `vercel-static/src/main.tsx` (meeting union, two optional denominator errors, old ReleaseGate type). Tracker-wide lint also retains existing unused/private-loader and unknown-to-string warnings. No UI or analytics definitions were changed in this task.
- Live deployed API tests pass: authenticated GET; aggregate/source-unavailable shapes; preserved legacy metric/check fixtures; locked start/advance rejection; start and timestamp persistence/idempotency; checklist completion/undo across GET; metric evidence; incident evidence persistence; invalid incident rejection; release gate independently blocking advancement with all other gates passing; valid Phase 0 advancement; Phase 1 Ready with null start; refresh persistence; completed-phase replay rejection. Script: `tests/control-live-api.mjs` (hard-locked to the isolated backend hostname; credentials via stdin).
- Through the real Vercel proxy: unauthenticated tracker request returns 401 (not a backend/proxy error); browser login succeeds using the isolated credentials; the UI displays the synthetic cohort count of 1, activation 1/1 and usefulness 1/1, plus the exact lifecycle result from API tests. This confirms it is not calling production (whose cohort ledger is empty and Phase 0 still Active).
- Browser Analytics: all four Users period controls change selected state; Phase 0 cohort selection works; retention selector works; unavailable active-user/retention/reliability/billing data remains unavailable, not fabricated. Negative projection input is rejected; a valid count and Daily period are accepted but no calculation is asserted without billing data. Desktop screenshot inspected at 1440 × 844, document width 1440 with no horizontal overflow.
- Browser Plan: Phase 0 Completed, Phase 1A Ready, Phase 1B/2 Locked match the API test state; persisted Phase 0 timer and metrics/checklists are visible. Native phase-start confirmation appeared, but completion was not verified after browser restarts/timeouts. The user questioned the synthetic advancement; clarified production remains unchanged and left preview Phase 1A unstarted. No active confirmation remained.
- Browser mutations through the Vercel proxy: completed a Phase 1A checklist item, observed it move to Completed and an Undo control appear, clicked Undo, and confirmed the unchecked state after reload. Changed synthetic eligible-cohort evidence to 12 and verified 12 after reload. Changed a synthetic release gate from 0 to 1, observed `1 requirements remain`, then restored 0 and observed `Ready for server verification`. No additional phase advancement was performed in the browser.
- Desktop Analytics and Plan screenshots were visually inspected. Mobile Analytics and Plan screenshots inspected at 390 × 844; both document widths equal 390. Viewport override reset afterward. Final browser error log is empty; earlier warning was from a Chrome extension inspecting Vercel's cross-origin toolbar, not Control. Native start confirmation completion and valid advancement are API-verified, not claimed as successful browser actions.

## Existing locked-scope limitations

Phase 1A and 1B are views of one persisted `phase-1` row, not independently timed lifecycle rows. The locked Control UI does not expose the existing `phase1_decision` write action, which remains required by server gating. Phase 2 is an intentionally locked UI placeholder even though historical Phase 2+ rows remain in D1. No decision gate was bypassed, inferred from checklist completion, or weakened to hide these limitations. Independent 1A→1B Ready/start semantics and a complete in-UI Phase 1 decision workflow cannot be certified from this locked implementation.
