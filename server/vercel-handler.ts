import * as tracker from '../app/api/tracker/route';
import * as workspace from '../app/api/workspace/route';
import * as login from '../app/api/auth/login/route';
import * as logout from '../app/api/auth/logout/route';
import * as controlUsers from '../app/api/control/users/route';
import { trackerAccess } from '../lib/auth';
import { withWriteTransaction } from '../lib/vercel-database';

export async function handle(request:Request):Promise<Response>{
  const url=new URL(request.url);
  const path=url.searchParams.get('path')||url.pathname;
  const method=request.method;
  const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
  if(path==='/api/health')return json({host:'vercel',database:process.env.TURSO_DATABASE_URL?'configured':'missing',sitesDependency:false});
  const handlers:Record<string,Record<string,(request:Request)=>Promise<Response>>>={
    '/api/tracker':{GET:tracker.GET,PATCH:tracker.PATCH},
    '/api/workspace':{GET:workspace.GET,POST:workspace.POST},
    '/api/auth/login':{POST:login.POST},'/api/auth/logout':{POST:logout.POST},
    // control/users enforces its own staff-only access check internally
    // (see app/api/control/users/route.ts) — not gated here, matching the
    // "backend verifies access itself, the gateway is defense in depth"
    // requirement in USERS_POSTHOG_HANDOFF.md.
    '/api/control/users':{GET:controlUsers.GET},
  };
  const route=handlers[path];if(!route)return json({error:'Not found'},404);
  const fn=route[method];if(!fn)return json({error:'Method not allowed'},405);
  if(method!=='GET'&&request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return json({error:'Origin not allowed'},403);
  if(method==='PATCH'||(path==='/api/workspace'&&method==='POST')){
    const access=await trackerAccess(request);
    if(path==='/api/tracker'?!access.canEdit:!access.authenticated)return json({error:'This deployment is view-only for this visitor.'},403);
  }
  try{
    const response=method==='PATCH'||(path==='/api/workspace'&&method==='POST')?await withWriteTransaction(()=>fn(request)):await fn(request);
    return response.status>=500?json({error:'The application database is temporarily unavailable.'},503):response;
  }
  catch{return json({error:'The application database is temporarily unavailable.'},503);}
}

export default async function handler(req:any,res:any){
  const origin=`https://${req.headers.host}`;
  const url=new URL(req.url,origin);
  const headers=new Headers();for(const [key,value]of Object.entries(req.headers))if(value)headers.set(key,Array.isArray(value)?value.join(', '):String(value));
  const body=['GET','HEAD'].includes(req.method)?undefined:typeof req.body==='string'?req.body:Buffer.isBuffer(req.body)?req.body:JSON.stringify(req.body??{});
  const response=await handle(new Request(url,{method:req.method,headers,body}));
  res.statusCode=response.status;response.headers.forEach((value,key)=>res.setHeader(key,value));
  res.setHeader('Cache-Control','private, no-store');
  res.end(Buffer.from(await response.arrayBuffer()));
}
