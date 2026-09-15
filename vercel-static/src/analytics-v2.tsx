import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  MessageCircle,
  NotebookPen,
  RefreshCw,
  Search,
  Wallet,
} from 'lucide-react';
import {
  COHORTS,
  DAYS,
  type Cohort,
  type Metric,
  type Period,
  type ReturnType,
  type Snapshot,
  type User,
} from '../../lib/analytics-v2/model';
import { useLiveData } from './live-data';
import './analytics-v2.css';

/** Display name is attached server-side for the authorized live users view only. */
type NamedUser = User & { label?: string };
type Page = 'analytics' | 'users' | 'retention';
type Card = 'wingman' | 'memories' | 'cost' | null;

const labels: Record<string, string> = {
  all: 'All phases',
  'phase-0': 'Phase 0',
  'phase-1a': 'Phase 1A',
  'phase-1b': 'Phase 1B',
  'phase-2': 'Phase 2',
};
const periods: [Period, string][] = [
  ['today', 'Today'],
  ['7d', 'Last 7 days'],
  ['30d', 'Last 30 days'],
  ['all', 'All time'],
];
const states: Record<string, string> = {
  'no-data': 'No data yet',
  'not-connected': 'Not connected',
  'not-eligible': 'Window still open',
  'query-error': 'Query error',
};
const ist = (value: string | null | undefined, withTime = true) =>
  value
    ? new Date(value).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'short',
        ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
      })
    : '—';
const usd = (value: number, digits = 4) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: digits,
  }).format(value);
const num = (value: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(value);

function format(metric?: Metric) {
  const value = metric?.value;
  if (value === null || value === undefined) return '—';
  if (metric?.unit === 'USD') return usd(value);
  const suffix =
    metric?.unit === '%'
      ? '%'
      : metric?.unit === 'ms'
        ? ' ms'
        : metric?.unit === 'seconds'
          ? ' s'
          : '';
  return `${num(value)}${suffix}`;
}

function Value({ metric }: { metric?: Metric }) {
  return (
    <div className="v2-value">
      <strong>{format(metric)}</strong>
      {metric?.basis ? (
        <small className="v2-basis">{metric.basis}</small>
      ) : (
        metric?.denominator !== undefined && (
          <small>
            {metric.numerator} / {metric.denominator} eligible
          </small>
        )
      )}
      {metric?.state !== 'available' && (
        <small className="v2-state">
          {states[metric?.state ?? 'not-connected']}
        </small>
      )}
      {!!metric?.pending && <small>{metric.pending} pending</small>}
    </div>
  );
}
function Tile({
  name,
  metric,
  caption,
}: {
  name: string;
  metric?: Metric;
  caption?: string;
}) {
  return (
    <article
      className={`v2-tile ${metric?.state === 'available' ? '' : 'v2-pending'}`}
    >
      <div className="v2-label">
        <span>{name}</span>
        <details className="v2-definition">
          <summary aria-label={`Definition: ${name}`}>
            <CircleHelp size={15} aria-hidden="true" />
          </summary>
          <p>{metric?.detail ?? 'Waiting for the source.'}</p>
        </details>
      </div>
      <Value metric={metric} />
      {caption && <p className="v2-tile-caption">{caption}</p>}
    </article>
  );
}
function Tiles({
  items,
  metrics,
}: {
  items: [string, string, string?][];
  metrics: Record<string, Metric>;
}) {
  return (
    <div className="v2-grid">
      {items.map(([key, name, caption]) => (
        <Tile key={key} name={name} metric={metrics[key]} caption={caption} />
      ))}
    </div>
  );
}
function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="v2-section">
      <header>
        <h2>{title}</h2>
        {note && <small>{note}</small>}
      </header>
      {children}
    </section>
  );
}

/** Plain-language D1 status for one user, derived from the live-progress retention metric. */
function returnStatus(metric?: Metric): { label: string; tone: string } {
  if (!metric || metric.state === 'not-connected') return { label: '—', tone: 'muted' };
  if (metric.pending) return { label: 'Too early', tone: 'muted' };
  if ((metric.numerator ?? 0) > 0) return { label: 'Returned', tone: 'good' };
  if (/1 of 1 windows are still open/.test(metric.detail)) return { label: 'Window open', tone: 'muted' };
  if (metric.denominator) return { label: 'Did not return', tone: 'warn' };
  return { label: '—', tone: 'muted' };
}

function KpiCard({
  icon: Icon,
  name,
  value,
  sub,
  caption,
  active,
  onClick,
  children,
}: {
  icon: typeof Activity;
  name: string;
  value: string;
  sub?: string;
  caption: string;
  active: boolean;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      className={`v3-kpi ${active ? 'active' : ''}`}
      onClick={onClick}
      aria-pressed={active}
    >
      <span className="v3-kpi-head">
        <Icon size={18} aria-hidden="true" />
        <span>{name}</span>
        <ChevronRight size={16} aria-hidden="true" className="v3-kpi-chev" />
      </span>
      <strong>{value}</strong>
      {sub && <small className="v3-kpi-sub">{sub}</small>}
      <small className="v3-kpi-caption">{caption}</small>
      {children}
    </button>
  );
}

export function AnalyticsV2({
  page = 'analytics',
  canEdit = false,
  onLogin,
  onNavigate,
}: {
  page?: Page;
  canEdit?: boolean;
  onLogin: () => void;
  onNavigate?: (page: Page) => void;
}) {
  const [cohort, setCohort] = useState<Cohort>(() => {
    const c = new URLSearchParams(location.search).get('cohort');
    return COHORTS.includes(c as Cohort) ? (c as Cohort) : 'all';
  });
  const [period, setPeriod] = useState<Period>(() => {
    const p = new URLSearchParams(location.search).get('period');
    return ['today', '7d', '30d', 'all'].includes(p ?? '')
      ? (p as Period)
      : 'all';
  });
  const [dataset, setDataset] = useState(() =>
    new URLSearchParams(location.search).get('dataset') === 'test'
      ? 'test'
      : 'live',
  );
  const [card, setCard] = useState<Card>(null);
  const [retentionType, setRetentionType] = useState<ReturnType>('wingman');
  const [selected, setSelected] = useState<string | null>(
    () => new URLSearchParams(location.search).get('u'),
  );
  const [filter, setFilter] = useState<'all' | 'onboarded' | 'messaged' | 'new'>('all');
  const [query, setQuery] = useState('');
  const users = page === 'users';
  // Per-user rows need the admin session; public visitors see aggregates only.
  const wantUsers = users || canEdit;
  const params = new URLSearchParams({
    cohort,
    period,
    dataset,
    ...(wantUsers ? { view: 'users' } : {}),
  });
  const live = useLiveData<Snapshot>(`/api/analytics/v2?${params}`);
  useEffect(() => {
    const next = new URLSearchParams({ cohort, period, dataset });
    if (selected && users) next.set('u', selected);
    history.replaceState({}, '', `${location.pathname}?${next}`);
  }, [cohort, period, dataset, selected, users]);
  const data = live.data,
    m = data?.metrics ?? {};
  const roster = useMemo(() => (data?.users ?? []) as NamedUser[], [data]);
  const current = roster.find((u) => u.id === selected);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return roster
      .filter((u) =>
        filter === 'onboarded'
          ? u.metrics.onboarding?.value === 1
          : filter === 'messaged'
            ? (u.metrics.messages?.value ?? 0) > 0
            : filter === 'new'
              ? u.metrics.onboarding?.value !== 1
              : true,
      )
      .filter((u) => !q || (u.label ?? u.id).toLowerCase().includes(q))
      .sort(
        (a, b) =>
          (b.lastActive ?? '').localeCompare(a.lastActive ?? '') ||
          (b.firstOpen ?? '').localeCompare(a.firstOpen ?? ''),
      );
  }, [roster, filter, query]);

  const openUser = (id: string) => {
    setSelected(id);
    if (!users) onNavigate?.('users');
  };
  const periodLabel = periods.find(([p]) => p === period)?.[1] ?? 'All time';
  const costActive = m.cost_active?.state === 'available' ? m.cost_active.value! : null;

  const header = (
    <header className="control-header">
      <div>
        <p className="v2-eyebrow">SPARKEEFY / LAUNCH CONTROL</p>
        <h1>{users ? 'Users' : page === 'retention' ? 'Retention' : 'Analytics'}</h1>
        {page === 'analytics' && (
          <p className="v2-total-users">
            {format(m.total_users)} total users
          </p>
        )}
        <p className="v2-subtitle">
          {data
            ? `Live from the production database · checked ${ist(data.asOf)} IST · ${data.excluded} internal accounts excluded`
            : 'Checking the production database…'}
        </p>
      </div>
      <div className="v2-filters">
        <fieldset className="v3-segment" aria-label="Time">
          {periods.map(([value, label]) => (
            <button
              key={value}
              aria-pressed={period === value}
              onClick={() => setPeriod(value)}
            >
              {label}
            </button>
          ))}
        </fieldset>
        <label>
          Cohort
          <select
            aria-label="Cohort"
            value={cohort}
            onChange={(e) => setCohort(e.target.value as Cohort)}
          >
            {COHORTS.map((c) => (
              <option key={c} value={c}>
                {labels[c]}
              </option>
            ))}
          </select>
        </label>
        <button
          className="v2-refresh"
          onClick={live.refresh}
          disabled={live.loading}
          aria-label="Refresh data"
        >
          <RefreshCw size={15} aria-hidden="true" />
        </button>
      </div>
    </header>
  );

  const userTable = (compact: boolean) =>
    !canEdit && dataset !== 'test' ? (
      <div className="v3-locked">
        <div>
          <b>Per-user detail is private.</b>
          <p>Sign in with the staff account to see who is behind the numbers.</p>
        </div>
        <button className="control-primary" onClick={onLogin}>
          Admin sign in
        </button>
      </div>
    ) : !roster.length ? (
      <div className="v2-empty">
        {data?.state === 'available'
          ? 'No users in this cohort and period.'
          : 'User data is not connected.'}
      </div>
    ) : (
      <>
        <div className="v3-table-tools">
          <fieldset className="v3-chips" aria-label="Filter users">
            {(
              [
                ['all', `All · ${roster.length}`],
                ['onboarded', 'Onboarded'],
                ['messaged', 'Messaged Wingman'],
                ['new', 'Not onboarded'],
              ] as const
            ).map(([key, label]) => (
              <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>
                {label}
              </button>
            ))}
          </fieldset>
          <label className="v3-search">
            <Search size={14} aria-hidden="true" />
            <input
              aria-label="Search users"
              placeholder="Search by name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <div className="v3-table-wrap">
          <table className="v3-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Joined</th>
                <th>Onboarded</th>
                <th>People</th>
                <th>Memories</th>
                <th>Messages</th>
                <th>Chats</th>
                {!compact && <th>AI cost</th>}
                <th>Last active</th>
                <th>D1 return</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const status = returnStatus(u.retention.wingman.d1);
                return (
                  <tr key={u.id} onClick={() => openUser(u.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openUser(u.id)}>
                    <td>
                      <b>{u.label ?? 'Not onboarded'}</b>
                      <small>{u.id}</small>
                    </td>
                    <td>{ist(u.firstOpen, false)}</td>
                    <td>
                      {u.metrics.onboarding?.value === 1 ? (
                        <span className="v3-yes"><Check size={14} aria-hidden="true" /> Yes</span>
                      ) : (
                        <span className="v3-no">No</span>
                      )}
                    </td>
                    <td>{format(u.metrics.people)}</td>
                    <td>{format(u.metrics.memories)}</td>
                    <td>{format(u.metrics.messages)}</td>
                    <td>{format(u.metrics.sessions)}</td>
                    {!compact && <td>{format(u.metrics.cost)}</td>}
                    <td>{ist(u.lastActive)}</td>
                    <td>
                      <span className={`v3-pill ${status.tone}`}>{status.label}</span>
                    </td>
                    <td className="v3-open">Open <ArrowRight size={14} aria-hidden="true" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="v2-caption">
          People and memories are the highest count each user reached in the selected period. Messages, chats and cost are for the selected period only.
        </p>
      </>
    );

  const drilldown = (which: Card) => {
    if (!which) return null;
    if (!canEdit && dataset !== 'test')
      return (
        <div className="v3-drill">
          <div className="v3-locked">
            <div>
              <b>Who is behind this number is private.</b>
              <p>Sign in with the staff account to see the per-user list.</p>
            </div>
            <button className="control-primary" onClick={onLogin}>Admin sign in</button>
          </div>
        </div>
      );
    const list =
      which === 'wingman'
        ? roster
            .filter((u) => (u.metrics.messages?.value ?? 0) > 0)
            .sort((a, b) => (b.metrics.messages?.value ?? 0) - (a.metrics.messages?.value ?? 0))
        : which === 'memories'
          ? roster
              .filter((u) => (u.metrics.memories?.value ?? 0) > 0)
              .sort((a, b) => (b.metrics.memories?.value ?? 0) - (a.metrics.memories?.value ?? 0))
          : roster
              .filter((u) => (u.metrics.cost?.value ?? 0) > 0)
              .sort((a, b) => (b.metrics.cost?.value ?? 0) - (a.metrics.cost?.value ?? 0));
    const title =
      which === 'wingman'
        ? `Who used Wingman · ${periodLabel}`
        : which === 'memories'
          ? `Who added memories · ${periodLabel}`
          : `AI cost by user · ${periodLabel}`;
    return (
      <div className="v3-drill">
        <header>
          <h3>{title}</h3>
          <button onClick={() => setCard(null)}>Close</button>
        </header>
        {!list.length ? (
          <div className="v2-empty">Nobody yet in this period.</div>
        ) : (
          <ul className="v3-drill-list">
            {list.map((u) => (
              <li key={u.id}>
                <button onClick={() => openUser(u.id)}>
                  <span>
                    <b>{u.label ?? 'Not onboarded'}</b>
                    <small>Last active {ist(u.lastActive)}</small>
                  </span>
                  {which === 'wingman' && (
                    <span>
                      <b>{format(u.metrics.messages)} messages</b>
                      <small>{format(u.metrics.sessions)} chats · {format(u.metrics.people_used)} people</small>
                    </span>
                  )}
                  {which === 'memories' && (
                    <span>
                      <b>{format(u.metrics.memories)} memories</b>
                      <small>{format(u.metrics.people)} people saved</small>
                    </span>
                  )}
                  {which === 'cost' && (
                    <span>
                      <b>{format(u.metrics.cost)}</b>
                      <small>
                        {format(u.metrics.messages)} messages
                        {(u.metrics.messages?.value ?? 0) > 0 && u.metrics.cost?.value !== null && u.metrics.cost?.value !== undefined
                          ? ` · ${usd(u.metrics.cost.value / (u.metrics.messages?.value ?? 1))} / message`
                          : ''}
                      </small>
                    </span>
                  )}
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  const retentionPanel = (population: 'all' | 'user') => {
    const source =
      population === 'user' && current ? current.retention : data?.retention;
    if (!source) return null;
    const r = source[retentionType];
    return (
      <>
        <div className="v2-tabs" aria-label="Retention type">
          {(
            [
              ['app', 'Came back to the app'],
              ['wingman', 'Came back to Wingman'],
              ['situation', 'Came back with a new situation'],
            ] as const
          ).map(([key, name]) => (
            <button key={key} aria-pressed={retentionType === key} onClick={() => setRetentionType(key)}>
              {name}
            </button>
          ))}
        </div>
        <div className="v3-retention-main">
          {[1, 7].map((day) => (
            <article key={day} className="v3-retention-card">
              <span>Day {day}</span>
              <Value metric={r[`d${day}`]} />
              <small>{r[`d${day}`]?.detail}</small>
            </article>
          ))}
        </div>
        <div className="v2-overview v3-retention-rest">
          {DAYS.filter((d) => d !== 1 && d !== 7).map((day) => (
            <Tile key={day} name={`Day ${day}`} metric={r[`d${day}`]} />
          ))}
        </div>
      </>
    );
  };

  return (
    <section className="control-page v2-page">
      {header}
      {dataset === 'test' && (
        <output className="v2-test-banner">
          Synthetic test data · Not real users or launch evidence.
        </output>
      )}
      {live.error && (
        <p className="v2-notice" role="alert">
          {live.error}
        </p>
      )}
      {live.denied ? (
        <div className="v2-empty">
          <h2>Private user investigation</h2>
          <p>Sign in to view per-user activity.</p>
          <button className="control-primary" onClick={onLogin}>
            Admin sign in
          </button>
        </div>
      ) : live.loading && !data ? (
        <output className="v2-empty">Loading…</output>
      ) : (
        <>
          {data?.state !== 'available' && (
            <p className="v2-notice">
              {data?.detail ?? 'Source unavailable. Retry to check the connection.'}
            </p>
          )}

          {page === 'analytics' && (
            <>
              <div className="v3-kpis">
                <KpiCard
                  icon={MessageCircle}
                  name="Wingman users"
                  value={format(m.messaged)}
                  sub={
                    m.active?.value !== null && m.active?.value !== undefined
                      ? `of ${format(m.active)} active users · ${format(m.requests)} messages sent`
                      : undefined
                  }
                  caption="Users who sent at least one message to Wingman. Click to see who."
                  active={card === 'wingman'}
                  onClick={() => setCard(card === 'wingman' ? null : 'wingman')}
                />
                <KpiCard
                  icon={NotebookPen}
                  name="Memories added"
                  value={format(m.memories_added)}
                  sub={
                    m.memory_users?.value !== null && m.memory_users?.value !== undefined
                      ? `by ${format(m.memory_users)} users · ${format(m.people_added)} people added`
                      : undefined
                  }
                  caption="Memories saved in this period. Click to see who."
                  active={card === 'memories'}
                  onClick={() => setCard(card === 'memories' ? null : 'memories')}
                />
                <KpiCard
                  icon={Wallet}
                  name="AI cost"
                  value={format(m.cost)}
                  sub={
                    m.cost?.state === 'available'
                      ? `${format(m.cost_request)} per message · ${format(m.cost_active)} per active user`
                      : m.cost?.detail
                  }
                  caption="What we paid the AI provider in this period. Click to see cost by user."
                  active={card === 'cost'}
                  onClick={() => setCard(card === 'cost' ? null : 'cost')}
                >
                  {costActive !== null && (
                    <span className="v3-projection">
                      {[10, 100, 1000].map((n) => (
                        <span key={n}>
                          ×{num(n)} users <b>{usd(costActive * n, 2)}</b>
                        </span>
                      ))}
                      <small>same period · same usage mix</small>
                    </span>
                  )}
                </KpiCard>
              </div>
              {drilldown(card)}

              <Section
                title="Users"
                note={`${labels[cohort]} · ${periodLabel} · click a row to open the user`}
              >
                {userTable(true)}
              </Section>

              <div className="v3-two">
                <Section title="Wingman return" note="Live progress · anchored on each user's first open">
                  {retentionPanel('all')}
                  <button className="v3-link" onClick={() => onNavigate?.('retention')}>
                    Full retention view <ArrowRight size={14} aria-hidden="true" />
                  </button>
                </Section>
                <Section title="Reliability" note="From the AI call log · retries deduplicated">
                  <div className="v3-mini-grid">
                    <Tile name="Answer success" metric={m.success} caption="Completed ÷ resolved AI requests." />
                    <Tile name="Answers failed" metric={m.failed} caption="Requests that never completed." />
                    <Tile name="Typical answer time" metric={m.latency_median} caption="Half of answers were faster." />
                    <Tile name="Slow answer time (p95)" metric={m.latency_p95} caption="95% of answers were faster." />
                  </div>
                </Section>
              </div>
            </>
          )}

          {page === 'users' &&
            (current ? (
              <UserDetail
                user={current}
                canEdit={canEdit}
                synthetic={dataset === 'test'}
                retention={retentionPanel('user')}
                onBack={() => setSelected(null)}
              />
            ) : (
              <Section title="Everyone in this cohort" note={`${labels[cohort]} · ${periodLabel}`}>
                {userTable(false)}
              </Section>
            ))}

          {page === 'retention' && (
            <>
              <Section
                title="Do people come back?"
                note="Each user is measured from their own first open · a window counts as soon as it starts · rates can change while windows are open"
              >
                {retentionPanel('all')}
              </Section>
              <p className="v2-caption">
                Day N means the 24-hour window that starts N days after the user&rsquo;s first open. &ldquo;Window open&rdquo; means the user is inside that window right now and may still return. &ldquo;Too early&rdquo; means the window has not started yet. Retention is never shown as 1/1 = 100% without the numerator and denominator beside it.
              </p>
            </>
          )}

          <div className="v2-preview">
            <label>
              Data
              <select
                aria-label="Data source"
                value={dataset}
                onChange={(e) => setDataset(e.target.value)}
              >
                <option value="live">Live sources</option>
                <option value="test">Synthetic QA dataset</option>
              </select>
            </label>
          </div>
        </>
      )}
    </section>
  );
}

type Conversation = {
  sessionId: string;
  startedAt: string;
  personName: string | null;
  messages: { id: string; role: string; content: string; at: string }[];
};
type Conversations = { participant: string; sessions: Conversation[]; truncated: boolean };

function UserDetail({
  user,
  canEdit,
  synthetic,
  retention,
  onBack,
}: {
  user: NamedUser;
  canEdit: boolean;
  synthetic: boolean;
  retention: React.ReactNode;
  onBack: () => void;
}) {
  const chats = useLiveData<Conversations>(
    canEdit && !synthetic ? `/api/analytics/v2/conversations?user=${encodeURIComponent(user.id)}` : null,
  );
  const status = returnStatus(user.retention.wingman.d1);
  return (
    <div className="v2-user-detail">
      <button className="v2-back" onClick={onBack}>
        ← All users
      </button>
      <div className="v3-user-head">
        <div>
          <h2>{user.label ?? 'Not onboarded'}</h2>
          <p className="v2-caption">
            {user.id} · {user.cohorts.map((c) => labels[c]).join(' / ')} · joined {ist(user.firstOpen)} IST · last active {ist(user.lastActive)} IST
          </p>
        </div>
        <span className={`v3-pill ${status.tone}`}>D1: {status.label}</span>
      </div>
      <div className="v3-user-facts">
        {(
          [
            ['onboarding', 'Onboarded', (v: number) => (v === 1 ? 'Yes' : 'No')],
            ['people', 'People added'],
            ['memories', 'Memories added'],
            ['people_used', 'People used with Wingman'],
            ['messages', 'Messages sent'],
            ['sessions', 'Chats opened'],
            ['cost', 'AI cost'],
            ['second_situation', 'Second situation', (v: number) => (v === 1 ? 'Yes' : 'Not yet')],
          ] as [string, string, ((v: number) => string)?][]
        ).map(([key, name, fmt]) => {
          const metric = user.metrics[key];
          const v = metric?.value;
          return (
            <article key={key} className="v3-fact">
              <small>{name}</small>
              <b>{v === null || v === undefined ? '—' : fmt ? fmt(v) : format(metric)}</b>
            </article>
          );
        })}
      </div>
      <Section title="Activity by window" note="Each window is also cut by the time filter above">
        {[
          ['messages', 'Messages sent'],
          ['sessions', 'Chats opened'],
          ['days', 'Days active'],
        ].map(([key, name]) => (
          <div className="v2-window-row" key={key}>
            <h3>{name}</h3>
            {['today', '7d', '30d'].map((p) => (
              <div key={p}>
                <small>{p === 'today' ? 'Today' : p === '7d' ? 'Last 7 days' : 'Last 30 days'}</small>
                <Value metric={user.metrics[`${key}_${p}`]} />
              </div>
            ))}
          </div>
        ))}
      </Section>
      <Section title="Did they come back?">{retention}</Section>
      <Section title="Return attribution" note="Messages after the first 24 hours · attribution, not causation">
        <Tiles
          metrics={user.metrics}
          items={[
            ['return_organic', 'On their own'],
            ['return_reminder', 'After a reminder'],
            ['return_founder', 'Founder-prompted'],
            ['return_unknown', 'Unknown'],
          ]}
        />
      </Section>
      <Section
        title="Wingman conversations"
        note={
          canEdit && !synthetic
            ? 'What they typed and what Wingman answered · staff only · never leaves this screen'
            : 'Staff sign-in required'
        }
      >
        {!canEdit || synthetic ? (
          <div className="v2-empty">Conversation text is only shown to a signed-in staff account on live data.</div>
        ) : chats.loading && !chats.data ? (
          <output className="v2-empty">Loading conversations…</output>
        ) : chats.error && !chats.data ? (
          <p className="v2-notice">{chats.error}</p>
        ) : !chats.data?.sessions.length ? (
          <div className="v2-empty">No Wingman conversations yet.</div>
        ) : (
          <div className="v3-chats">
            {chats.data.truncated && (
              <p className="v2-notice">Showing the most recent messages only.</p>
            )}
            {chats.data.sessions.map((s) => (
              <details key={s.sessionId} className="v3-chat" open={s === chats.data!.sessions[0]}>
                <summary>
                  <b>{s.personName ? `About ${s.personName}` : 'General chat'}</b>
                  <small>{ist(s.startedAt)} IST · {s.messages.length} messages</small>
                </summary>
                <ol>
                  {s.messages.map((msg) => (
                    <li key={msg.id} className={msg.role === 'user' ? 'me' : 'wingman'}>
                      <small>{msg.role === 'user' ? 'User' : 'Wingman'} · {ist(msg.at)}</small>
                      <p>{msg.content}</p>
                    </li>
                  ))}
                </ol>
              </details>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
