// Local check: loads real data with env settings and prints the computed snapshot.
import { config } from '../server/config';
import { getDataset } from '../server/dataset';
import { computeSnapshot } from '../server/metrics';
import { writeFileSync } from 'node:fs';

const cfg = config();
const t0 = Date.now();
const data = await getDataset(cfg);
console.error(`loaded in ${Date.now() - t0} ms: people=${data.people.length} team=${data.people.filter((p) => p.team).length} activity=${data.activity.length} overlay=${data.overlay.length} sessions=${data.sessions.length}`);
if (process.env.DATASET_OUT) writeFileSync(process.env.DATASET_OUT, JSON.stringify(data));
const range = (process.env.RANGE as '7d' | '30d' | 'all') ?? '30d';
const audience = (process.env.AUDIENCE as 'external' | 'internal') ?? 'external';
const snap = computeSnapshot(data, { range, surface: 'combined', audience, version: 'all' }, cfg);
console.log(JSON.stringify({ ...snap, overlay: { ...snap.overlay, users: snap.overlay.users.slice(0, 5).map((u) => ({ ...u, id: u.id.slice(0, 8) })) } }, null, 1));
