import { Gauge, Ghost, Heart, Instagram, MessageCircle, MessageSquare, Pointer, Radio, Search, Star, TriangleAlert, TrendingDown, TrendingUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Filters, Snapshot } from '../../server/types';
import { LatencyCurve, Skel } from '../components/parts';
import { ago, dec, int, pct, secs, usd } from '../format';

interface Props {
  data: Snapshot | null;
  loading: boolean;
  filters: Filters;
  search: string;
}

const POSTHOG_PERSON = 'https://us.posthog.com/project/599431/person/';
const PAGE = 6;

function Target({ value, label, min, max, strict = false }: {
  value: number | null;
  label: string;
  min?: number;
  max?: number;
  strict?: boolean;
}) {
  const below = value !== null && min !== undefined && value < min;
  const above = value !== null && max !== undefined && (value > max || (strict && value === max));
  const gap = below ? (min! - value!) / min! : above ? (value! - max!) / max! : 0;
  const status = gap === 0 ? 'At limit' : `${Math.max(1, Math.round(gap * 100))}% ${below ? 'below' : 'above'}`;

  return (
    <span className="overlay-target">
      {value !== null && <span className={`pill ${below || (above && min === undefined) ? 'red' : 'green'}`}>{below || above ? status : 'Met'}</span>}
      <span className="overlay-target-value">{label}</span>
    </span>
  );
}

const PLATFORM_STYLE: Record<string, { bg: string; fg: string; dot: string; Icon: typeof Heart }> = {
  WhatsApp: { bg: '#e7f8ee', fg: '#25d366', dot: '#25d366', Icon: MessageCircle },
  'WhatsApp Business': { bg: '#e7f8ee', fg: '#128c7e', dot: '#128c7e', Icon: MessageCircle },
  Hinge: { bg: '#fff0f2', fg: '#991b1b', dot: '#991b1b', Icon: Heart },
  Instagram: { bg: '#fce7f3', fg: '#e1306c', dot: '#e1306c', Icon: Instagram },
  Snapchat: { bg: '#fef9c3', fg: '#ca8a04', dot: '#ca8a04', Icon: Ghost },
};
const style = (label: string) => PLATFORM_STYLE[label] ?? { bg: 'var(--purple-bg)', fg: 'var(--purple)', dot: 'var(--purple)', Icon: MessageSquare };
const shareColor = (i: number) => ['var(--purple)', '#9a6ad6', 'var(--purple-2)', '#b892ee', 'var(--purple-3)'][Math.min(i, 4)];

/** Screen 3: Overlay Analytics (Figma 14223-28987). */
export function OverlayPage({ data, search }: Props) {
  const [userFilter, setUserFilter] = useState('');
  const [app, setApp] = useState('all');
  const [page, setPage] = useState(0);
  useEffect(() => setUserFilter(search), [search]);
  useEffect(() => setPage(0), [userFilter, app]);

  const users = useMemo(() => {
    const q = userFilter.trim().toLowerCase();
    return (data?.overlay.users ?? []).filter(
      (u) => (app === 'all' || u.app === app) && (!q || u.id.includes(q) || (u.name ?? '').toLowerCase().includes(q)),
    );
  }, [data, userFilter, app]);

  if (!data) return <OverlaySkeleton />;
  const ov = data.overlay;
  const lat = ov.latency;
  const dailyUsers = data.scorecard.diagnostics.find((item) => item.key === 'dou');
  const failOk = ov.failures.pct !== null && ov.failures.pct < 1;
  const present = lat.series.filter((s) => s.p95 !== null).map((s) => s.p95 as number);
  const pages = Math.max(1, Math.ceil(users.length / PAGE));
  const shown = users.slice(page * PAGE, page * PAGE + PAGE);
  const roster = new Map((data.roster ?? []).map((user) => [user.id, user.overlay]));
  const recordedActions = data.roster?.map((user) => user.overlay);
  const usersWhoInserted = recordedActions?.filter((actions) => actions.inserted > 0).length;
  const usersWhoSent = recordedActions?.filter((actions) => actions.sent.asIs + actions.sent.edited > 0).length;
  const firstPct = ov.taps.total ? (ov.taps.firstUsed / ov.taps.total) * 100 : 0;

  return (
    <>
      <h1 style={{ fontSize: 28 }}>Overlay Analytics</h1>
      <p className="sub">Usage, engagement and performance across connected apps.</p>

      <section className="section" style={{ marginTop: 28 }}>
        <div className="benchmark-row">
          <div className="section-label">Overlay performance · Phase 1 targets</div>
          <div className="overlay-p95">
            <span><TriangleAlert size={14} aria-hidden="true" /> P95</span>
            <strong>{secs(lat.p95)}</strong>
            <span>Target ≤3s</span>
          </div>
        </div>
        <div className="grid g4" style={{ gap: 25 }}>
          <div className="card overlay-benchmark-card">
            <div className="card-label">Overlay users today</div>
            <div className="value-row">
              <span className="big">{dailyUsers?.value ?? '–'}</span>
              <Target value={dailyUsers ? Number(dailyUsers.value) : null} label="4–6" min={4} max={6} />
            </div>
            <div className="note">Unique users who got a draft today (IST)</div>
          </div>
          <div className="card overlay-benchmark-card">
            <div className="card-label">Sessions per overlay day</div>
            <div className="value-row">
              <span className="big">{dec(ov.sessionsPerUser.value)}</span>
              <Target value={ov.sessionsPerUser.value} label="1–2" min={1} max={2} />
            </div>
            <div className="note">On days they used the overlay · {dec(ov.sessionsPerUser.perActiveDay)} per active user-day (any surface)</div>
          </div>
          <div className="card overlay-benchmark-card">
            <Star className="overlay-feature-star" aria-hidden="true" size={20} fill="currentColor" />
            <div className="card-label">First-draft use rate</div>
            <div className="value-row" style={{ marginTop: 16 }}>
              <span className="big purple">{pct(ov.firstReply.pct)}</span>
              <Target value={ov.firstReply.pct} label="≥50%" min={50} />
            </div>
            <div className="bar" style={{ marginTop: 14 }}><i style={{ width: `${ov.firstReply.pct ?? 0}%` }} /></div>
            <div className="note" style={{ fontSize: 13, marginTop: 12 }}>{ov.firstReply.used} of {ov.firstReply.total} Overlay sessions used the first draft</div>
          </div>
          <div className="card overlay-benchmark-card">
            <div className="card-label">Inserted vs. sent</div>
            <div className="value-row benchmark-row">
              <div><div className="big">{usersWhoInserted ?? '–'}</div><div className="note">Users who inserted</div></div>
              <div><div className="big">{usersWhoSent ?? '–'}</div><div className="note">Users with a recorded send</div></div>
            </div>
            <div className="note">First-draft sends and send timing pending verification</div>
          </div>
        </div>

        <div className="card strip" style={{ marginTop: 14 }}>
          <Radio style={{ width: 16, height: 16, color: 'var(--purple)' }} />
          <span className="lbl">Cost per Reply Request: <b>{usd(ov.cost.perRequest)}</b></span>
          <span className="right">
            Total Period Spend: <b>{usd(ov.cost.total)}</b>{ov.cost.estimated ? ' est.' : ''} ({int(ov.cost.requests)} replies generated)
          </span>
          {ov.cost.deltaPct !== null && (
            <span className={`trend ${ov.cost.deltaPct > 0 ? 'up' : ''}`}>
              {ov.cost.deltaPct > 0 ? <TrendingUp /> : <TrendingDown />} {ov.cost.deltaPct > 0 ? '+' : ''}{ov.cost.deltaPct.toFixed(1)}% per reply
            </span>
          )}
        </div>

        <div className={`alert ${failOk ? (ov.failures.failed ? '' : 'ok') : ''}`} style={{ marginTop: 14 }}>
          <span className="ldot" />
          <span>
            System failures: {int(ov.failures.failed)} of {int(ov.failures.requests)} requests failed · <b>{pct(ov.failures.pct)} failure rate</b> <Target value={ov.failures.pct} label="<1%" max={1} strict />
          </span>
          {ov.failures.failed > 0 && (
            <a href="https://us.posthog.com/project/599431/activity/explore" target="_blank" rel="noreferrer">Inspect Failed Requests →</a>
          )}
        </div>
      </section>

      <div className="grid g-1-1" style={{ marginTop: 25 }}>
        <div className="card rich">
          <div className="panel-head">
            <div>
              <div className="panel-title">Interaction Efficiency</div>
              <div className="panel-sub">Effort on each overlay session</div>
            </div>
            <span className="ic-btn"><Pointer /></span>
          </div>
          <div style={{ marginTop: 22, display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 32, fontWeight: 700 }}>{dec(ov.taps.perSession)}</span>
            <span className="unit" style={{ fontSize: 16 }}>taps</span>
          </div>
          <div className="note-13" style={{ marginTop: 8 }}>Average taps per session, from opening the bubble to inserting a reply.</div>
          <div className="foot" style={{ paddingTop: 40 }}>
            <div className="divider" />
            <div className="split-bar">
              <i style={{ width: `${firstPct}%`, background: 'var(--purple)' }} />
              <i style={{ width: `${100 - firstPct}%`, background: 'var(--purple-3)' }} />
            </div>
            <div className="legend">
              <div><b>{pct(ov.taps.total ? firstPct : null)}</b><span>First-draft use rate ({ov.taps.firstUsed}/{ov.taps.total})</span></div>
              <div style={{ ['--sw' as string]: 'var(--purple-3)' }}><b>{pct(ov.taps.total ? 100 - firstPct : null)}</b><span>Edited, regenerated or dismissed ({ov.taps.other}/{ov.taps.total})</span></div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="panel-head">
            <div>
              <div className="panel-title">System Reliability &amp; Latency</div>
              <div className="panel-sub">Latency and failure health</div>
            </div>
            <span className="ic-btn"><Gauge /></span>
          </div>
          <div className="grid g3" style={{ gap: 12, marginTop: 20 }}>
            <div className="mini">
              <div className="k">Median latency</div>
              <div className="v">{secs(lat.p50)}</div>
              <div className={`s ${lat.p50 !== null && lat.p50 <= lat.slaMs / 2 ? 'g' : ''}`}>{lat.p50 !== null && lat.p50 <= lat.slaMs / 2 ? 'Optimal' : 'Watch'}</div>
            </div>
            <div className="mini">
              <div className="k">P95 latency</div>
              <div className="v">{secs(lat.p95)}</div>
              <div className="s">SLA: &lt;{(lat.slaMs / 1000).toFixed(2)}s</div>
            </div>
            <div className="mini red">
              <div className="k">Failures</div>
              <div className="v">{ov.failures.failed} / {int(ov.failures.requests)}</div>
              <div className="s">{pct(ov.failures.pct)} rate</div>
            </div>
          </div>
          <div className="divider" />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: 'var(--muted)' }}>24H Rolling P95 Latency Curve</span>
            <b style={{ fontWeight: 600 }}>
              {present.length ? `Peak: ${secs(Math.max(...present))} · Valley: ${secs(Math.min(...present))}` : 'No replies in the last 24h'}
            </b>
          </div>
          <div className="curve"><LatencyCurve series={lat.series} slaMs={lat.slaMs} /></div>
          <div className="curve-labels"><span>-24h</span><span>-12h</span><span>Now</span></div>
        </div>
      </div>

      <section className="section" style={{ marginTop: 30 }}>
        <div className="section-label" style={{ marginBottom: 4 }}>Platform distribution</div>
        <p className="note-13" style={{ margin: '0 0 12px' }}>
          Reply requests across connected applications · {int(ov.pairedUsers)} paired users · {int(ov.cost.requests)} total requests
        </p>
        <div className="card" style={{ padding: '24px 24px 12px' }}>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th style={{ paddingLeft: 46, borderTop: 0 }}>Platform</th>
                  <th className="c" style={{ borderTop: 0 }}>Active users</th>
                  <th className="c" style={{ borderTop: 0 }}>Reply requests</th>
                  <th style={{ borderTop: 0 }}>Request share</th>
                </tr>
              </thead>
              <tbody>
                {ov.platforms.length === 0 && <tr><td colSpan={4} className="empty">No overlay requests in this range.</td></tr>}
                {ov.platforms.map((p, i) => {
                  const s = style(p.label);
                  return (
                    <tr key={p.key}>
                      <td style={{ paddingLeft: 46 }}>
                        <span className="plat"><span className="plat-ic" style={{ background: s.bg, color: s.fg }}><s.Icon /></span>{p.label}</span>
                      </td>
                      <td className="c mono" style={{ color: 'var(--muted)' }}>{p.users} user{p.users === 1 ? '' : 's'}</td>
                      <td className="c mono" style={{ fontWeight: 700 }}>{int(p.requests)}</td>
                      <td style={{ width: '40%' }}>
                        <div className="share">
                          <div className="bar"><i style={{ width: `${p.share}%`, background: shareColor(i) }} /></div>
                          <em>{pct(p.share, 0)}</em>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <div className="card table-card" style={{ marginTop: 25 }}>
        <div className="tc-head" style={{ padding: '30px 24px 20px', alignItems: 'flex-start' }}>
          <div>
            <div className="panel-title" style={{ fontSize: 18 }}>Overlay User Activity</div>
            <div className="panel-sub">Recorded actions per user in the selected period. Sends count drafts sent as-is or edited.</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <label className="filter-in">
              <Search />
              <input value={userFilter} onChange={(e) => setUserFilter(e.target.value)} placeholder="Filter by user ID or name..." aria-label="Filter users" />
            </label>
            <select className="select" value={app} onChange={(e) => setApp(e.target.value)} aria-label="Filter by app">
              <option value="all">All Apps</option>
              {ov.platforms.map((p) => <option key={p.key} value={p.label}>{p.label}</option>)}
            </select>
          </div>
        </div>
        <div className="table-scroll" style={{ padding: '0 24px' }}>
          <table>
            <thead>
              <tr>
                <th style={{ paddingLeft: 46 }}>User</th>
                <th>Sessions</th>
                <th>Reply requests</th>
                <th>Replies used</th>
                <th>Inserted</th>
                <th>Recorded draft sends</th>
                <th>Primary app</th>
                <th>Last active</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={9} className="empty">No overlay users match.</td></tr>}
              {shown.map((u) => {
                const actions = roster.get(u.id);
                return (
                <tr key={u.id}>
                  <td style={{ paddingLeft: 46, whiteSpace: 'nowrap' }}>
                    <b>{u.name || `Unnamed (…${u.id.slice(-5)})`}</b>
                  </td>
                  <td className="mono" style={{ color: 'var(--muted)' }}>{u.sessions} session{u.sessions === 1 ? '' : 's'}</td>
                  <td className="mono" style={{ fontWeight: 700 }}>{u.requests} request{u.requests === 1 ? '' : 's'}</td>
                  <td><b>{u.used}</b> <span className="mono" style={{ color: 'var(--muted)', fontSize: 12 }}>({pct(u.usedPct)})</span></td>
                  <td>{actions ? int(actions.inserted) : '–'}</td>
                  <td>{actions ? int(actions.sent.asIs + actions.sent.edited) : '–'}</td>
                  <td><span className="app-chip" style={{ ['--dot' as string]: style(u.app).dot }}>{u.app}</span></td>
                  <td style={{ color: 'var(--muted)', fontSize: 13, whiteSpace: 'nowrap' }}>{ago(u.lastActive)}</td>
                  <td><a className="link" href={POSTHOG_PERSON + u.id} target="_blank" rel="noreferrer">Telemetry Log →</a></td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
        <div className="pager">
          <span>Showing <b>{shown.length}</b> of <b>{users.length}</b> active overlay users</span>
          <div className="pg">
            <button disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
            {Array.from({ length: pages }, (_, i) => i).slice(Math.max(0, page - 2), Math.max(0, page - 2) + 5).map((i) => (
              <button key={i} className={i === page ? 'on' : ''} onClick={() => setPage(i)}>{i + 1}</button>
            ))}
            <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </div>
      </div>
    </>
  );
}

function OverlaySkeleton() {
  return (
    <>
      <Skel h={40} w={280} />
      <div className="grid g4" style={{ marginTop: 40 }}>{[0, 1, 2, 3].map((i) => <Skel key={i} h={172} />)}</div>
      <div style={{ marginTop: 14 }}><Skel h={56} /></div>
      <div style={{ marginTop: 14 }}><Skel h={46} /></div>
      <div style={{ marginTop: 30 }}><Skel h={300} /></div>
    </>
  );
}
