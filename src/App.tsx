import { ChevronDown, Download, Layers, LayoutGrid, Search, TrendingUp, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Audience, Filters, Range, Snapshot, Surface } from '../server/types';
import { ago, downloadCsv } from './format';
import { LiveStrip } from './components/live';
import { Login } from './pages/Login';
import { OverlayPage } from './pages/Overlay';
import { OverviewPage } from './pages/Overview';
import { ProductPage } from './pages/Product';
import { UsersPage } from './pages/Users';

type Route = 'overview' | 'overlay' | 'onboarding' | 'users';
const PATHS: Record<Route, string> = { overview: '/', overlay: '/overlay', onboarding: '/onboarding', users: '/users' };
const routeOf = (path: string): Route =>
  path.startsWith('/overlay') ? 'overlay' : path.startsWith('/onboarding') ? 'onboarding' : path.startsWith('/users') ? 'users' : 'overview';
/** Live: the page re-reads every 15 s while visible (backend rows are at most 15 s old, PostHog rows 60 s). */
const REFRESH_MS = 15_000;

function readFilters(): Filters {
  const q = new URLSearchParams(location.search);
  const one = <T extends string>(k: string, ok: T[], d: T) => (ok.includes(q.get(k) as T) ? (q.get(k) as T) : d);
  return {
    range: one<Range>('range', ['7d', '30d', 'all'], '30d'),
    surface: one<Surface>('surface', ['combined', 'overlay', 'app'], 'combined'),
    audience: one<Audience>('audience', ['external', 'internal'], 'external'),
    version: q.get('version') || 'all',
  };
}

function urlFor(route: Route, f: Filters, user?: string | null) {
  const q = new URLSearchParams();
  if (route === 'users' && user) q.set('user', user);
  if (f.range !== '30d') q.set('range', f.range);
  if (f.surface !== 'combined') q.set('surface', f.surface);
  if (f.audience !== 'external') q.set('audience', f.audience);
  if (f.version !== 'all') q.set('version', f.version);
  const s = q.toString();
  return PATHS[route] + (s ? `?${s}` : '');
}

export function App() {
  const [auth, setAuth] = useState<'checking' | 'in' | 'out'>('checking');
  useEffect(() => {
    fetch('/api/session', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((b: { authenticated: boolean }) => setAuth(b.authenticated ? 'in' : 'out'))
      .catch(() => setAuth('out'));
  }, []);
  if (auth === 'checking') return <div className="login"><div className="skeleton" style={{ width: 380, height: 300 }} /></div>;
  if (auth === 'out') return <Login onDone={() => setAuth('in')} />;
  return <Shell onSignedOut={() => setAuth('out')} />;
}

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} className={v === value ? 'on' : ''} aria-pressed={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Shell({ onSignedOut }: { onSignedOut: () => void }) {
  const [route, setRoute] = useState<Route>(routeOf(location.pathname));
  const [filters, setFilters] = useState<Filters>(readFilters);
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [cohortOpen, setCohortOpen] = useState(false);
  const [user, setUser] = useState<string | null>(new URLSearchParams(location.search).get('user'));
  const [, tick] = useState(0);
  const req = useRef(0);

  useEffect(() => {
    const onPop = () => {
      setRoute(routeOf(location.pathname));
      setFilters(readFilters());
      setUser(new URLSearchParams(location.search).get('user'));
    };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);

  const go = useCallback((r: Route, f: Filters = filters) => {
    history.pushState(null, '', urlFor(r, f));
    setUser(null);
    setRoute(r);
    setFilters(f);
    scrollTo({ top: 0 });
  }, [filters]);
  const setF = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    history.replaceState(null, '', urlFor(route, next, user));
    setFilters(next);
  };

  const load = useCallback(async () => {
    const id = ++req.current;
    setLoading(true);
    const q = new URLSearchParams({ range: filters.range, surface: filters.surface, audience: filters.audience, version: filters.version });
    const key = `kcp:v1:${q}`;
    // Instant first paint: show the last numbers this browser saw for these filters, then replace them.
    try {
      const cached = localStorage.getItem(key);
      if (cached && id === req.current) setData((cur) => cur && cur.filters.audience === filters.audience && cur.filters.range === filters.range && cur.filters.surface === filters.surface && cur.filters.version === filters.version ? cur : (JSON.parse(cached) as Snapshot));
    } catch {
      /* no storage: just wait for the network */
    }
    try {
      const r = await fetch(`/api/dashboard?${q}`, { credentials: 'same-origin' });
      if (r.status === 401) return onSignedOut();
      const body = await r.json();
      if (id !== req.current) return;
      if (!r.ok) throw new Error(body.error ?? `Error ${r.status}`);
      setData(body as Snapshot);
      try {
        localStorage.setItem(key, JSON.stringify(body));
      } catch {
        /* storage full or blocked: fine */
      }
      setError(null);
      setLastOk(Date.now());
    } catch (e) {
      if (id === req.current) setError(e instanceof Error ? e.message : 'Could not load analytics.');
    } finally {
      if (id === req.current) setLoading(false);
    }
  }, [filters, onSignedOut]);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, REFRESH_MS);
    const clock = setInterval(() => tick((n) => n + 1), 5_000);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      clearInterval(clock);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  // Live: something new happened -> re-read the numbers now (throttled), not at the next 15 s tick.
  const lastLive = useRef(0);
  const onLiveActivity = useCallback(() => {
    const now = Date.now();
    if (now - lastLive.current < 4_000) return;
    lastLive.current = now;
    load();
  }, [load]);

  const selectUser = useCallback((id: string | null) => {
    history.replaceState(null, '', urlFor('users', filters, id));
    setUser(id);
  }, [filters]);

  const syncState = error ? (data ? 'stale' : 'down') : data && data.sources.posthog !== 'live' ? 'stale' : 'ok';
  const versionLabel = filters.version === 'all' ? 'All builds' : `v${filters.version}`;

  const exportCsv = () => {
    if (!data) return;
    const stamp = new Date().toISOString().slice(0, 10);
    const head = [['Keefie Control Plane', route], ['Generated', data.generatedAt], ['Range', data.rangeLabel], ['Counting from', data.countFrom ?? 'full history'], ['Surface', filters.surface], ['Audience', filters.audience], ['Build', versionLabel], []];
    const o = data.overview;
    const ov = data.overlay;
    if (route === 'overlay') {
      downloadCsv(`keefie-overlay-${stamp}.csv`, [
        ...head,
        ['Metric', 'Value'],
        ['Sessions per active user per day', ov.sessionsPerUser.value],
        ['First-reply use rate %', ov.firstReply.pct],
        ['P50 latency ms', ov.latency.p50],
        ['P95 latency ms', ov.latency.p95],
        ['Cost per reply request USD', ov.cost.perRequest],
        ['Total spend USD', ov.cost.total],
        ['Reply requests', ov.cost.requests],
        ['Failed requests', ov.failures.failed],
        [],
        ['Platform', 'Active users', 'Reply requests', 'Share %'],
        ...ov.platforms.map((p) => [p.label, p.users, p.requests, p.share.toFixed(1)]),
        [],
        ['User id', 'Name', 'Sessions', 'Reply requests', 'Replies used', 'Primary app', 'Last active'],
        ...ov.users.map((u) => [u.id, u.name, u.sessions, u.requests, u.used, u.app, u.lastActive]),
      ]);
    } else {
      downloadCsv(`keefie-${route}-${stamp}.csv`, [
        ...head,
        ['Metric', 'Value'],
        ['DAU (trailing 24h)', o.dau.value],
        ['WAU (trailing 7d)', o.wau.value],
        ['MAU (trailing 30d)', o.mau.value],
        ['Overlay sessions per user per day', o.overlayFrequency.value],
        ['Cost per active user USD', o.cost.perActiveUser],
        ['Onboarding completion %', o.onboarding.pct],
        ['Onboarding completed / signups', `${o.onboarding.completed}/${o.onboarding.total}`],
        ['Overlay reply-use rate %', o.replyUse.pct],
        [],
        ['Cohort', 'Users', 'D1', 'D7', 'D14', 'State'],
        ...o.retention.rows.map((r) => [r.label, r.users, ...[r.d1, r.d7, r.d14].map((c) => (c.kind === 'value' ? `${c.n}/${c.d}` : `Pending ${c.note}`)), r.state]),
      ]);
    }
  };

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const v = search.trim().toLowerCase();
    if (['overview', 'home'].includes(v)) return go('overview');
    if (['onboarding', 'product', 'retention', 'funnel'].includes(v)) return go('onboarding');
    if (v === 'overlay') return go('overlay');
    if (route !== 'overlay' && route !== 'users') go('users');
  };

  const nav = useMemo(
    () => [
      ['overview', 'Overview', LayoutGrid],
      ['overlay', 'Overlay', Layers],
      ['onboarding', 'Onboarding', TrendingUp],
      ['users', 'Users', Users],
    ] as const,
    [],
  );

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <div className="brand-logo"><img src="/keefie-logo.png" alt="" /></div>
          <div className="brand-text">
            <img className="brand-word" src="/keefie-wordmark.png" alt="Keefie" />
            <span className="brand-sub">CONTROL PLANE</span>
          </div>
        </div>
        <div className="menu-label">Main menu</div>
        <nav className="nav">
          {nav.map(([r, label, Icon]) => (
            <a key={r} href={urlFor(r, filters)} className={route === r ? 'active' : ''} onClick={(e) => { e.preventDefault(); go(r); }}>
              <Icon /> {label} {route === r && <span className="dot" />}
            </a>
          ))}
        </nav>
        <div className="side-foot">
          <div className="menu-label">Connected integrations</div>
          <div className="chips">
            {(data?.overlay.platforms.length ? data.overlay.platforms.map((p) => p.label) : ['WhatsApp', 'Instagram', 'Snapchat']).slice(0, 6).map((p) => (
              <span key={p} className="chip-dark">{p}</span>
            ))}
          </div>
          <div className="sync">
            <span className={`led ${syncState === 'ok' ? '' : syncState}`} />
            Telemetry Sync
            <b className={syncState === 'ok' ? '' : syncState}>{syncState === 'ok' ? 'ACTIVE' : syncState === 'stale' ? 'STALE' : 'OFFLINE'}</b>
          </div>
          <div className="sync-time">
            {data ? (
              <>
                {lastOk ? `Live · checked ${Math.max(0, Math.round((Date.now() - lastOk) / 1000))}s ago` : 'Showing saved numbers…'}
                <br />
                PostHog {data.sources.posthogAt ? ago(data.sources.posthogAt) : 'unavailable'} · Backend {ago(data.sources.backendAt)}
                <br />
              </>
            ) : lastOk ? null : 'Connecting… '}
            <a href="#" onClick={(e) => { e.preventDefault(); fetch('/api/logout', { method: 'POST' }).then(onSignedOut); }}>Sign out</a>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <label className="search">
            <Search />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={onSearchKey}
              placeholder="Filter commands, telemetry, users..."
              aria-label="Search users or jump to a page"
            />
          </label>
          <div className="spacer" />
          <Seg<Surface>
            label="Surface"
            value={filters.surface}
            onChange={(surface) => setF({ surface })}
            options={route === 'overview' ? [['combined', 'Combined Surfaces'], ['overlay', 'Overlay Only'], ['app', 'In-App']] : [['combined', 'Combined'], ['overlay', 'Overlay'], ['app', 'In-App']]}
          />
          <Seg<Range> label="Range" value={filters.range} onChange={(range) => setF({ range })} options={[['7d', '7D'], ['30d', '30D'], ['all', 'All Time']]} />
          <Seg<Audience> label="Audience" value={filters.audience} onChange={(audience) => setF({ audience })} options={[['external', 'External'], ['internal', 'Internal']]} />
          <div className="cohort">
            <button onClick={() => setCohortOpen((o) => !o)} aria-expanded={cohortOpen}>
              <span className="pdot" />
              <span className="txt">Cohort: {versionLabel}<br />Production</span>
              <ChevronDown />
            </button>
            {cohortOpen && (
              <div className="cohort-menu" onMouseLeave={() => setCohortOpen(false)}>
                {['all', ...(data?.versions ?? [])].map((v) => (
                  <button key={v} className={filters.version === v ? 'on' : ''} onClick={() => { setF({ version: v }); setCohortOpen(false); }}>
                    {v === 'all' ? 'All builds' : `v${v}${v === data?.latestVersion ? ' (most users)' : ''}`}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="btn" onClick={exportCsv} disabled={!data}><Download /> Export</button>
        </header>
        <nav className="mobile-nav">
          {nav.map(([r, label]) => (
            <a key={r} href={urlFor(r, filters)} className={route === r ? 'active' : ''} onClick={(e) => { e.preventDefault(); go(r); }}>{label}</a>
          ))}
        </nav>

        <main className="page">
          {error && <div className="banner">{data ? `Showing the last good numbers. ${error}` : error}</div>}
          {!error && data?.sources.posthog === 'down' && (
            <div className="banner">
              {data.sources.ledgerFrom
                ? 'PostHog is not reachable. Everything since our own ledger started is live from the backend; only older history waits for PostHog.'
                : 'PostHog is not reachable. Accounts, onboarding, activity, cost, latency and failures are live from the backend; reply use, apps and taps are paused until PostHog is back.'}
            </div>
          )}
          {!error && data?.sources.posthog === 'stale' && (
            <div className="banner" style={{ borderColor: 'var(--line)', background: 'var(--card)', color: 'var(--muted)' }}>
              PostHog refresh is paused for a few minutes (rate limit). Event numbers are from {data.sources.posthogAt ? ago(data.sources.posthogAt) : 'earlier'}; backend numbers are live.
            </div>
          )}
          <LiveStrip audience={filters.audience} onActivity={onLiveActivity} />
          {route === 'overview' && <OverviewPage data={data} loading={loading} filters={filters} />}
          {route === 'onboarding' && <ProductPage data={data} loading={loading} filters={filters} />}
          {route === 'overlay' && <OverlayPage data={data} loading={loading} filters={filters} search={search} />}
          {route === 'users' && (
            <UsersPage
              data={data}
              filters={filters}
              search={search}
              selected={user}
              onSelect={selectUser}
            />
          )}
        </main>
      </div>
    </div>
  );
}
