import { useState } from 'react';
import { useLiveData } from './live-data';
import './users.css';

type Stats={wingmanSessions:number|null;messages:number|null;activeSeconds:number|null;profiles:number|null;memories:number|null;calendarEvents:number|null};
type Person={id:string;name:string|null;email:string|null;phone:string|null;onboardedAt:string;firstOpenAt:string|null;lastActiveAt:string|null};
type Day=Stats & {day:number;startedAt:string;status:'available'|'pending'|'unavailable'};
type Activity={id:string;at:string;label:string};
type Payload={version:1;status:'available'|'unavailable'|'pending';updatedAt:string|null;users?:Person[];nextCursor?:string|null;user?:Person;totals?:Stats;days?:Day[];activities?:Activity[];activityTruncated?:boolean};
const count=(n:number|null|undefined)=>Number.isSafeInteger(n)&&n!>=0?n!.toLocaleString('en-IN'):'—';
const duration=(n:number|null|undefined)=>n==null||!Number.isFinite(n)||n<0?'—':`${Math.floor(n/3600)}h ${Math.floor(n%3600/60)}m`;
const date=(s:string|null|undefined)=>s&&Number.isFinite(Date.parse(s))?new Date(s).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}):'—';
const fields:[keyof Stats,string][]=[['wingmanSessions','Wingman sessions'],['messages','Messages sent'],['activeSeconds','App time'],['profiles','People added'],['memories','Memories added'],['calendarEvents','Calendar events']];

export function UsersPage({allowed,onLogin}:{allowed:boolean;onLogin:()=>void}) {
  const [id,setId]=useState<string|null>(null),[query,setQuery]=useState('');
  const [cursors,setCursors]=useState<string[]>([]);
  const cursor=cursors.at(-1);
  const live=useLiveData<Payload>(allowed?`/api/control/users${id?`?id=${encodeURIComponent(id)}`:cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`:null);
  const data=live.data?.version===1?live.data:undefined;
  const users=(Array.isArray(data?.users)?data.users:[]).filter(user=>[user.name,user.email,user.phone].some(v=>v?.toLowerCase().includes(query.toLowerCase())));
  return <section className="control-page users-page"><header className="control-header"><h1>Users</h1>{allowed&&<button className="control-secondary" onClick={live.refresh}>Refresh</button>}</header>
    {!allowed||live.denied?<article className="signal-card users-empty"><h2>Private user analytics</h2><p>Names, contact details and individual activity are available to authorized staff only.</p><button className="control-primary" onClick={onLogin}>Sign in</button></article>:<>
      <p className="p0-caption">{data?.updatedAt?`Data through ${date(data.updatedAt)} · Checks every 30s`:'Awaiting user data connection'}</p>
      {live.error&&<p role="alert" className="p0-caption">{live.error}</p>}
      {id&&<button className="control-secondary" onClick={()=>setId(null)}>← All users</button>}
      {live.loading?<p role="status">Loading users…</p>:data?.status!=='available'?<article className="signal-card users-empty"><h2>{live.error?'Source unavailable':'Not connected yet'}</h2><p>Onboarded users and their activity will appear here once the backend is connected.</p></article>:id?data.user&&data.user.id===id?<>
        <article className="signal-card user-identity"><h2>{data.user.name||'Name not provided'}</h2><p>{data.user.email||'No email'} · {data.user.phone||'No phone'}</p><small>Onboarded {date(data.user.onboardedAt)} · Last active {date(data.user.lastActiveAt)}</small></article>
        <div className="user-stat-grid">{fields.map(([key,label])=><article className="signal-card" key={key}><small>{label}</small><strong>{key==='activeSeconds'?duration(data.totals?.[key]):count(data.totals?.[key])}</strong></article>)}</div>
        <section className="signal-card user-days"><h2>Daily activity</h2><p className="p0-caption">Day 0 = first 24h after first app open (Day 1 in Analytics). App time excludes background time.</p><div className="user-table-scroll"><table><thead><tr><th>Day</th>{fields.map(([,label])=><th key={label}>{label}</th>)}</tr></thead><tbody>{(data.days||[]).map(day=><tr key={day.day}><th>Day {day.day}<small>{day.status==='pending'?'In progress':date(day.startedAt)}</small></th>{fields.map(([key])=><td key={key}>{day.status==='unavailable'?'—':key==='activeSeconds'?duration(day[key]):count(day[key])}</td>)}</tr>)}</tbody></table></div>{!data.days?.length&&<p className="p0-caption">Daily activity not available.</p>}</section>
        <section className="signal-card user-days"><h2>Activity</h2>{(data.activities||[]).map(event=><div className="user-event" key={event.id}><span>{event.label}</span><time>{date(event.at)}</time></div>)}{!data.activities?.length&&<p className="p0-caption">Activity not available.</p>}{data.activityTruncated&&<p className="p0-caption">Showing the latest recorded activities.</p>}</section>
      </>:<p role="status">User details are not available.</p>:<>
        <input className="users-search" aria-label="Search users on this page" placeholder="Search name, email or phone" value={query} onChange={e=>setQuery(e.target.value)}/>
        <section className="signal-card user-list">{users.map(user=><button key={user.id} onClick={()=>setId(user.id)}><span><b>{user.name||'Name not provided'}</b><small>{user.email||user.phone||'Contact not provided'}{user.email&&user.phone?` · ${user.phone}`:''}</small></span><span><small>Onboarded {date(user.onboardedAt)}</small>→</span></button>)}{!users.length&&<p>{query?'No matching users on this page.':'No onboarded users recorded.'}</p>}</section>
        <div className="users-pagination">{cursors.length>0&&<button className="control-secondary" onClick={()=>setCursors(old=>old.slice(0,-1))}>Previous</button>}{data.nextCursor&&<button className="control-secondary" onClick={()=>{setCursors(old=>[...old,data.nextCursor!]);setQuery('');}}>Next</button>}</div>
      </>}
    </>}
  </section>;
}
