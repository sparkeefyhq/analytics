# Sparkeefy Analytics

Repository: https://github.com/sparkeefyhq/analytics (private).

Hosting: Vercel account **sparkeefy@gmail.com**, team **sparkeefys-projects**, project **sparkeefy-launch-control**.

Live URL: https://sparkeefy-launch-control.vercel.app/analytics

## Architecture

The Vite/React frontend and Node.js API run on Vercel. `/api/*` rewrites to `api/native.js`, generated from `server/vercel-handler.ts`. Tracker/workspace routes use `lib/vercel-database.ts`, a SQLite-compatible Turso adapter. No request proxies to ChatGPT Sites.

Turso resource: `sparkeefy-analytics`, provisioned through the owner's Vercel marketplace integration. Database secrets stay in Vercel. Never commit `.env*`, database exports, tokens or passwords.

The owner requested password removal: the deployment is **public view-only**. Password login is disabled when `SPARKEEFY_LOGIN_PASSWORD` is absent. Existing cookies then grant no access. Editing and private Users endpoints remain denied; personal details must not be made public when PostHog is connected. Agree on staff authentication before enabling those capabilities.

## Development

Use Node 22. Run `npm ci`, `npm run build`, then `npm test`. `npm run dev` uses Vercel's local runtime; run the build first to generate the API bundle. Use an isolated development database, never the live launch database for mutation tests. `tests/native-api.test.mjs` creates its own temporary SQLite database.

Required server environment: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `SPARKEEFY_DATABASE_IMPORTED=true`, `SPARKEEFY_PUBLIC_READONLY=true`. The import flag prevents legacy seed reconciliation from changing preserved launch records. Apply reviewed schema migrations explicitly; do not run import scripts against an existing database.

## Migration and data

The latest Control preview's 16 tables were imported and compared row-for-row. The older production database was separately preserved in the private `migration_archive` table, with its export timestamp and SHA-256; it was not merged into current launch state. Local recovery exports are ignored and are not in GitHub or deployment uploads. Existing phase status, evidence and checklist values are preserved.

## Rahul / PostHog

Read `RAHUL_POSTHOG_MASTER_PROMPT.md`, `CONTROL_PHASE0_API_CONTRACT.md`, and `USERS_POSTHOG_HANDOFF.md`. PostHog is not yet connected. The frontend polls every 30 seconds while visible; that is near-real-time after ingestion, not a streaming guarantee. Do not replace unavailable data with zero or use manual evidence as automatic product telemetry.

Vercel project ID: `prj_jnhFefxVNmT70PzO2gED37mHtCti`.
Vercel team ID: `team_sypLNO52lHCpU82bDyEkp2ri`.
Turso resource ID: `store_PptZ4d74oXmJEXJd`.

Automatic GitHub deploy linking currently requires the owner to connect GitHub under Vercel Account Settings → Authentication, then connect `sparkeefyhq/analytics` under the project's Git settings. CLI deployments do not depend on that link. Future preview writes must use an isolated database; the migrated resource contains valuable launch state.
