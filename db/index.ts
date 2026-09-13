import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';

export function getDb() {
  if (!process.env.TURSO_DATABASE_URL) throw new Error('TURSO_DATABASE_URL is required.');
  return drizzle(createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN}), { schema });
}
