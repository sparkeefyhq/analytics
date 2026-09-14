import { useEffect, useState } from 'react';
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
  all: 'All',
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
}: {
  name: string;
  metric?: Metric;
  prominent?: boolean;
}) {
  return (
    <article className={prominent ? 'v2-tile v2-emphasis' : 'v2-tile'}>
      <div className="v2-label">
        <span>{name}</span>
        <details className="v2-definition">
          <summary aria-label={`Definition: ${name}`}>ⓘ</summary>
          <p>{metric?.detail ?? 'Waiting for the source.'}</p>
        </details>
      </div>
      <Value metric={metric} />
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
        <h1>{users ? 'Users' : 'Analytics'}</h1>
        <div className="v2-filters">
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
      <div className="v2-preview">
        <span>Control v2 · Preview only</span>
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
      {dataset === 'test' && (
        <output className="v2-test-banner">
          Synthetic test data. These are not real users or Phase 0 results.
        </output>
      )}
      <div className="v2-freshness">
        <span>
          {data
            ? `${new Date(data.asOf).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST · ${data.excluded} internal/test excluded`
            : 'Checking sources…'}
        </span>
        <button onClick={live.refresh} disabled={live.loading}>
          Refresh
        </button>
      </div>
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
                            {user.cohorts.map((c) => labels[c]).join(' / ')} ·{' '}
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
              <Section title="Founder overview">
                <div className="v2-overview">
                  <Tile name="Active Users" metric={m.active} />
                  <Tile name="Meaningfully Activated" metric={m.activated} />
                  <Tile
                    name="Wingman Retention · D7"
                    metric={data?.retention.wingman.d7}
                  />
                  <Tile
                    name="Organic Second Situation"
                    metric={m.organic_second}
                    prominent
                  />
                  <Tile name="Wingman Success" metric={m.success} />
                </div>
              </Section>
              <Section
                title="Acquisition & onboarding"
                note="Unique users · milestones may overlap"
              >
                <Tiles
                  metrics={m}
                  items={[
                    ['first_opens', 'First app opens'],
                    ['onboarded', 'Onboarding completed'],
                    ...people,
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
                    ['messages_day', 'Avg messages per active user · today'],
                    ['messages_7d', 'Avg messages per active user · 7D'],
                    ['messages_30d', 'Avg messages per active user · 30D'],
                  ]}
                />
              </Section>
              <Section
                title="Retention"
                note="Closed windows only · first-open anchor"
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
    </section>
  );
}
function UserDetail({
  user,
  onBack,
}: {
  user: NamedUser;
  onBack: () => void;
}) {
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
