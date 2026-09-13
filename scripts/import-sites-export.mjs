import {createClient} from '@libsql/client';
import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const path=process.argv[2];if(!path)throw Error('Supply a private Sites export path.');
const data=JSON.parse(readFileSync(path,'utf8'));
const db=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN});
const existing=await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
assert.equal(existing.rows.length,0,'Refusing to import over an existing database.');
for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.executeMultiple(readFileSync(`drizzle/${file}`,'utf8'));
const quote=name=>'"'+name.replaceAll('"','""')+'"';
const tx=await db.transaction('write');
try{
  for(const [table,{columns,rows}]of Object.entries(data.tables)){
    const schema=await tx.execute(`PRAGMA table_info(${quote(table)})`);
    assert.ok(schema.rows.length,`Missing table ${table}`);
    for(const col of columns)assert.ok(schema.rows.some(r=>r.name===col),`Missing ${table}.${col}`);
    for(const row of rows)await tx.execute({sql:`INSERT INTO ${quote(table)} (${columns.map(quote).join(',')}) VALUES (${columns.map(()=>'?').join(',')})`,args:columns.map(col=>row[col]??null)});
    const actual=await tx.execute(`SELECT * FROM ${quote(table)}`);
    const canonical=rows=>rows.map(r=>JSON.stringify(columns.map(c=>r[c]??null))).sort();
    assert.deepEqual(canonical(actual.rows),canonical(rows),`Import mismatch ${table}`);
    console.log(`${table}: ${rows.length} verified`);
  }
  await tx.commit();
}catch(error){await tx.rollback();throw error;}finally{tx.close();db.close();}
