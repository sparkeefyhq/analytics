import { Search, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OverlayChatUser, OverlayUserChats } from '../../server/overlay-chats';
import { int } from '../format';

/**
 * Founder-only overlay chat reader (11 Nov). The roster of users whose overlay
 * 1:1 chats we have stored, and, for one user, the real threads with the lines
 * Keefie drafted highlighted. Only reachable when /api/session says founder;
 * the server enforces it too.
 */

const APP_LABEL: Record<string, string> = {
  'com.whatsapp': 'WhatsApp',
  'com.whatsapp.w4b': 'WhatsApp Business',
  'com.instagram.android': 'Instagram',
  'com.snapchat.android': 'Snapchat',
};
const appLabel = (pkg: string) => APP_LABEL[pkg] ?? pkg ?? 'Unknown';

/** Live: re-read quietly every 10 s while the tab is visible. Cached copies show instantly. */
const LIVE_MS = 10_000;
const rosterCache: { data: OverlayChatUser[] | null } = { data: null };
const detailCache = new Map<string, OverlayUserChats>();
/** Keep the old object when nothing changed, so React does not repaint or jump the scroll. */
const keepIfSame = <T,>(prev: T, next: T): T => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next);
const stripTime = (d: OverlayUserChats): unknown => ({ ...d, generatedAt: '' });

const istTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–';

export function FounderChatsPage() {
  const [users, setUsers] = useState<OverlayChatUser[] | null>(rosterCache.data);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<OverlayUserChats | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [openChat, setOpenChat] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [, tick] = useState(0);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;

  const loadRoster = useCallback(async () => {
    try {
      const r = await fetch('/api/overlay-chats/users', { credentials: 'same-origin' });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? `Error ${r.status}`);
      const next = (b.users ?? []) as OverlayChatUser[];
      rosterCache.data = keepIfSame(rosterCache.data, next);
      setUsers((cur) => keepIfSame(cur, next));
      setListError(null);
      setUpdatedAt(Date.now());
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Could not load the roster.');
    }
  }, []);

  const loadDetail = useCallback(async (id: string, silent: boolean) => {
    if (!silent) setLoadingDetail(true);
    try {
      const r = await fetch(`/api/overlay-chats?user=${encodeURIComponent(id)}`, { credentials: 'same-origin' });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? `Error ${r.status}`);
      const next = b as OverlayUserChats;
      const prev = detailCache.get(id);
      const keep = prev && JSON.stringify(stripTime(prev)) === JSON.stringify(stripTime(next));
      if (!keep) detailCache.set(id, next);
      if (selectedRef.current === id) {
        if (!keep) setDetail(next);
        setDetailError(null);
        setUpdatedAt(Date.now());
      }
    } catch (e) {
      // A quiet refresh that fails keeps what is on screen; only a first load shows the error.
      if (selectedRef.current === id && !silent) setDetailError(e instanceof Error ? e.message : 'Could not load chats.');
    } finally {
      if (selectedRef.current === id) setLoadingDetail(false);
    }
  }, []);

  // Roster: first read now (instant if cached), then live.
  useEffect(() => {
    loadRoster();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') loadRoster();
    }, LIVE_MS);
    const clock = setInterval(() => tick((n) => n + 1), 5_000);
    const onVisible = () => document.visibilityState === 'visible' && loadRoster();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      clearInterval(clock);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadRoster]);

  // Picked user: cached copy shows instantly; then a quiet refresh now and every 10 s.
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    const cached = detailCache.get(selected) ?? null;
    setDetail(cached);
    setDetailError(null);
    setOpenChat(null);
    loadDetail(selected, cached !== null);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') loadDetail(selected, true);
    }, LIVE_MS);
    return () => clearInterval(timer);
  }, [selected, loadDetail]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = users ?? [];
    if (!needle) return list;
    return list.filter((u) => (u.name ?? '').toLowerCase().includes(needle) || u.userId.includes(needle));
  }, [users, q]);

  return (
    <div className="page-wrap">
      <div className="page-head">
        <div>
          <h1>Overlay chats</h1>
          <p className="sub">Founder only · real overlay threads for training. Lines Keefie drafted are marked. Not shown to the team.</p>
          <p className="small-muted"><span className="led" style={{ display: 'inline-block', marginRight: 6 }} />Live · {updatedAt ? `updated ${Math.max(0, Math.round((Date.now() - updatedAt) / 1000))}s ago` : 'connecting…'}</p>
        </div>
      </div>

      <div className="banner" style={{ borderColor: 'var(--line)', background: 'var(--card)', color: 'var(--muted)' }}>
        Sensitive beta data. A line is tagged <b>Keefie</b> only when it exactly matches a draft we captured; other “me” lines are left unmarked, not assumed typed. Per-user overlay counts below are exact.
      </div>

      <div className="chats-grid">
        <aside className="chats-roster">
          <label className="search sm">
            <Search />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a user…" aria-label="Find a user" />
          </label>
          {listError && <div className="small-muted">{listError}</div>}
          {!users && !listError && <div className="small-muted">Loading roster…</div>}
          {filtered.map((u) => (
            <button key={u.userId} className={`roster-row ${selected === u.userId ? 'on' : ''}`} onClick={() => setSelected(u.userId)}>
              <span className="rr-name">{u.name ?? 'Unnamed'}{u.trafficClass && u.trafficClass !== 'external' ? <i className="rr-tag">{u.trafficClass}</i> : null}</span>
              <span className="small-muted">{int(u.chats)} chats · {int(u.lines)} lines · {u.apps.map(appLabel).join(', ')}</span>
              <span className="small-muted">Last {istTime(u.lastActivity)}</span>
            </button>
          ))}
          {users && filtered.length === 0 && <div className="small-muted">No users match.</div>}
        </aside>

        <section className="chats-detail">
          {!selected && <div className="small-muted">Pick a user to see their overlay chats.</div>}
          {selected && loadingDetail && !detail && <div className="small-muted">Loading chats…</div>}
          {selected && detailError && !detail && <div className="small-muted">{detailError}</div>}
          {selected && detail && (
            <>
              <div className="k-label" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <span><Sparkles style={{ width: 14, height: 14, verticalAlign: -2 }} /> {detail.name ?? 'Unnamed'}</span>
                <span className="small-muted">Overlay: {int(detail.usage.drafts)} drafts · {int(detail.usage.inserted)} inserted · {int(detail.usage.sent)} sent</span>
              </div>
              {detail.chats.length === 0 && <div className="small-muted">No stored overlay chats.</div>}
              {detail.chats.map((c) => {
                const key = `${c.sourceApp}:${c.titleHash}`;
                const overlayCount = c.lines.filter((l) => l.fromOverlay).length;
                return (
                  <div key={key} className="convo">
                    <button className="convo-head" onClick={() => setOpenChat(openChat === key ? null : key)} aria-expanded={openChat === key}>
                      <span>{appLabel(c.sourceApp)}</span>
                      <span className="small-muted">{c.lines.length} lines · {overlayCount} Keefie · {istTime(c.updatedAt)}</span>
                    </button>
                    {openChat === key && (
                      <div className="msgs">
                        {c.lines.map((l, i) => (
                          <div key={i} className={`msg ${l.from === 'me' ? (l.fromOverlay ? 'ov' : 'me') : 'kf'}`}>
                            <div>{l.text || <i className="small-muted">(empty)</i>}</div>
                            {l.fromOverlay && <span className="ov-tag">Keefie draft</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {detail.truncated && <div className="small-muted">Older chats not shown.</div>}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
