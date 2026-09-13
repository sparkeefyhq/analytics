import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createClient} from '@libsql/client';
import {randomUUID} from 'node:crypto';

test('native API preserves auth, persistence, undo and atomic advancement on isolated SQLite',async()=>{
  process.env.TURSO_DATABASE_URL=`file:${mkdtempSync(`${tmpdir()}/control-api-`)}/test.db`;
  delete process.env.TURSO_AUTH_TOKEN;
  process.env.SPARKEEFY_DATABASE_IMPORTED='true';
  process.env.SPARKEEFY_PUBLIC_READONLY='true';
  process.env.SPARKEEFY_LOGIN_PASSWORD=randomUUID();
  process.env.SPARKEEFY_SESSION_SECRET=randomUUID();
  const db=createClient({url:process.env.TURSO_DATABASE_URL});
  for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.executeMultiple(readFileSync(`drizzle/${file}`,'utf8'));
  for(const [id,position,status] of [['phase-0',0,'ready'],['phase-1',1,'locked']])await db.execute({sql:'INSERT INTO phases (id,position,name,objective,user_min,user_max,duration_min,duration_max,features,updated_at,status) VALUES (?,?,?, ?,15,15,3,5,?, ?,?)',args:[id,position,id,'Test only','[]',new Date().toISOString(),status]});
  await db.execute("INSERT INTO checks(id,phase_id,position,label) VALUES ('test-check','phase-0',0,'Test check')");
  await db.execute("INSERT INTO metrics(id,phase_id,position,category,name,target,value_type) VALUES ('test-metric','phase-0',0,'Test','Test metric',80,'percent')");
  await db.execute("INSERT INTO release_gates(id,phase_id,position,name,actual,updated_at) VALUES ('test-gate','phase-0',0,'Test safety gate',0,'2026-01-01')");
  const {handle}=await import('../api/native.js');
  let cookie='';
  const request=(path='/api/tracker',method='GET',body,origin)=>handle(new Request(`https://control.test${path}`,{method,headers:{cookie,...(origin?{origin}:{}),'content-type':'application/json'},body:body?JSON.stringify(body):undefined}));
  const patch=body=>request('/api/tracker','PATCH',body);
  assert.equal((await request()).status,200);
  assert.equal((await request('/api/control/users')).status,403);
  assert.equal((await request('/api/tracker?private=cohort')).status,403);
  assert.equal((await patch({action:'start',phaseId:'phase-0'})).status,403);
  const login=await request('/api/auth/login','POST',{email:'sarthakverma0802@gmail.com',password:process.env.SPARKEEFY_LOGIN_PASSWORD});
  assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/control/users')).status,200);
  // No cohort_evidence rows exist in this fixture — a genuinely empty, measured
  // list is 'available' with users:[], not 'unavailable' (which means the
  // connector itself is broken, not that the cohort is empty).
  const usersBody=await (await request('/api/control/users')).json();
  assert.equal(usersBody.status,'available');assert.deepEqual(usersBody.users,[]);
  assert.equal((await request('/api/tracker','PATCH',{action:'start',phaseId:'phase-0'},'https://other.test')).status,403);
  assert.equal((await patch({action:'advance',phaseId:'phase-0',patch:{confirmed:true}})).status,409);
  assert.equal((await patch({action:'start',phaseId:'phase-1'})).status,409);
  assert.equal((await patch({action:'start',phaseId:'phase-0'})).status,200);
  const started=(await (await request()).json()).phases[0].startedAt;assert.ok(started);
  await patch({action:'start',phaseId:'phase-0'});
  assert.equal((await (await request()).json()).phases[0].startedAt,started);
  for(const completed of [true,false,true]){
    assert.equal((await patch({action:'check',id:'test-check',patch:{completed}})).status,200);
    assert.equal((await (await request()).json()).phases[0].checks[0].completed,completed);
  }
  assert.equal((await patch({action:'advance',phaseId:'phase-0',patch:{confirmed:true}})).status,409);
  assert.equal((await patch({action:'metric',id:'test-metric',patch:{actual:15,actualDenominator:15,target:80}})).status,200);
  await patch({action:'release_gate',id:'test-gate',patch:{actual:1}});
  assert.equal((await patch({action:'advance',phaseId:'phase-0',patch:{confirmed:true}})).status,409);
  assert.equal((await (await request()).json()).phases[0].status,'active');
  await patch({action:'release_gate',id:'test-gate',patch:{actual:0}});
  assert.equal((await patch({action:'advance',phaseId:'phase-0',patch:{confirmed:true}})).status,200);
  const final=await (await request()).json();
  assert.equal(final.phases[0].status,'complete');assert.equal(final.phases[1].status,'ready');assert.equal(final.phases[1].startedAt,null);
  delete process.env.SPARKEEFY_LOGIN_PASSWORD;
  assert.equal((await request('/api/auth/login','POST',{})).status,403);
  assert.equal((await request('/api/control/users')).status,403);
  assert.equal((await patch({action:'start',phaseId:'phase-1'})).status,403);
  db.close();
});
