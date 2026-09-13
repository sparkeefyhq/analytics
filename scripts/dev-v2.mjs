// Local test storage only. Does not load .env files or production credentials.
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { createClient } from '@libsql/client';
import { randomUUID } from 'node:crypto';
process.env.TURSO_DATABASE_URL = `file:${mkdtempSync(`${tmpdir()}/control-v2-`)}/preview.db`;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.POSTHOG_API_KEY;
delete process.env.VERCEL_ENV;
process.env.CONTROL_V2_LOCAL_TEST = 'true';
process.env.SPARKEEFY_DATABASE_IMPORTED = 'false';
process.env.SPARKEEFY_PUBLIC_READONLY = 'true';
process.env.SPARKEEFY_SESSION_SECRET = randomUUID();
const db = createClient({ url: process.env.TURSO_DATABASE_URL });
for (const file of readdirSync('drizzle')
  .filter((f) => f.endsWith('.sql'))
  .sort())
  await db.executeMultiple(readFileSync(`drizzle/${file}`, 'utf8'));
for (const [id, position] of [
  ['phase-0', 0],
  ['phase-1', 1],
])
  await db.execute({
    sql: "INSERT INTO phases(id,position,name,objective,user_min,user_max,duration_min,duration_max,features,updated_at) VALUES(?,?,?,'Local test only',15,15,3,5,'[]',?)",
    args: [id, position, id, new Date().toISOString()],
  });
db.close();
const { handle } = await import('../api/native.js');
createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const method = req.method || 'GET';
  const result = await handle(
    new Request(`http://127.0.0.1:4181${req.url}`, {
      method,
      headers: req.headers,
      body: ['GET', 'HEAD'].includes(method)
        ? undefined
        : Buffer.concat(chunks),
    }),
  );
  res.writeHead(result.status, Object.fromEntries(result.headers));
  res.end(Buffer.from(await result.arrayBuffer()));
}).listen(4181, '127.0.0.1', () =>
  console.log('Isolated local API http://127.0.0.1:4181'),
);
