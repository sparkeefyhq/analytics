import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient, type Client, type Transaction, type InValue, type ResultSet } from '@libsql/client';

let client: Client | undefined;
const context = new AsyncLocalStorage<Transaction>();
function connection() {
  if (!client) {
    const isolated = process.env.VERCEL_ENV === 'preview';
    const url = isolated ? process.env.V2_TURSO_DATABASE_URL : process.env.TURSO_DATABASE_URL;
    if (!url) throw Error('TURSO_DATABASE_URL is required.');
    if (isolated && url === process.env.TURSO_DATABASE_URL) throw Error('Preview must not use production storage.');
    client = createClient({url, authToken:isolated ? process.env.V2_TURSO_AUTH_TOKEN : process.env.TURSO_AUTH_TOKEN});
  }
  return client;
}
function result(data:ResultSet) {
  return {results:data.rows.map(row=>Object.fromEntries(data.columns.map(name=>[name,row[name]]))),success:true,meta:{changes:data.rowsAffected,last_row_id:Number(data.lastInsertRowid??0)}};
}
class Statement {
  constructor(readonly sql:string,readonly args:InValue[]=[]){}
  bind(...args:InValue[]){return new Statement(this.sql,args);}
  async all<T=Record<string,unknown>>(){return result(await (context.getStore()??connection()).execute({sql:this.sql,args:this.args})) as {results:T[];success:boolean;meta:{changes:number;last_row_id:number}};}
  async first<T=Record<string,unknown>>(column?:string):Promise<T|null>{const {results}=await this.all<Record<string,unknown>>();return (results.length?(column?results[0][column]:results[0]):null) as T|null;}
  async run(){return this.all();}
}
export const database={
  prepare:(sql:string)=>new Statement(sql),
  async batch(statements:Statement[]){
    const tx=context.getStore();
    if(tx){const results=[];for(const statement of statements)results.push(await statement.run());return results;}
    return (await connection().batch(statements.map(({sql,args})=>({sql,args})), 'write')).map(result);
  },
};
export async function withWriteTransaction(run:()=>Promise<Response>){
  const tx=await connection().transaction('write');
  try{const response=await context.run(tx,run);if(response.ok)await tx.commit();else await tx.rollback();return response;}
  catch(error){await tx.rollback();throw error;}
  finally{tx.close();}
}
