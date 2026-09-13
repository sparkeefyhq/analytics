import test from 'node:test';
import assert from 'node:assert/strict';
import users from '../api/control-users.js';

async function run(replies, url='/api/control/users', method='GET') {
  const original=global.fetch; const requests=[];
  process.env.VERCEL_ENV='preview';process.env.SPARKEEFY_BACKEND_ORIGIN='https://preview.example.test';
  global.fetch=async(url,options)=>{requests.push({url:String(url),options});const [status,body]=replies.shift();return new Response(JSON.stringify(body),{status});};
  const result={headers:{},setHeader(k,v){this.headers[k]=v;},end(v){this.body=JSON.parse(v);}};
  try{await users({method,url,headers:{cookie:'session=fixture',host:'control.test'}},result);return {...result,requests};}
  finally{global.fetch=original;delete process.env.VERCEL_ENV;delete process.env.SPARKEEFY_BACKEND_ORIGIN;}
}
test('public requests never reach private analytics',async()=>{
  const r=await run([[200,{canEdit:false,viewerEmail:null}]]);
  assert.equal(r.statusCode,403);assert.equal(r.requests.length,1);assert.equal(r.headers['Cache-Control'],'private, no-store');
});
test('expired session and unverifiable identity fail closed',async()=>{
  assert.equal((await run([[401,{}]])).statusCode,403);
  assert.equal((await run([[200,{canEdit:true}]])).statusCode,403);
});
test('authorized missing connector is unavailable, not empty measured data',async()=>{
  const r=await run([[200,{canEdit:true,viewerEmail:'staff@test.invalid'}],[404,{}]]);
  assert.equal(r.statusCode,200);assert.equal(r.body.status,'unavailable');assert.equal(r.body.updatedAt,null);
});
test('authorized detail forwards only allowed opaque lookup parameters',async()=>{
  const payload={version:1,status:'available',user:{id:'test-1',name:'QA user'}};
  const r=await run([[200,{canEdit:true,viewerEmail:'staff@test.invalid'}],[200,payload]],'/api/control/users?id=test-1&other=ignored');
  assert.deepEqual(r.body,payload);assert.equal(r.requests[1].url,'https://preview.example.test/api/control/users?id=test-1');assert.equal(r.requests[1].options.redirect,'manual');
});
test('errors and unsupported versions never forward upstream payloads',async()=>{
  const r=await run([[200,{canEdit:true,viewerEmail:'staff@test.invalid'}],[200,{version:2,secret:'never show'}]]);
  assert.equal(r.statusCode,502);assert.ok(!JSON.stringify(r.body).includes('never show'));
  assert.equal((await run([],undefined,'POST')).statusCode,405);
});
