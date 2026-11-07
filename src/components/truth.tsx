import { Check, Database, MessageSquareQuote, Trash2, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { RosterUser } from '../../server/types';
import type { TruthReport } from '../../server/truth';
import { ago, int } from '../format';
import { screenLabelOf } from '../labels';

/**
 * 7 Nov: the production database's own numbers, next to this dashboard's, and the
 * founder feedback log. Re-checked every 30 s.
 */
const POLL_MS = 30_000;

const stepLabel = (s: string | null) => {
  if (!s) return 'Unknown';
  const map: Record<string, string> = {
    first_open: 'Opened app only', intro_video: 'Intro video', intro_video_viewed: 'Intro video', meet_keefie: 'Meet Keefie',
    create_profile: 'Create profile', pledge: 'Pledge', signup_started: 'Started sign-up', auth_screen_viewed: 'Sign-up screen',
    home_first_viewed: 'Home', onboarding_completed: 'Finished onboarding',
  };
  return map[s] ?? screenLabelOf(s);
};

export function useTruth() {
  const [report, setReport] = useState<TruthReport | null>(null);
  const load = useCallback(async (fresh = false) => {
    try {
      const r = await fetch(`/api/truth${fresh ? '?fresh=1' : ''}`, { credentials: 'same-origin' });
      setReport((await r.json()) as TruthReport);
    } catch {
      setReport((prev) => (prev ? { ...prev, status: 'down', error: 'Could not reach the dashboard server' } : null));
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);
  return { report, reload: load };
}

export function TruthBadge({ report }: { report: TruthReport | null }) {
  if (!report) return <span className="flag tan">Checking database…</span>;
  if (report.status === 'ok') return <span className="flag green" title={`Checked ${report.checkedAt ? ago(report.checkedAt) : ''}`}><Check style={{ width: 12, height: 12, verticalAlign: -2 }} /> Matches production database</span>;
  if (report.status === 'settling') return <span className="flag tan">Re-checking against database…</span>;
  if (report.status === 'mismatch') return <span className="flag red"><TriangleAlert style={{ width: 12, height: 12, verticalAlign: -2 }} /> {report.diffs.length} difference{report.diffs.length === 1 ? '' : 's'} from database</span>;
  return <span className="flag red">Database check unavailable</span>;
}

export function TruthPanel({ report, reload, roster }: { report: TruthReport | null; reload: (fresh?: boolean) => Promise<void>; roster: RosterUser[] }) {
  const db = report?.database;
  const dash = report?.dashboard;
  return (
    <div className="card" style={{ marginTop: 16, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Database style={{ width: 18, height: 18 }} />
        <span className="tc-title">Production database check</span>
        <TruthBadge report={report} />
        <span className="small-muted">
          {report?.checkedAt ? `Read from prod Postgres ${ago(report.checkedAt)}` : ''}
          {report?.from ? ` · counting from ${new Date(report.from).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })} IST` : ''}
        </span>
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => void reload(true)}>Check now</button>
      </div>
      {report?.error && <div className="small-muted" style={{ marginTop: 8, color: 'var(--red)' }}>{report.error}</div>}

      {db && dash && (
        <>
          <div className="grid g3" style={{ gap: 10, marginTop: 14 }}>
            <Mini k="Installed (opened the app)" v={int(db.installs)} s={`${int(db.installedNoAccount)} never made an account${db.guests ? ` · ${db.guests} used it as guest` : ''}`} />
            <Mini k="Signed up since launch" v={int(db.signups)} s={`Dashboard shows ${int(dash.signups)}${db.signups === dash.signups ? ' ✓' : ' ✗'}${db.returning ? ` · +${db.returning} returning` : ''}`} />
            <Mini k="Actually used Keefie" v={`${int(db.usedOverlay)} overlay · ${int(db.usedChat)} chat`} s={`${int(db.signedUpNotUsed.length)} signed up but haven't used it yet`} />
          </div>
          <div className="grid g3" style={{ gap: 10, marginTop: 10 }}>
            <Mini k="Overlay drafts (database)" v={int(db.drafts)} s={`Dashboard ${int(dash.drafts)}${db.drafts === dash.drafts ? ' ✓' : ' ✗'}`} />
            <Mini k="Confirmed sends (database)" v={int(db.sends)} s={`Dashboard ${int(dash.sends)}${db.sends === dash.sends ? ' ✓' : ' ✗'}`} />
            <Mini k="Active accounts (database)" v={int(db.activeAccounts)} s={`Dashboard ${int(dash.activeAccounts)}${db.activeAccounts === dash.activeAccounts ? ' ✓' : ' ✗'}`} />
          </div>

          {report.diffs.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div className="k-label">{report.status === 'mismatch' ? 'Differences (stayed for 90 s or more)' : 'Differences being re-checked'}</div>
              <table className="roster" style={{ marginTop: 6 }}>
                <thead><tr><th>Person</th><th>What</th><th className="c">Dashboard</th><th className="c">Database</th></tr></thead>
                <tbody>
                  {report.diffs.slice(0, 20).map((d) => (
                    <tr key={`${d.user}${d.field}`}><td>{d.name ?? `usr_${d.user.slice(0, 5)}`}</td><td>{d.field}</td><td className="c mono">{d.dashboard}</td><td className="c mono">{d.database}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid g3" style={{ gap: 18, marginTop: 16 }}>
            <div>
              <div className="k-label">Installed, no account: where they stopped</div>
              {db.stoppedAt.length === 0 ? <div className="small-muted">Nobody yet</div> : (
                <div className="tally">
                  {db.stoppedAt.slice(0, 8).map((x) => (
                    <div key={x.step} className="tally-row">
                      <span>{stepLabel(x.step)}</span>
                      <div className="bar"><i style={{ width: `${(x.n / Math.max(1, db.installedNoAccount)) * 100}%` }} /></div>
                      <b className="mono">{x.n}</b>
                    </div>
                  ))}
                </div>
              )}
              <div className="small-muted" style={{ marginTop: 6 }}>A reinstall or a new phone counts again.</div>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <div className="k-label">Signed up, not used yet</div>
              {db.signedUpNotUsed.length === 0 ? <div className="small-muted">Everyone who signed up has used it</div> : (
                <div className="flags">
                  {db.signedUpNotUsed.map((u) => (
                    <span key={u.id} className="flag tan" title={`Joined ${ago(u.signupAt)}${u.lastStep ? ` · last step ${stepLabel(u.lastStep)}` : ''}`}>
                      {u.name ?? `usr_${u.id.slice(0, 5)}`} · {u.reachedHome ? 'setup done, no draft yet' : `stopped at ${stepLabel(u.lastStep)}`}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <FeedbackLog report={report} reload={reload} roster={roster} />
    </div>
  );
}

function Mini({ k, v, s }: { k: string; v: string; s: string }) {
  return <div className="mini"><div className="k">{k}</div><div className="v">{v}</div><div className="s">{s}</div></div>;
}

const SOURCES = [['whatsapp', 'WhatsApp'], ['call', 'Call'], ['in_person', 'In person'], ['other', 'Other']] as const;
const SOURCE_LABEL: Record<string, string> = { in_app: 'In the app', whatsapp: 'WhatsApp', call: 'Call', in_person: 'In person', other: 'Other' };

function FeedbackLog({ report, reload, roster }: { report: TruthReport | null; reload: (fresh?: boolean) => Promise<void>; roster: RosterUser[] }) {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState('');
  const [contact, setContact] = useState('');
  const [source, setSource] = useState('whatsapp');
  const [quote, setQuote] = useState('');
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const items = report?.feedback ?? [];
  const people = [...roster].sort((a, b) => (a.name ?? '~').localeCompare(b.name ?? '~'));

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/feedback', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user: user === '__none' ? '' : user, contact: user === '__none' ? contact : '', source, quote, at: when ? new Date(when).toISOString() : '' }),
      });
      if (r.ok) {
        setQuote('');
        setContact('');
        setWhen('');
        setMsg('Saved to the database.');
        await reload();
      } else setMsg(r.status === 400 ? 'Check the fields: pick a person (or write who it was, no phone numbers) and paste what they said.' : r.status === 404 ? 'That account no longer exists.' : 'Could not save. Try again.');
    } catch {
      setMsg('Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    await fetch('/api/feedback/remove', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
    await reload();
  };

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <MessageSquareQuote style={{ width: 16, height: 16 }} />
        <span className="k-label" style={{ margin: 0 }}>Feedback log <span className="small-muted">({items.length})</span></span>
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => setOpen(!open)}>{open ? 'Close' : 'Add feedback'}</button>
      </div>
      <div className="small-muted" style={{ marginTop: 4 }}>Feedback people send on WhatsApp or say on a call only counts once it is saved here.</div>

      {open && (
        <div className="grid g3" style={{ gap: 10, marginTop: 10, alignItems: 'end' }}>
          <label className="small">Who
            <select className="select" style={{ width: '100%' }} value={user} onChange={(e) => setUser(e.target.value)} aria-label="Who said it">
              <option value="">Pick a person…</option>
              {people.map((u) => <option key={u.id} value={u.id}>{u.name ?? `usr_${u.id.slice(0, 5)}`}{u.team ? ' (team)' : ''}</option>)}
              <option value="__none">Not signed up / not listed</option>
            </select>
          </label>
          {user === '__none' ? (
            <label className="small">Who was it (no phone numbers)
              <input className="select" style={{ width: '100%' }} value={contact} maxLength={80} onChange={(e) => setContact(e.target.value)} placeholder="e.g. Karan's flatmate" />
            </label>
          ) : <div />}
          <label className="small">Where
            <select className="select" style={{ width: '100%' }} value={source} onChange={(e) => setSource(e.target.value)} aria-label="Where it was said">
              {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="small" style={{ gridColumn: 'span 2' }}>What they said
            <textarea className="select" style={{ width: '100%', minHeight: 64 }} value={quote} maxLength={4000} onChange={(e) => setQuote(e.target.value)} placeholder="Paste their message" />
          </label>
          <label className="small">When (optional)
            <input className="select" style={{ width: '100%' }} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </label>
          <div style={{ gridColumn: 'span 3', display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="btn" disabled={busy || !quote.trim() || !user || (user === '__none' && !contact.trim())} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
            {msg && <span className="small-muted">{msg}</span>}
          </div>
        </div>
      )}

      {items.length === 0 ? <div className="small-muted" style={{ marginTop: 10 }}>No feedback saved yet.</div> : (
        <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
          {items.slice(0, 50).map((f) => (
            <div key={f.id} className="mini" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ whiteSpace: 'pre-wrap' }}>“{f.quote ?? f.summary ?? ''}”</div>
                <div className="small-muted" style={{ marginTop: 4 }}>
                  {f.name ?? f.contact ?? (f.user ? `usr_${f.user.slice(0, 5)}` : 'Unknown')} · {SOURCE_LABEL[f.source] ?? f.source} · {ago(f.at)}{f.recordedBy ? ` · saved by ${f.recordedBy}` : ''}
                </div>
              </div>
              {f.source !== 'in_app' && (
                <button className="icon-btn" aria-label="Remove this feedback" title="Remove (typo fix)" onClick={() => void remove(f.id)}><Trash2 /></button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
