import { database } from './vercel-database';
export const env = new Proxy({DB:database}, {
  get(target,key){return key==='DB'?target.DB:process.env[String(key)];},
}) as unknown as {DB:D1Database;[key:string]:unknown};
