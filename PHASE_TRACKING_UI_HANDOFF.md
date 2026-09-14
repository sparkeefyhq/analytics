# Phase tracking UI — 15 September 2026

Based on production source `620bbb8` (GitHub main). Source worktree: `/Users/sarthak/Developer/Sparkeefy/launch-control-clarity`.

- Overview prioritizes organic second situations, activation, D7 return and active users. Violet denotes priority, not success.
- Usage, retention and reliability/cost have separate navigation panels. Actual zero, unavailable sources and pending windows remain distinct.
- Cohort shortcuts and Plan deep links preserve the selected phase. Phase 1A/1B target displays use their existing gate definitions (50/100), not the shared phase user maximum.
- Mobile gate rows use cards. Blockers show four items initially, with every remaining requirement available in the expansion.
- The September 17 milestone is a planned start; no phase start, evidence or advancement state was modified.
- Production `CONTROL_V2_PHASE1_FROM` was absent and was set to `2026-09-17T00:00:00+05:30`, so the existing backend adapter classifies new signups from then as Phase 1A. Later phase date boundaries remain unset pending actual decisions. This is signup cohort classification, not eligibility verification.

Validation: production build, TypeScript no-emit, scoped lint, 31 tests; local browser checks at desktop and 390px for panels, filters, Plan 1A/1B targets and locked controls, missing-source states, and invalid cost projection. Tests use isolated local storage and synthetic data.
