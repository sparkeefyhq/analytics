import { CheckCircle2, CircleDashed, XCircle } from 'lucide-react';
import type { Snapshot } from '../../server/types';
import { int, pct } from '../format';

/** Onboarding funnel: everyone who reached each screen, in app order (BENCHMARK: "reached and completed by screen and permission"). */
export function Funnel({ data }: { data: Snapshot }) {
  const f = data.funnel;
  const start = f[0]?.reached ?? 0;
  const worst = f.filter((s) => !s.permission && s.stoppedHere > 0).sort((a, b) => b.stoppedHere - a.stoppedHere)[0];
  return (
    <div className="card table-card">
      <div className="tc-head">
        <span className="tc-title">Onboarding funnel</span>
        <span className="tc-help">
          {start ? `${int(start)} started onboarding in this range${worst ? ` · biggest stop: ${worst.label} (${worst.stoppedHere})` : ''}` : 'No one started onboarding in this range.'}
          {data.funnelPartial ? ` · ${int(data.funnelPartial)} more seen only part-way (the phone's anonymous id changed), not counted` : ''}
        </span>
      </div>
      {f.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th style={{ paddingLeft: 24 }}>Screen</th>
                <th className="c">Reached</th>
                <th style={{ width: '38%' }}>Of everyone who started</th>
                <th className="c">From previous</th>
                <th className="c">Stopped here</th>
              </tr>
            </thead>
            <tbody>
              {f.map((s) => (
                <tr key={s.screen} className={s.permission ? 'perm-row' : ''}>
                  <td style={{ paddingLeft: s.permission ? 44 : 24, fontWeight: s.permission ? 400 : 500 }}>
                    {s.permission ? <span className="small-muted">↳ </span> : null}
                    {s.label}
                  </td>
                  <td className="c mono" style={{ fontWeight: 700 }}>{s.reached}</td>
                  <td>
                    <div className="share">
                      <div className="bar"><i style={{ width: `${s.pctOfStart ?? 0}%`, background: s.permission ? 'var(--purple-3)' : 'var(--purple)' }} /></div>
                      <em>{pct(s.pctOfStart, 0)}</em>
                    </div>
                  </td>
                  <td className={`c mono ${s.pctOfPrev !== null && s.pctOfPrev < 80 ? 'red-t' : ''}`}>{pct(s.pctOfPrev, 0)}</td>
                  <td className="c mono">{s.stoppedHere ? <span className="pill red">{s.stoppedHere}</span> : <span className="small-muted">0</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="tc-foot">
        <span>Indented rows are permissions turned on (compared with the Permissions screen). Includes installs that never signed in.</span>
        <span className="mono-cap">Live · PostHog onboarding events</span>
      </div>
    </div>
  );
}

/** Phase 1 scorecard: the four minimum gates to expand from 20 to 50, plus dashboard diagnostics. */
export function Scorecard({ data }: { data: Snapshot }) {
  const s = data.scorecard;
  const allPass = s.gates.every((g) => g.pass === true);
  return (
    <section className="section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <span className="tc-title" style={{ fontSize: 20 }}>Phase 1 scorecard</span>
        <span className="tc-help">
          {s.cohort} new {s.cohort === 1 ? 'account' : 'accounts'} since launch · {allPass ? 'all four gates pass: recheck safety, reliability and tracking, then invite 30' : 'expand 20 → 50 when all four gates pass'}
        </span>
      </div>
      <div className="grid g4">
        {s.gates.map((g) => (
          <div key={g.key} className={`card gate ${g.pass === true ? 'ok' : g.pass === false ? 'miss' : ''}`}>
            <div className="card-label">
              {g.label}
              {g.pass === true ? <CheckCircle2 className="gi g" /> : g.pass === false ? <XCircle className="gi r" /> : <CircleDashed className="gi" />}
            </div>
            <div className="value-row" style={{ marginTop: 14 }}>
              <span className="big" style={{ fontSize: 34, lineHeight: '36px' }}>{g.n}<span className="unit" style={{ fontSize: 18 }}> / {g.d}</span></span>
              <span className="note-13">{pct(g.pct, 0)}</span>
            </div>
            <div className="bar" style={{ marginTop: 14, position: 'relative' }}>
              <i style={{ width: `${Math.min(100, g.pct ?? 0)}%`, background: g.pass === false ? 'var(--red)' : undefined }} />
              <b className="target-mark" style={{ left: `${g.targetPct}%` }} title={`Minimum ${g.targetPct}%`} />
            </div>
            <div className="note">{g.help}. Minimum {g.targetPct}%, stretch {g.stretchPct}%{g.pending ? ` · ${g.pending} pending` : ''}.</div>
          </div>
        ))}
      </div>
      <div className="card" style={{ marginTop: 20, padding: 16 }}>
        <div className="diag">
          {s.diagnostics.map((d) => (
            <div key={d.key} className="mini" title={d.help}>
              <div className="k">{d.label}</div>
              <div className="v" style={{ color: d.ok === false ? 'var(--red)' : d.ok ? 'var(--green)' : undefined }}>{d.value}</div>
              <div className="s">Target {d.target}</div>
            </div>
          ))}
        </div>
        {s.nearCap > 0 && <div className="note" style={{ marginTop: 10 }}>{s.nearCap} {s.nearCap === 1 ? 'user is' : 'users are'} at 80%+ of a free pilot allowance (100 drafts / 40 answers a month).</div>}
      </div>
    </section>
  );
}
