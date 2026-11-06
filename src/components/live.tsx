import { X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { describeLive, summarizeLive, type LiveFeed, type LiveRow } from '../../server/live';
import type { Audience } from '../../server/types';
import { ago } from '../format';

/** How often the page asks "anything new?" while visible. One small Postgres read per ask. */
const POLL_MS = 3_000;
const KEEP = 14;
const KEEP_PERSON = 40;

export interface LivePerson {
  id: string;
  name: string | null;
}

/**
 * Live activity strip (6 Nov). Shows what people are doing right now, and calls `onActivity`
 * when something new lands so the page re-reads its numbers straight away.
 * With `person` set (the Live button on a Users row) it shows only that account: their last hour,
 * a one-line summary, and every new step within seconds. `onClear` goes back to everyone.
 */
export function LiveStrip({ audience, onActivity, person = null, onClear }: { audience: Audience; onActivity: () => void; person?: LivePerson | null; onClear?: () => void }) {
  const [rows, setRows] = useState<LiveRow[]>([]);
  const [all, setAll] = useState<LiveRow[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [ok, setOk] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const seen = useRef(new Set<string>());
  const since = useRef<string | null>(null);
  const activity = useRef(onActivity);
  activity.current = onActivity;
  const personId = person?.id ?? null;

  useEffect(() => {
    seen.current = new Set();
    since.current = null;
    setRows([]);
    setAll([]);
    setFresh(new Set());
    setLoaded(false);
    let stopped = false;
    let first = true;

    const poll = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const q = new URLSearchParams({ audience });
        if (personId) q.set('user', personId);
        if (since.current) q.set('since', since.current);
        const r = await fetch(`/api/live?${q}`, { credentials: 'same-origin' });
        if (!r.ok) throw new Error(String(r.status));
        const body = (await r.json()) as LiveFeed;
        if (stopped) return;
        setOk(true);
        setLoaded(true);
        since.current = body.now;
        const added = body.rows.filter((row) => !seen.current.has(row.id));
        added.forEach((row) => seen.current.add(row.id));
        if (!added.length) return;
        if (personId) setAll((cur) => [...cur, ...added].slice(-2_000));
        const shown = added.filter((row) => describeLive(row) !== null);
        if (shown.length) {
          setRows((cur) => [...shown.reverse(), ...cur].slice(0, personId ? KEEP_PERSON : KEEP));
          if (!first) setFresh(new Set(shown.map((row) => row.id)));
        }
        if (!first) activity.current();
      } catch {
        if (!stopped) setOk(false);
      } finally {
        first = false;
      }
    };

    poll();
    const timer = setInterval(poll, POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && poll();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [audience, personId]);

  const sum = useMemo(() => (personId ? summarizeLive(all) : null), [all, personId]);
  const label = person ? person.name || `${person.id.slice(0, 8)}…` : null;

  return (
    <section className={`live card ${person ? 'person' : ''}`} aria-live="polite">
      <div className="live-head">
        <span className={`live-dot ${ok ? '' : 'off'}`} />
        <b>Live</b>
        {person ? (
          <span className="live-person">
            {label}
            {onClear && (
              <button type="button" onClick={onClear} aria-label="Show everyone">
                <X />
              </button>
            )}
          </span>
        ) : null}
        <span className="live-sub">
          {!ok ? 'Reconnecting…' : person ? 'Overlay and in-app, last hour, updates within seconds' : 'In-app chat and overlay, as it happens (last 10 min)'}
        </span>
      </div>
      {sum && loaded && (
        <div className="live-sum">
          <span><b>{sum.sessions}</b> overlay sessions</span>
          <span><b>{sum.drafts}</b> drafts{sum.noReply ? ` · ${sum.noReply} no reply` : ''}</span>
          <span><b>{sum.changes}</b> mood/tab changes</span>
          <span><b>{sum.used}</b> used{sum.sessions ? ` · ${sum.firstTry} first try` : ''}</span>
          <span><b>{sum.sentAsIs}</b> sent as-is</span>
          <span><b>{sum.messages}</b> in-app messages{sum.safety ? ` · ${sum.safety} Safety` : ''}</span>
          {sum.topMood && <span>mostly <b>{sum.topMood}</b></span>}
        </div>
      )}
      {rows.length === 0 ? (
        <div className="live-empty">
          {person
            ? loaded
              ? `${label} has done nothing in the last hour. Their next tap or message shows up here within a few seconds.`
              : 'Loading…'
            : 'Quiet right now. New signups, chats and overlay replies show up here within a few seconds.'}
        </div>
      ) : (
        <ul className="live-list">
          {rows.map((row) => {
            const d = describeLive(row);
            if (!d) return null;
            return (
              <li key={row.id} className={`${fresh.has(row.id) ? 'new ' : ''}${d.tone}`}>
                <span className="who">{person ? new Date(row.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : row.name || (row.user.startsWith('anon_') ? 'New install' : `${row.user.slice(0, 8)}…`)}</span>
                <span className="what">{d.text}</span>
                <span className="when">{ago(row.at)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
