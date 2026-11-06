import { useEffect, useRef, useState } from 'react';
import { describeLive, type LiveFeed, type LiveRow } from '../../server/live';
import type { Audience } from '../../server/types';
import { ago } from '../format';

/** How often the page asks "anything new?" while visible. One small Postgres read per ask. */
const POLL_MS = 3_000;
const KEEP = 14;

/**
 * Live activity strip (6 Nov). Shows what real people are doing right now, and calls `onActivity`
 * when something new lands so the page re-reads its numbers straight away.
 */
export function LiveStrip({ audience, onActivity }: { audience: Audience; onActivity: () => void }) {
  const [rows, setRows] = useState<LiveRow[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [ok, setOk] = useState(true);
  const seen = useRef(new Set<string>());
  const since = useRef<string | null>(null);
  const activity = useRef(onActivity);
  activity.current = onActivity;

  useEffect(() => {
    seen.current = new Set();
    since.current = null;
    setRows([]);
    let stopped = false;
    let first = true;

    const poll = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const q = new URLSearchParams({ audience });
        if (since.current) q.set('since', since.current);
        const r = await fetch(`/api/live?${q}`, { credentials: 'same-origin' });
        if (!r.ok) throw new Error(String(r.status));
        const body = (await r.json()) as LiveFeed;
        if (stopped) return;
        setOk(true);
        since.current = body.now;
        const added = body.rows.filter((row) => !seen.current.has(row.id));
        added.forEach((row) => seen.current.add(row.id));
        if (!added.length) return;
        const shown = added.filter((row) => describeLive(row) !== null);
        if (shown.length) {
          setRows((cur) => [...shown.reverse(), ...cur].slice(0, KEEP));
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
  }, [audience]);

  return (
    <section className="live card" aria-live="polite">
      <div className="live-head">
        <span className={`live-dot ${ok ? '' : 'off'}`} />
        <b>Live</b>
        <span className="live-sub">{ok ? 'In-app chat and overlay, as it happens (last 10 min)' : 'Reconnecting…'}</span>
      </div>
      {rows.length === 0 ? (
        <div className="live-empty">Quiet right now. New signups, chats and overlay replies show up here within a few seconds.</div>
      ) : (
        <ul className="live-list">
          {rows.map((row) => {
            const d = describeLive(row);
            if (!d) return null;
            return (
              <li key={row.id} className={`${fresh.has(row.id) ? 'new ' : ''}${d.tone}`}>
                <span className="who">{row.name || (row.user.startsWith('anon_') ? 'New install' : `${row.user.slice(0, 8)}…`)}</span>
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
