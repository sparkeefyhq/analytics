import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowRight,
  CalendarDays,
  CircleHelp,
  Compass,
  HeartPulse,
  Layers,
  RefreshCw,
  Repeat2,
  ShieldCheck,
  Sparkles,
  Target,
  UsersRound,
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

/** Display name is attached server-side for the authorized live users view only. */
type NamedUser = User & { label?: string };
import { useLiveData } from './live-data';
import './analytics-v2.css';

const labels: Record<string, string> = {
  all: 'All phases',
  'phase-0': 'Phase 0',
  'phase-1a': 'Phase 1A',
  'phase-1b': 'Phase 1B',
  'phase-2': 'Phase 2',
};
const states: Record<string, string> = {
  'no-data': 'No data yet',
  'not-connected': 'Not connected',
  'not-eligible': 'Window still open',
  'query-error': 'Query error',
};
function Value({ metric }: { metric?: Metric }) {
  const value = metric?.value;
  return (
    <div className="v2-value">
      <strong>
        {value === null || value === undefined
          ? '—'
          : metric?.unit === 'USD'
            ? new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                maximumFractionDigits: 4,
              }).format(value)
            : `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(value)}${metric?.unit === '%' ? '%' : metric?.unit === 'ms' ? ' ms' : metric?.unit === 'seconds' ? ' s' : ''}`}
      </strong>
      {metric?.denominator !== undefined && (
        <small>
          {metric.numerator} / {metric.denominator} eligible
        </small>
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
  prominent = false,
  caption,
  icon: Icon,
}: {
  name: string;
  metric?: Metric;
  prominent?: boolean;
  caption?: string;
  icon?: typeof Activity;
}) {
  return (
    <article
      className={`${prominent ? 'v2-tile v2-emphasis' : 'v2-tile'} ${metric?.state === 'available' ? '' : 'v2-pending'}`}
    >
      {Icon && (
        <div className="v2-tile-icon">
          <Icon size={18} aria-hidden="true" />
          {prominent && <span>PRIMARY SIGNAL</span>}
        </div>
      )}
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
      <small className="v2-source">{metric?.source ?? '—'}</small>
    </article>
  );
}
function Tiles({
  items,
  metrics,
}: {
  items: [string, string][];
  metrics: Record<string, Metric>;
}) {
  return (
    <div className="v2-grid">
      {items.map(([key, name]) => (
        <Tile key={key} name={name} metric={metrics[key]} />
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
const people: [string, string][] = [
  ['people_1', '1+ person'],
  ['people_2', '2+ people'],
  ['people_3', '3+ people'],
  ['people_5', '5+ people'],
];
const memory: [string, string][] = [
  ['memory_1', '1+ memory'],
  ['memory_3', '3+ memories'],
  ['memory_5', '5+ memories'],
  ['memory_20', '20+ memories'],
];

export function AnalyticsV2({
  users = false,
  onLogin,
}: {
  users?: boolean;
  onLogin: () => void;
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
  const [panel, setPanel] = useState('overview');
  const [retentionType, setRetentionType] = useState<ReturnType>('wingman');
  const [selected, setSelected] = useState<string | null>(null);
  const [projection, setProjection] = useState('1000');
  const params = new URLSearchParams({
    cohort,
    period,
    dataset,
    ...(users ? { view: 'users' } : {}),
  });
  const live = useLiveData<Snapshot>(`/api/analytics/v2?${params}`);
  useEffect(() => {
    history.replaceState(
      {},
      '',
      `${location.pathname}?${new URLSearchParams({ cohort, period, dataset })}`,
    );
  }, [cohort, period, dataset]);
  const data = live.data,
    m = data?.metrics ?? {};
  const current = (data?.users as NamedUser[] | undefined)?.find(
    (u) => u.id === selected,
  );
  const valid =
    /^\d+$/.test(projection) &&
    Number.isSafeInteger(Number(projection)) &&
    Number(projection) > 0;
  const projectionCost =
    valid && m.cost_active?.state === 'available'
      ? Number(projection) * m.cost_active.value!
      : null;
  return (
    <section className="control-page v2-page">
      <header className="control-header">
        <div>
          <p className="v2-eyebrow">SPARKEEFY / LAUNCH CONTROL</p>
          <h1>{users ? 'Users' : 'Launch pulse'}</h1>
          <p className="v2-subtitle">
            {users
              ? 'Investigate the activity behind the numbers.'
              : 'The signals that matter. The detail when you need it.'}
          </p>
        </div>
        <div className="v2-filters">
          {users && (
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
          )}
          <label>
            Time
            <select
              aria-label="Time"
              value={period}
              onChange={(e) => setPeriod(e.target.value as Period)}
            >
              {[
                ['today', 'Today'],
                ['7d', '7D'],
                ['30d', '30D'],
                ['all', 'All time'],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      {!users && (
        <>
          <section className="v2-launch-brief" aria-label="Phase 1 launch plan">
            <div className="v2-date">
              <CalendarDays size={20} aria-hidden="true" />
              <span>
                PLANNED START<strong>17 Sep 2026</strong>
                <small>Phase 1 · India time</small>
              </span>
            </div>
            <div className="v2-launch-copy">
              <b>Does useful help turn into an organic return?</b>
              <p>
                1A: wedge discovery → 1B: cold replication → Phase 2. Review
                each participant’s full 14-day window before deciding.
              </p>
            </div>
            <a
              className="v2-plan-link"
              href={`/plan?cohort=${cohort === 'all' ? 'phase-1a' : cohort}&period=${period}&dataset=live`}
            >
              View phase gates <ArrowRight size={16} aria-hidden="true" />
            </a>
          </section>
          <nav className="v2-cohort-nav" aria-label="Quick cohort filters">
            {COHORTS.map((c) => (
              <button
                key={c}
                aria-pressed={cohort === c}
                onClick={() => setCohort(c)}
              >
                {c === 'all' ? (
                  <Layers size={15} aria-hidden="true" />
                ) : (
                  <Target size={15} aria-hidden="true" />
                )}
                {labels[c]}
              </button>
            ))}
          </nav>
        </>
      )}
      <div className="v2-data-toolbar">
        <div className="v2-freshness">
          <span>
            <Activity size={14} aria-hidden="true" />{' '}
            {data
              ? `Checked ${new Date(data.asOf).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST · ${data.excluded} internal/test excluded`
              : 'Checking sources…'}
          </span>
        </div>
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
        <button
          className="v2-refresh"
          onClick={live.refresh}
          disabled={live.loading}
          aria-label="Refresh data"
        >
          <RefreshCw size={15} aria-hidden="true" />
        </button>
      </div>
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
          <p>Sign in to view pseudonymous product activity.</p>
          <button className="control-primary" onClick={onLogin}>
            Admin sign in
          </button>
        </div>
      ) : live.loading && !data ? (
        <output className="v2-empty">
          Loading {users ? 'users' : 'analytics'}…
        </output>
      ) : (
        <>
          {data?.state !== 'available' && (
            <p className="v2-notice">
              {data?.detail ??
                'Source unavailable. Retry to check the connection.'}
            </p>
          )}
          {users ? (
            <>
              <p className="v2-caption">
                Pseudonymous activity only · no conversation or profile content
              </p>
              {current ? (
                <UserDetail user={current} onBack={() => setSelected(null)} />
              ) : (
                <div className="v2-user-list">
                  {!data?.users.length ? (
                    <div className="v2-empty">
                      {data?.state === 'available'
                        ? 'No observed users in this cohort.'
                        : 'User data is not connected.'}
                    </div>
                  ) : (
                    (data.users as NamedUser[]).map((user) => (
                      <button
                        className="v2-user-row"
                        key={user.id}
                        onClick={() => setSelected(user.id)}
                      >
                        <span>
                          <b>{user.label ?? user.id}</b>
                          <small>
                            {user.label ? `${user.id} · ` : ''}
                            {user.cohorts
                              .map((c) => labels[c])
                              .join(' / ')} ·{' '}
                            {user.acquisition}
                          </small>
                        </span>
                        <span>
                          <Value metric={user.metrics.messages_7d} />
                          <small>messages · 7D</small>
                        </span>
                        <span>
                          <Value metric={user.metrics.people} />
                          <small>people</small>
                        </span>
                        <span aria-hidden="true">↗</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <nav className="v2-panel-nav" aria-label="Analytics sections">
                {(
                  [
                    ['overview', 'Overview', Compass],
                    ['usage', 'Activation & usage', Sparkles],
                    ['retention', 'Retention', Repeat2],
                    ['health', 'Reliability & cost', HeartPulse],
                  ] as const
                ).map(([key, label, Icon]) => (
                  <button
                    key={key}
                    aria-pressed={panel === key}
                    onClick={() => setPanel(key)}
                  >
                    <Icon size={17} aria-hidden="true" />
                    {label}
                  </button>
                ))}
              </nav>
              {panel === 'overview' && (
                <>
                  <Section
                    title="What matters most"
                    note={`${labels[cohort]} · selected time range`}
                  >
                    <div className="v2-overview v2-priority-grid">
                      <Tile
                        name="Organic second situation"
                        metric={m.organic_second}
                        prominent
                        icon={Repeat2}
                        caption="Users who returned with another genuine situation, independently and organically."
                      />
                      <Tile
                        name="Meaningfully activated"
                        metric={m.activated}
                        icon={Sparkles}
                        caption="Did the first real situation lead to useful help?"
                      />
                      <Tile
                        name="Wingman return · D7"
                        metric={data?.retention.wingman.d7}
                        icon={CalendarDays}
                        caption="Check the eligible count and pending windows before reading the rate."
                      />
                      <Tile
                        name="Active users"
                        metric={m.active}
                        icon={UsersRound}
                        caption="Observed product activity in this cohort and period."
                      />
                    </div>
                    <p className="v2-reading-note">
                      <span /> Violet highlights priority, not a passed gate.
                      Analytics are signals; the Plan holds verified gate
                      evidence.
                    </p>
                  </Section>
                  <Section title="Keep an eye on" note="Operational signals">
                    <div className="v2-grid v2-operating-grid">
                      <Tile
                        name="Request success"
                        metric={m.success}
                        icon={ShieldCheck}
                        caption="Completed requests / resolved requests."
                      />
                      <Tile
                        name="Failed responses"
                        metric={m.failed}
                        icon={HeartPulse}
                        caption="Investigate failures in Reliability & cost."
                      />
                      <Tile
                        name="Cost / active user"
                        metric={m.cost_active}
                        icon={Wallet}
                        caption="Measured AI spend for the selected period."
                      />
                    </div>
                  </Section>
                  <section
                    className="v2-review-guide"
                    aria-label="Daily review"
                  >
                    <div>
                      <p className="v2-eyebrow">DAILY REVIEW</p>
                      <h2>Turn the numbers into a decision.</h2>
                    </div>
                    <button onClick={() => setPanel('usage')}>
                      <Sparkles size={18} aria-hidden="true" />
                      <span>
                        <b>1. Check activation</b>
                        <small>See where first use stops.</small>
                      </span>
                      <ArrowRight size={16} aria-hidden="true" />
                    </button>
                    <button onClick={() => setPanel('retention')}>
                      <Repeat2 size={18} aria-hidden="true" />
                      <span>
                        <b>2. Check returns</b>
                        <small>Separate pending windows from results.</small>
                      </span>
                      <ArrowRight size={16} aria-hidden="true" />
                    </button>
                    <a
                      href={`/plan?cohort=${cohort === 'all' ? 'phase-1a' : cohort}&period=${period}&dataset=live`}
                    >
                      <Target size={18} aria-hidden="true" />
                      <span>
                        <b>3. Review phase gates</b>
                        <small>Resolve blockers and record evidence.</small>
                      </span>
                      <ArrowRight size={16} aria-hidden="true" />
                    </a>
                  </section>
                </>
              )}
              {panel === 'usage' && (
                <>
                  <Section
                    title="Acquisition & onboarding"
                    note="Unique users · milestones may overlap"
                  >
                    <Tiles
                      metrics={m}
                      items={[
                        ['first_opens', 'First app opens'],
                        ['onboarded', 'Onboarding completed'],
                      ]}
                    />
                  </Section>
                  <Section title="Wingman">
                    <Tile
                      name="Second genuine situation"
                      metric={m.second_situation}
                      prominent
                    />
                    <Tiles
                      metrics={m}
                      items={[
                        ['wingman_opened', 'Wingman opened'],
                        ['first_message', 'Sent first message'],
                        ['first_answer', 'Received first complete answer'],
                        ['five_messages', 'Sent 5+ messages'],
                        ['people_used_2', 'Used with 2+ people'],
                        ['sessions', 'Avg sessions per active user'],
                        [
                          'messages_day',
                          'Avg messages per active user · today',
                        ],
                        ['messages_7d', 'Avg messages per active user · 7D'],
                        ['messages_30d', 'Avg messages per active user · 30D'],
                      ]}
                    />
                  </Section>
                </>
              )}
              {panel === 'retention' && (
                <>
                  <Section
                    title="Retention"
                    note="Live progress · first-open anchor · rates can change while windows are open"
                  >
                    <div className="v2-tabs" aria-label="Retention type">
                      {(
                        [
                          ['app', 'App return'],
                          ['wingman', 'Wingman return'],
                          ['situation', 'Genuine situation'],
                        ] as const
                      ).map(([key, name]) => (
                        <button
                          key={key}
                          aria-pressed={retentionType === key}
                          onClick={() => setRetentionType(key)}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                    <div className="v2-overview">
                      {DAYS.map((day) => (
                        <Tile
                          key={day}
                          name={`D${day}`}
                          metric={data?.retention[retentionType][`d${day}`]}
                        />
                      ))}
                    </div>
                  </Section>
                </>
              )}
              {panel === 'usage' && (
                <>
                  <Section title="Memory" note="Created ≠ reused later">
                    <Tiles
                      metrics={m}
                      items={[
                        ...memory,
                        ['memory_average', 'Average observed count / user'],
                        ['memory_median', 'Median observed count / user'],
                      ]}
                    />
                  </Section>
                  <Section title="People" note="Created ≠ used with Wingman">
                    <Tiles
                      metrics={m}
                      items={[
                        ...people,
                        ['people_average', 'Average observed count / user'],
                        ['people_used', 'Unique people used with Wingman'],
                      ]}
                    />
                  </Section>
                </>
              )}
              {panel === 'health' && (
                <>
                  <Section title="Response health">
                    <Tiles
                      metrics={m}
                      items={[
                        ['complete', 'Complete responses'],
                        ['failed', 'Failed responses'],
                        ['retries', 'Retries'],
                        ['fallbacks', 'Fallbacks'],
                        ['success', 'Request success'],
                        ['latency_median', 'Median response latency'],
                        ['latency_p95', 'p95 response latency'],
                      ]}
                    />
                  </Section>
                  <Section title="AI economics">
                    <Tiles
                      metrics={m}
                      items={[
                        ['requests', 'Total AI requests'],
                        ['input_tokens', 'Input tokens'],
                        ['output_tokens', 'Output tokens'],
                        ['total_tokens', 'Total tokens'],
                        ['cost', 'Total AI cost'],
                        ['cost_request', 'Cost / request'],
                        ['cost_active', 'Cost / active user'],
                        ['cost_activation', 'Cost / meaningful activation'],
                        ['cost_repeater', 'Cost / organic repeater'],
                      ]}
                    />
                    <div className="v2-projection">
                      <label>
                        Projected active users
                        <input
                          aria-label="Projected active users"
                          value={projection}
                          inputMode="numeric"
                          aria-invalid={!valid}
                          onChange={(e) => setProjection(e.target.value)}
                        />
                      </label>
                      <span>
                        <b>
                          {projectionCost === null
                            ? '—'
                            : new Intl.NumberFormat('en-US', {
                                style: 'currency',
                                currency: 'USD',
                              }).format(projectionCost)}
                        </b>
                        <small>
                          {!valid
                            ? 'Enter a positive whole number.'
                            : projectionCost === null
                              ? 'Awaiting measured cost / active user'
                              : 'Scenario · same period and usage mix, not a forecast'}
                        </small>
                      </span>
                    </div>
                  </Section>
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
function UserDetail({ user, onBack }: { user: NamedUser; onBack: () => void }) {
  return (
    <div className="v2-user-detail">
      <button className="v2-back" onClick={onBack}>
        ← All users
      </button>
      <h2>{user.label ?? user.id}</h2>
      <p className="v2-caption">
        {user.label ? `${user.id} · ` : ''}
        {user.cohorts.map((c) => labels[c]).join(' / ')} · {user.acquisition} ·
        First open{' '}
        {user.firstOpen
          ? new Date(user.firstOpen).toLocaleString('en-IN', {
              timeZone: 'Asia/Kolkata',
            })
          : 'Unknown'}{' '}
        IST
      </p>
      <p className="v2-caption">
        Last active{' '}
        {user.lastActive
          ? new Date(user.lastActive).toLocaleString('en-IN', {
              timeZone: 'Asia/Kolkata',
            })
          : 'Unknown'}{' '}
        IST
      </p>
      <Tiles
        metrics={user.metrics}
        items={[
          ['onboarding', 'Onboarding completed'],
          ['people', 'People · observed count'],
          ['memories', 'Memories · observed count'],
          ['people_used', 'People used with Wingman'],
          ['second_situation', 'Second genuine situation'],
          ['assisted', 'Assisted messages'],
          ['independent', 'Independent messages'],
        ]}
      />
      <Section
        title="Engagement"
        note="Named windows intersect the selected time filter"
      >
        {[
          ['sessions', 'Wingman sessions'],
          ['messages', 'Wingman messages'],
          ['days', 'Active days'],
        ].map(([key, name]) => (
          <div className="v2-window-row" key={key}>
            <h3>{name}</h3>
            {['today', '7d', '30d'].map((p) => (
              <div key={p}>
                <small>{p === 'today' ? 'Today' : p.toUpperCase()}</small>
                <Value metric={user.metrics[`${key}_${p}`]} />
              </div>
            ))}
          </div>
        ))}
      </Section>
      <Section title="Wingman retention">
        <div className="v2-overview">
          {DAYS.map((day) => (
            <Tile
              key={day}
              name={`D${day}`}
              metric={user.retention.wingman[`d${day}`]}
            />
          ))}
        </div>
      </Section>
      <Section title="Return attribution">
        <Tiles
          metrics={user.metrics}
          items={[
            ['return_organic', 'Organic'],
            ['return_reminder', 'Reminder-assisted'],
            ['return_founder', 'Founder-prompted'],
            ['return_unknown', 'Unknown attribution'],
          ]}
        />
      </Section>
    </div>
  );
}
