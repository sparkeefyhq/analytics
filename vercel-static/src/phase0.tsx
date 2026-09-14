import { useState } from 'react';
import { countText, groups, observation, statusText, type Observation, type Period, type Phase0Snapshot, type TopUser } from './phase0-data';
import './phase0.css';

function Count({ item }: { item?: Observation }) {
  const denominator = item?.status === 'available' && Number.isSafeInteger(item.denominator) && item.denominator! >= 0 ? item.denominator : null;
  return <div className="p0-count"><strong>{countText(item)}</strong>{denominator !== null && <span> / {denominator}</span>}<small>{statusText(item)}{item?.pending ? ` · ${item.pending} observing` : ''}{item?.excluded ? ` · ${item.excluded} excluded` : ''}</small></div>;
}

export function Phase0Tracking({ snapshot, target = 15 }: { snapshot?: Phase0Snapshot; target?: number }) {
  const [returnType, setReturnType] = useState('request');
  return <div className="p0-tracking">
    <div className="section-heading"><h2>Phase 0 tracking</h2><span>{target} users · cohort target</span></div>
    <section className="signal-card p0-return">
      <div className="card-row"><h2>Retention</h2><span className="data-chip">Organic returns</span></div>
      <div className="p0-tabs" aria-label="Return activity">{[['open','Opened Wingman'],['request','Sent a message']].map(([id,label]) => <button key={id} aria-pressed={returnType === id} onClick={() => setReturnType(id)}>{label}</button>)}</div>
      <div className="p0-return-grid">{[['day2','Day 2','24–48h'],['day3','Day 3','48–72h'],['day4','Day 4','72–96h']].map(([key,label,window]) => <div key={key}><span>{label}</span><Count item={observation(snapshot,`return_${returnType}_${key}`)} /><small>{window} after first app open</small></div>)}</div>
      <p className="p0-caption">Day 1 = first 24h after app open. Counts update live as it happens — the denominator is how many people have reached that window so far, not how many have finished it.</p>
    </section>
    <div className="p0-groups">{groups.map(group => <section key={group.title} className="signal-card p0-group"><h2>{group.title}</h2>{group.rows.map(([id,label,hint]) => <div className="p0-row" key={id}><div><b>{label}</b><small>{hint}</small></div><Count item={observation(snapshot,id)} /></div>)}</section>)}</div>
    <p className="p0-caption">Tracking and verified launch gates are separate.</p>
  </div>;
}

const NAME_SOURCE_MESSAGE: Record<string, string> = {
  not_configured: 'Name lookup not configured — SPARKEEFY_BACKEND_URL/SPARKEEFY_BACKEND_ADMIN_KEY missing.',
  unauthorized: 'Name lookup rejected by the backend — SPARKEEFY_BACKEND_ADMIN_KEY does not match.',
  backend_error: 'Name lookup failed — backend returned an error.',
  network_error: 'Name lookup failed — could not reach the backend.',
};

function TopUsers({ users, nameSource }: { users?: TopUser[]; nameSource?: string }) {
  const nameSourceIssue = nameSource && nameSource !== 'ok' ? NAME_SOURCE_MESSAGE[nameSource] : null;
  return <section className="signal-card p0-top-users">
    <div className="card-row"><h2>Most active users</h2><span className="data-chip">PostHog</span></div>
    {nameSourceIssue && <p className="p0-caption">{nameSourceIssue}</p>}
    {!users || users.length === 0
      ? <p className="p0-caption">No Wingman requests recorded yet.</p>
      : <ol className="p0-top-users-list">{users.map(user => <li key={user.distinctId}><span>{user.name || user.email || `${user.distinctId.slice(0, 12)}…`}</span><strong>{user.messageCount.toLocaleString('en-IN')}<small> messages</small></strong></li>)}</ol>}
  </section>;
}

export function Phase0Analytics({ snapshot, target }: { snapshot?: Phase0Snapshot; target?: number }) {
  const activePhase = snapshot?.activePhase ?? null;
  if (snapshot?.version !== 1 || snapshot.cohort !== 'phase-0') snapshot = undefined;
  const [period,setPeriod] = useState<Period>('today');
  const [open,setOpen] = useState(false);
  const [projection,setProjection] = useState('1000');
  const [cohortView,setCohortView] = useState<'phase-0' | 'phase-1'>('phase-0');
  const periods: [Period,string][] = [['today','Today'],['week','This week'],['month','This month'],['all','All time']];
  const fresh = snapshot?.updatedAt && Number.isFinite(Date.parse(snapshot.updatedAt)) ? new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(snapshot.updatedAt)) : 'Awaiting PostHog';
  const valid = /^\d+$/.test(projection) && Number.isSafeInteger(Number(projection)) && Number(projection)>0;
  const phase1Active = activePhase === 'phase_1';
  return <section className="control-page analytics-page">
    <header className="control-header"><h1>Analytics</h1><div className="header-tools"><label>Cohort<select aria-label="Analytics cohort" value={cohortView} onChange={event => setCohortView(event.target.value as 'phase-0' | 'phase-1')}><option value="phase-0">Phase 0</option><option value="phase-1">{phase1Active ? 'Phase 1' : 'Phase 1 · not active yet'}</option></select></label></div></header>
    <p className="p0-caption">{fresh}{activePhase && <> · backend is currently tagging events {activePhase === 'phase_1' ? 'Phase 1' : 'Phase 0'}</>}</p>
    {cohortView === 'phase-1' && !phase1Active
      ? <article className="signal-card"><h2>Phase 1 hasn&apos;t started yet</h2><p className="p0-caption">The backend is still tagging events Phase 0 (<code>ANALYTICS_PHASE=phase_0</code>). This view activates automatically the moment that flips at cutover — no dashboard change needed then.</p></article>
      : <>
    <article className="signal-card users-card p0-users"><div className="card-row"><h2>Users</h2><span className="data-chip">{statusText(snapshot?.activeUsers?.[period])}</span></div><div className="users-number">{countText(snapshot?.activeUsers?.[period])}<small>active users</small></div>
      <div className="user-period" onKeyDown={event => {if(event.key==='Escape')setOpen(false);}} onBlur={event => {if(!event.currentTarget.contains(event.relatedTarget))setOpen(false);}}><button className="period-toggle" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>{periods.find(([id])=>id===period)?.[1]}<span aria-hidden="true">⌃</span></button>{open && <div className="period-menu" role="menu" aria-label="Active user period">{periods.map(([id,label])=><button key={id} role="menuitemradio" aria-checked={period===id} onClick={()=>{setPeriod(id);setOpen(false);}}>{label}</button>)}</div>}</div>
    </article>
    <TopUsers users={snapshot?.topUsers} nameSource={snapshot?.topUsersNameSource} />
    {cohortView === 'phase-0'
      ? <Phase0Tracking snapshot={snapshot} target={target} />
      : <article className="signal-card"><h2>Phase 1 tracking</h2><p className="p0-caption">Phase 1&apos;s own metric set (attribution, retention windows, AI economics) isn&apos;t wired into this view yet — Users and Most active users above are already project-wide and reflect live Phase 1 traffic. Full Phase 1 tiles land once the metric definitions are locked.</p></article>}
    <article className="signal-card p0-economics"><div><h2>AI cost</h2><p className="p0-caption">Awaiting usage & billing data</p></div><label>Projected users<input aria-label="Projected users" inputMode="numeric" value={projection} aria-invalid={!valid} onChange={event=>setProjection(event.target.value)} />{!valid && <small>Enter a positive whole number.</small>}</label><strong>—</strong></article>
      </>}
  </section>;
}
