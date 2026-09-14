// Copies definition columns only; never copies launch evidence, state, notes or history.
// Run once against an EMPTY preview schema. Source credentials are used for SELECT only.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createClient } from '@libsql/client';
const env = parseEnv(readFileSync('.env.v2.preview', 'utf8'));
if (
  !env.V2_TURSO_DATABASE_URL ||
  env.V2_TURSO_DATABASE_URL === env.TURSO_DATABASE_URL
)
  throw Error('Preview isolation required');
const source = createClient({
  url: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
});
const target = createClient({
  url: env.V2_TURSO_DATABASE_URL,
  authToken: env.V2_TURSO_AUTH_TOKEN,
});
const definitions = {
  phases: [
    'id',
    'position',
    'name',
    'objective',
    'user_min',
    'user_max',
    'duration_min',
    'duration_max',
    'duration_unit',
    'features',
  ],
  metrics: [
    'id',
    'phase_id',
    'position',
    'category',
    'name',
    'target',
    'unit',
    'comparator',
    'value_type',
    'target_denominator',
    'minimum_denominator',
    'definition',
  ],
  checks: ['id', 'phase_id', 'position', 'label'],
  release_gates: ['id', 'phase_id', 'position', 'name'],
};
const tx = await target.transaction('write');
try {
  for (const table of Object.keys(definitions))
    if (Number((await tx.execute(`SELECT count(*) n FROM ${table}`)).rows[0].n))
      throw Error('Preview is not empty. No overwrite permitted.');
  for (const [table, columns] of Object.entries(definitions)) {
    const { rows } = await source.execute(
      `SELECT ${columns.join(',')} FROM ${table} ORDER BY id`,
    );
    for (const row of rows) {
      const record = { ...row };
      if (table === 'phases') {
        record.status = row.id === 'phase-0' ? 'ready' : 'locked';
        record.updated_at = new Date().toISOString();
      }
      if (table === 'release_gates')
        record.updated_at = new Date().toISOString();
      const keys = Object.keys(record);
      await tx.execute({
        sql: `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
        args: keys.map((key) => record[key]),
      });
    }
    console.log(`${table}: ${rows.length} definitions copied, no evidence.`);
  }
  await tx.commit();
} catch (error) {
  await tx.rollback();
  throw error;
} finally {
  tx.close();
  source.close();
  target.close();
}
