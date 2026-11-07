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
          {start ? `${int(start)} started onboarding in this range${worst ? ` · most last seen at: ${worst.label} (${worst.stoppedHere})` : ''}` : 'No one started onboarding in this range.'}
          {data.funnelPartial ? ` · ${int(data.funnelPartial)} seen mid-flow only, excluded from starts` : ''}
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
                  <td className="c mono">{s.permission || s.screen === 'Home' || !s.reached ? '–' : <span className={s.stoppedHere ? 'pill red' : 'small-muted'}>{s.stoppedHere} · {pct(100 * s.stoppedHere / s.reached, 0)}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="tc-foot">
        <span>Indented rows are permissions turned on (compared with the Permissions screen). Includes installs that never signed in. “Stopped here” counts users last seen on this screen who have yet to reach Home, as a share of users who reached the screen.</span>
        <span className="mono-cap">Source: PostHog onboarding events</span>
      </div>
    </div>
  );
}

/** Phase 1 scorecard: the four minimum gates to expand from 20 to 50, plus dashboard diagnostics. */
export function Scorecard({ data }: { data: Snapshot }) {
  const s = data.scorecard;
  const passed = s.gates.filter((g) => g.pass === true).length;
  const allPass = s.gates.length > 0 && passed === s.gates.length;
  return (
    <section className="section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <span className="tc-title" style={{ fontSize: 20 }}>Phase 1 scorecard</span>
        <span className="tc-help">
          {s.cohort} new {s.cohort === 1 ? 'account' : 'accounts'} since launch · {passed} of {s.gates.length} gates met
        </span>
      </div>
      <div className="grid g4">
        {s.gates.map((g) => (
          <div key={g.key} className={`card gate ${g.pass === true ? 'ok' : g.pass === false ? 'miss' : ''}`}>
            <div className="card-label">
              {g.key === 'useful' ? 'First draft action within 48h' : g.label}
              {g.pass === true ? <CheckCircle2 className="gi g" /> : g.pass === false ? <XCircle className="gi r" /> : <CircleDashed className="gi" />}
            </div>
            <div className="value-row benchmark-row" style={{ marginTop: 14 }}>
              <span className="big" style={{ fontSize: 34, lineHeight: '36px' }}>{g.n}<span className="unit" style={{ fontSize: 18 }}> / {g.d}</span></span>
              <span className="benchmark-edge">{g.pct === null ? '—' : pct(g.pct, 0)} · Target {g.targetPct}%</span>
            </div>
            <div className="bar" style={{ marginTop: 14, position: 'relative' }}>
              <i style={{ width: `${Math.min(100, g.pct ?? 0)}%`, background: g.pass === false ? 'var(--red)' : undefined }} />
              <b className="target-mark" style={{ left: `${g.targetPct}%` }} title={`Minimum ${g.targetPct}%`} />
            </div>
            <div className="note">{g.help}{g.pending ? ` · ${g.pending} pending` : ''}</div>
          </div>
        ))}
      </div>
      <p className="note">{allPass ? 'Before inviting the next 30, recheck safety, reliability and tracking.' : 'Move from 20 to 50 after all four gates pass.'}</p>
      <details className="card" style={{ marginTop: 20, padding: 16 }}>
        <summary className="section-label onboarding-disclosure">Pilot diagnostics</summary>
        <div className="diag">
          {s.diagnostics.map((d) => (
            <div key={d.key} className="mini" data-benchmark={d.ok ?? undefined} title={d.help}>
              <div className="k">{d.label}</div>
              <div className="benchmark-row"><span className="v">{d.value}</span><span className="benchmark-edge">{d.target}</span></div>
            </div>
          ))}
        </div>
        {s.nearCap > 0 && <div className="note" style={{ marginTop: 10 }}>{s.nearCap} {s.nearCap === 1 ? 'user is' : 'users are'} at 80%+ of a free pilot allowance (100 drafts / 40 answers a month).</div>}
      </details>
    </section>
  );
}
