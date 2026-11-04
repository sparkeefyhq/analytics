/**
 * Keeps PostHog in step with the dashboard's idea of who is real.
 *
 * Every backend account gets a person property `keefie_account`:
 *   real     counted in all external numbers
 *   team     team account (shown only as Internal)
 *   excluded smoke leftover, Play reviewer, test lab, or anything labelled test
 *   deleted  was stamped before but is no longer a backend account
 * PostHog insights filter on `person.properties.keefie_account = 'real'`, so PostHog
 * and this dashboard count the same people. Only changes are sent.
 */
import type { Config } from './config';
import { hogql } from './posthog';

const SYNC_EVERY_MS = 10 * 60_000;
let lastSync = 0;
let running: Promise<void> | null = null;

export type AccountClass = 'real' | 'team' | 'excluded';

export function syncAccountClasses(cfg: Config, classes: Map<string, AccountClass>): void {
  if (!cfg.posthogProjectApiKey || classes.size === 0) return;
  if (running || Date.now() - lastSync < SYNC_EVERY_MS) return;
  lastSync = Date.now();
  running = doSync(cfg, classes)
    .catch((error) => console.error('posthog account sync failed', error))
    .finally(() => {
      running = null;
    });
}

/** Lets a serverless invocation finish the sync before the instance freezes. */
export const pendingSync = () => running;

async function doSync(cfg: Config, classes: Map<string, AccountClass>) {
  const current = await hogql<{ id: string; cls: string }>(
    cfg,
    `SELECT distinct_id AS id, ifNull(toString(person.properties.keefie_account), '') AS cls
     FROM person_distinct_ids
     WHERE length(distinct_id) = 36 AND (person.properties.keefie_account IS NOT NULL
       OR distinct_id IN (${[...classes.keys()].map((id) => `'${id}'`).join(',')}))
     LIMIT 100000`,
  );
  const now = new Map(current.map((r) => [r.id.toLowerCase(), r.cls]));
  const changes: { id: string; cls: string }[] = [];
  for (const [id, cls] of classes) if (now.get(id) !== cls) changes.push({ id, cls });
  for (const [id, cls] of now) if (cls && cls !== 'deleted' && !classes.has(id)) changes.push({ id, cls: 'deleted' });
  if (!changes.length) return;

  const batch = changes.map((c) => ({
    event: '$set',
    distinct_id: c.id,
    properties: { $set: { keefie_account: c.cls }, traffic_class: 'system', $lib: 'keefie-control-plane', $geoip_disable: true },
    timestamp: new Date().toISOString(),
  }));
  for (let i = 0; i < batch.length; i += 500) {
    const response = await fetch(`${cfg.posthogIngestHost}/batch/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: cfg.posthogProjectApiKey, batch: batch.slice(i, i + 500) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`PostHog batch ${response.status}`);
  }
  console.log(`posthog account sync: ${changes.length} change(s)`);
}
