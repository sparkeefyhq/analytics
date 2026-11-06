import { Check, Copy, ExternalLink, MessageSquare, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Filters, RosterUser, Snapshot, UserDetail } from '../../server/types';
import { Skel } from '../components/parts';
import { ago, downloadCsv, int, pct, secs, usd } from '../format';
import { screenLabelOf } from '../labels';

interface Props {
  data: Snapshot | null;
  filters: Filters;
  search: string;
  selected: string | null;
  onSelect: (id: string | null) => void;
}

const POSTHOG_PERSON = 'https://us.posthog.com/project/599431/person/';
type View = 'all' | 'attention' | 'active' | 'repeat' | 'stuck';
type Sort = 'recent' | 'drafts' | 'joined' | 'name';

const istTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '–';
const after = (from: string, to: string | null) => {
  if (!to) return '';
  const m = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 60_000));
  return m < 60 ? `+${m}m` : m < 48 * 60 ? `+${Math.round(m / 60)}h` : `+${Math.round(m / 1440)}d`;
};
const shortId = (id: string) => `usr_${id.slice(0, 5)}`;
const sends = (u: RosterUser) => u.overlay.sent.asIs + u.overlay.sent.edited + u.overlay.sent.own;
const attention = (u: RosterUser) => u.flags.some((f) => f.tone === 'red');

export function UsersPage({ data, filters, search, selected, onSelect }: Props) {
  const [q, setQ] = useState('');
  const [view, setView] = useState<View>('all');
  const [sort, setSort] = useState<Sort>('recent');
  useEffect(() => setQ(search), [search]);

  const rows = useMemo(() => {
    if (!data) return [];
    const term = q.trim().toLowerCase();
    let list = data.roster.filter(
      (u) => !term || u.id.includes(term) || (u.name ?? '').toLowerCase().includes(term) || u.overlay.apps.some((a) => a.label.toLowerCase().includes(term)) || u.flags.some((f) => f.label.toLowerCase().includes(term)),
    );
    if (view === 'attention') list = list.filter(attention);
    if (view === 'active') list = list.filter((u) => u.lastActive && Date.now() - Date.parse(u.lastActive) < 24 * 3_600_000);
    if (view === 'repeat') list = list.filter((u) => u.journey.repeat === 'yes');
    if (view === 'stuck') list = list.filter((u) => !u.journey.setupAt);
    const by: Record<Sort, (a: RosterUser, b: RosterUser) => number> = {
      recent: (a, b) => (b.lastActive ?? '').localeCompare(a.lastActive ?? ''),
      drafts: (a, b) => b.overlay.drafts - a.overlay.drafts,
      joined: (a, b) => b.signupAt.localeCompare(a.signupAt),
      name: (a, b) => (a.name ?? '~').localeCompare(b.name ?? '~'),
    };
    return [...list].sort(by[sort]);
  }, [data, q, view, sort]);

  if (!data) return <><Skel h={40} w={220} /><div style={{ marginTop: 30 }}><Skel h={420} /></div></>;
  const all = data.roster;
  const user = selected ? all.find((u) => u.id === selected) ?? null : null;
  const counts = {
    all: all.length,
    attention: all.filter(attention).length,
    active: all.filter((u) => u.lastActive && Date.now() - Date.parse(u.lastActive) < 24 * 3_600_000).length,
    repeat: all.filter((u) => u.journey.repeat === 'yes').length,
    stuck: all.filter((u) => !u.journey.setupAt).length,
  };
  const exportCsv = () =>
    downloadCsv(`keefie-users-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['User id', 'Name', 'Joined', 'Setup done', 'First draft', 'First act', 'Repeat', 'Sessions', 'Drafts', 'Copied', 'Inserted', 'Sent as-is', 'Sent edited', 'Sent own', 'In-app replies', 'Primary app', 'Last active', 'Flags'],
      ...rows.map((u) => [u.id, u.name, u.signupAt, u.journey.setupAt, u.journey.firstDraftAt, u.journey.firstActAt, u.journey.repeat, u.overlay.sessions, u.overlay.drafts, u.overlay.copied, u.overlay.inserted, u.overlay.sent.asIs, u.overlay.sent.edited, u.overlay.sent.own, u.app.replies, u.overlay.apps[0]?.label ?? '', u.lastActive, u.flags.map((f) => f.label).join('; ')]),
    ]);

  return (
    <>
      <h1>Users</h1>
      <p className="sub">
        {filters.audience === 'internal' ? 'Team accounts only.' : 'Real people outside the team.'} Every account in this audience, with setup, first value, adoption and repeat status. Click a row for the full profile.
      </p>

      <div className="chip-tabs" role="tablist">
        {([['all', 'All'], ['attention', 'Needs attention'], ['active', 'Active today'], ['repeat', 'Repeat users'], ['stuck', 'Setup not done']] as [View, string][]).map(([v, label]) => (
          <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
            {label} <b>{counts[v]}</b>
          </button>
        ))}
      </div>

      <div className="card table-card" style={{ marginTop: 16 }}>
        <div className="tc-head">
          <span className="tc-title">User roster</span>
          <span className="tc-help">{rows.length} of {all.length} · activity counts are for {data.rangeLabel.toLowerCase()}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <label className="filter-in">
              <Search />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, ID, app or flag..." aria-label="Search users" />
            </label>
            <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort users">
              <option value="recent">Recently active</option>
              <option value="drafts">Most drafts</option>
              <option value="joined">Newest</option>
              <option value="name">Name A–Z</option>
            </select>
            <button className="btn" onClick={exportCsv}>Export</button>
          </div>
        </div>
        <div className="table-scroll">
          <table className="roster">
            <thead>
              <tr>
                <th style={{ paddingLeft: 24 }}>User</th>
                <th>Joined</th>
                <th className="c">Setup</th>
                <th className="c">Useful reply</th>
                <th className="c">Repeat</th>
                <th className="c">Drafts</th>
                <th>Sent (as-is · edited · own)</th>
                <th>Last 14 days</th>
                <th>Last active</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={9} className="empty">No users match.</td></tr>}
              {rows.map((u) => (
                <tr key={u.id} className={`click ${selected === u.id ? 'sel' : ''}`} onClick={() => onSelect(u.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onSelect(u.id)}>
                  <td style={{ paddingLeft: 24 }}>
                    <div className="who">
                      <span className="avatar">{(u.name ?? '?').slice(0, 1).toUpperCase()}</span>
                      <div>
                        <div style={{ fontWeight: 600 }}>{u.name ?? <span className="small-muted">No name</span>}</div>
                        <div className="uid" style={{ fontSize: 11 }}>{shortId(u.id)}{u.returning ? <span className="small-muted"> · returning</span> : null}</div>
                      </div>
                    </div>
                    {u.flags.length > 0 && <div className="flags">{u.flags.slice(0, 2).map((f) => <span key={f.key} className={`flag ${f.tone}`}>{f.label}</span>)}{u.flags.length > 2 && <span className="flag tan">+{u.flags.length - 2}</span>}</div>}
                  </td>
                  <td className="nowrap small">{ago(u.signupAt)}</td>
                  <td className="c"><Status at={u.journey.setupAt} from={u.journey.firstOpen} /></td>
                  <td className="c"><Status at={u.journey.firstActAt} from={u.journey.firstOpen} /></td>
                  <td className="c"><RepeatPill r={u.journey.repeat} /></td>
                  <td className="c mono" style={{ fontWeight: 700 }}>{u.overlay.drafts}</td>
                  <td><SentBar u={u} /></td>
                  <td><Days days={u.days} /></td>
                  <td className="nowrap small">{u.lastActive ? ago(u.lastActive) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {user && <UserPanel user={user} onClose={() => onSelect(null)} />}
    </>
  );
}

function Status({ at, from }: { at: string | null; from: string }) {
  if (!at) return <span className="small-muted">–</span>;
  return <span className="ok-t" title={istTime(at)}><Check /> {after(from, at)}</span>;
}

function RepeatPill({ r }: { r: RosterUser['journey']['repeat'] }) {
  if (r === 'yes') return <span className="flag green">Yes</span>;
  if (r === 'no') return <span className="flag red">No</span>;
  if (r === 'pending') return <span className="flag tan">Pending</span>;
  return <span className="small-muted">–</span>;
}

function SentBar({ u }: { u: RosterUser }) {
  const total = sends(u);
  if (!total) return <span className="small-muted">{u.overlay.copied + u.overlay.inserted ? `${u.overlay.copied + u.overlay.inserted} copied/inserted` : '–'}</span>;
  const s = u.overlay.sent;
  return (
    <div style={{ minWidth: 130 }}>
      <div className="split-bar" style={{ height: 6 }}>
        <i style={{ width: `${(s.asIs / total) * 100}%`, background: 'var(--green)' }} />
        <i style={{ width: `${(s.edited / total) * 100}%`, background: 'var(--purple-2)' }} />
        <i style={{ width: `${(s.own / total) * 100}%`, background: 'var(--purple-3)' }} />
      </div>
      <div className="mono small" style={{ marginTop: 4 }}>{s.asIs} · {s.edited} · {s.own}</div>
    </div>
  );
}

function Days({ days }: { days: number[] }) {
  return (
    <div className="days" aria-label="Active days, last 14">
      {days.map((d, i) => <i key={i} className={d === 2 ? 'o' : d === 1 ? 'a' : ''} title={d === 2 ? 'Overlay' : d === 1 ? 'In-app' : 'Not active'} />)}
    </div>
  );
}

function Tally({ title, items }: { title: string; items: { label: string; n: number }[] }) {
  const total = items.reduce((a, x) => a + x.n, 0);
  return (
    <div>
      <div className="k-label">{title}</div>
      {items.length === 0 ? <div className="small-muted">None yet</div> : (
        <div className="tally">
          {items.slice(0, 6).map((x) => (
            <div key={x.label} className="tally-row">
              <span>{x.label}</span>
              <div className="bar"><i style={{ width: `${(x.n / total) * 100}%` }} /></div>
              <b className="mono">{x.n}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UserPanel({ user: u, onClose }: { user: RosterUser; onClose: () => void }) {
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [openChat, setOpenChat] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setDetail(null);
    fetch(`/api/user?id=${u.id}`, { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d: UserDetail) => live && setDetail(d))
      .catch(() => live && setDetail(null))
      .finally(() => live && setLoading(false));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => {
      live = false;
      removeEventListener('keydown', onKey);
    };
  }, [u.id, onClose]);
  // 6 Nov (live): when this person does something new, re-read their chats in place, no skeleton.
  const firstActive = useRef(u.lastActive);
  useEffect(() => {
    if (u.lastActive === firstActive.current) return;
    firstActive.current = u.lastActive;
    let live = true;
    fetch(`/api/user?id=${u.id}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: UserDetail | null) => live && d && setDetail(d))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [u.id, u.lastActive]);

  const o = u.overlay;
  const total = sends(u);
  const place = detail?.person ? [detail.person.city, detail.person.region, detail.person.country].filter(Boolean).join(', ') : '';
  const steps: [string, string | null][] = [
    ['First open', u.journey.firstOpen],
    ['Setup done', u.journey.setupAt],
    ['First draft', u.journey.firstDraftAt],
    ['First used a draft', u.journey.firstActAt],
    ['Used again (later day)', u.journey.repeatAt],
  ];

  return (
    <div className="drawer-wrap" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-label={`User ${u.name ?? u.id}`} onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <span className="avatar lg">{(u.name ?? '?').slice(0, 1).toUpperCase()}</span>
          <div style={{ minWidth: 0 }}>
            <div className="panel-title" style={{ fontSize: 20 }}>{u.name ?? 'No name'}</div>
            <div className="small-muted" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="mono">{u.id}</span>
              <button className="icon-btn" aria-label="Copy user id" onClick={() => { navigator.clipboard?.writeText(u.id); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
                {copied ? <Check /> : <Copy />}
              </button>
            </div>
            <div className="flags" style={{ marginTop: 8 }}>
              <span className={`flag ${u.team ? 'tan' : 'purple'}`}>{u.team ? 'Team' : 'Real user'}</span>
              {u.returning && <span className="flag tan">Joined before launch</span>}
              {u.version && <span className="flag tan">v{u.version}</span>}
              {place && <span className="flag tan">{place}</span>}
              {detail?.person?.email && <span className="flag tan">{detail.person.email}</span>}
              {u.flags.map((f) => <span key={f.key} className={`flag ${f.tone}`}>{f.label}</span>)}
            </div>
          </div>
          <button className="icon-btn close" aria-label="Close" onClick={onClose}><X /></button>
        </header>

        <div className="drawer-body">
          <section>
            <div className="k-label">Journey</div>
            <ol className="timeline">
              {steps.map(([label, at]) => (
                <li key={label} className={at ? 'done' : ''}>
                  <span className="dotm" />
                  <span className="tl-label">{label}</span>
                  <span className="tl-time mono">{at ? `${istTime(at)} ${label === 'First open' ? '' : after(u.journey.firstOpen, at)}` : label === 'Used again (later day)' && u.journey.repeat === 'pending' ? 'window open' : '–'}</span>
                </li>
              ))}
            </ol>
            <div className="small-muted" style={{ marginTop: 8 }}>
              Onboarding: {u.journey.screens} screens{u.journey.lastScreen ? `, last ${screenLabelOf(u.journey.lastScreen)}` : ''} · Permissions on: {u.journey.permissions.length ? u.journey.permissions.map((p) => screenLabelOf(`perm:${p}`)).join(', ') : 'none recorded'}
            </div>
          </section>

          <section>
            <div className="k-label">Last 14 days <span className="small-muted">({u.activeDays} active {u.activeDays === 1 ? 'day' : 'days'} in total)</span></div>
            <Days days={u.days} />
          </section>

          <section>
            <div className="k-label">Overlay</div>
            <div className="grid g3" style={{ gap: 10 }}>
              <div className="mini"><div className="k">Sessions</div><div className="v">{o.sessions}</div><div className="s">{o.drafts} drafts · {o.failed} failed</div></div>
              <div className="mini"><div className="k">First draft used</div><div className="v">{pct(o.firstTryPct, 0)}</div><div className="s">Any draft used {pct(o.usedPct, 0)}</div></div>
              <div className="mini"><div className="k">Median response</div><div className="v">{secs(o.medianLatency)}</div><div className="s">Cost {usd(o.cost)}</div></div>
            </div>
            <div className="grid g3" style={{ gap: 10, marginTop: 10 }}>
              <div className="mini"><div className="k">Copied</div><div className="v">{o.copied}</div></div>
              <div className="mini"><div className="k">Inserted</div><div className="v">{o.inserted}</div></div>
              <div className="mini"><div className="k">Confirmed sends</div><div className="v">{total}</div></div>
            </div>
            {total > 0 && (
              <div style={{ marginTop: 12 }}>
                <div className="split-bar">
                  <i style={{ width: `${(o.sent.asIs / total) * 100}%`, background: 'var(--green)' }} />
                  <i style={{ width: `${(o.sent.edited / total) * 100}%`, background: 'var(--purple-2)' }} />
                  <i style={{ width: `${(o.sent.own / total) * 100}%`, background: 'var(--purple-3)' }} />
                </div>
                <div className="legend3">
                  <span style={{ ['--sw' as string]: 'var(--green)' }}>Sent as-is <b>{o.sent.asIs}</b></span>
                  <span style={{ ['--sw' as string]: 'var(--purple-2)' }}>Edited <b>{o.sent.edited}</b></span>
                  <span style={{ ['--sw' as string]: 'var(--purple-3)' }}>Own words <b>{o.sent.own}</b></span>
                </div>
              </div>
            )}
          </section>

          <section className="grid g3" style={{ gap: 18 }}>
            <Tally title="Apps (sessions)" items={o.apps} />
            <Tally title="Who they chat with" items={o.relationships} />
            <Tally title="Moods used" items={o.moods} />
          </section>

          <section>
            <div className="k-label">Free pilot allowance · {u.quota.month}</div>
            <Allowance label="Overlay drafts" n={u.quota.drafts} cap={u.quota.draftCap} />
            <Allowance label="In-app answers" n={u.quota.answers} cap={u.quota.answerCap} />
            <div className="small-muted" style={{ marginTop: 6 }}>
              {u.app.messages !== null && u.app.messages !== undefined
                ? `In-app: ${int(u.app.messages)} messages · ${int(u.app.answered ?? 0)} answered by Wingman${u.app.safety ? ` · ${int(u.app.safety)} answered by Safety` : ''}${u.app.failed ? ` · ${int(u.app.failed)} failed` : ''} · cost ${usd(u.app.cost)}`
                : `In-app: ${int(u.app.replies)} answers in range · cost ${usd(u.app.cost)}`}
            </div>
          </section>

          <section>
            <div className="k-label"><MessageSquare style={{ width: 14, height: 14, verticalAlign: -2 }} /> In-app conversations</div>
            {loading && <Skel h={60} />}
            {!loading && detail && detail.conversations.length === 0 && <div className="small-muted">No in-app conversations yet.</div>}
            {!loading && !detail && <div className="small-muted">Could not load conversations.</div>}
            {detail?.errors.length ? <div className="small-muted">{detail.errors.join(' · ')}</div> : null}
            {detail?.conversations.slice(0, 20).map((c) => (
              <div key={c.sessionId} className="convo">
                <button className="convo-head" onClick={() => setOpenChat(openChat === c.sessionId ? null : c.sessionId)} aria-expanded={openChat === c.sessionId}>
                  <span>{c.personName ? `About ${c.personName}` : 'General chat'}</span>
                  <span className="small-muted">{c.messages.length} messages · {istTime(c.startedAt)}</span>
                </button>
                {openChat === c.sessionId && (
                  <div className="msgs">
                    {c.messages.map((m, i) => (
                      <div key={i} className={`msg ${m.role === 'user' ? 'me' : 'kf'}`}>
                        <div>{m.content}</div>
                        <span className="small-muted">{istTime(m.at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {detail?.truncated && <div className="small-muted">Older messages not shown.</div>}
          </section>

          <a className="link" href={POSTHOG_PERSON + u.id} target="_blank" rel="noreferrer">Open full event log in PostHog <ExternalLink style={{ width: 13, height: 13, verticalAlign: -2 }} /></a>
        </div>
      </aside>
    </div>
  );
}

function Allowance({ label, n, cap }: { label: string; n: number; cap: number }) {
  const p = Math.min(100, (n / cap) * 100);
  return (
    <div className="allow">
      <span>{label}</span>
      <div className="bar"><i style={{ width: `${p}%`, background: p >= 80 ? 'var(--red)' : undefined }} /></div>
      <b className="mono">{n} / {cap}</b>
    </div>
  );
}
