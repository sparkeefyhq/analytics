import type { Filters, Snapshot } from '../../server/types';
import { Funnel } from '../components/insights';
import { Delta, RetentionTable, Skel } from '../components/parts';
import { dec, humanStep, int, pct, usd } from '../format';
import { acceptance, acceptanceColor } from './Overview';

interface Props {
  data: Snapshot | null;
  loading: boolean;
  filters: Filters;
}

/** Screen 2: Product Overview (Figma 14223-28732), with onboarding drop-off underneath. */
export function ProductPage({ data }: Props) {
  if (!data) return <ProductSkeleton />;
  const o = data.overview;
  const ob = o.onboarding;
  const maxDrop = Math.max(1, ...ob.dropSteps.map((d) => d.count));

  return (
    <>
      <h1>Product Overview</h1>
      <p className="sub">Product health and user engagement at a glance.</p>

      <section className="section">
        <div className="section-label">Product engagement</div>
        <div className="grid g3">
          <div className="card" style={{ minHeight: 150 }}>
            <div className="card-label">Daily active users</div>
            <div className="value-row">
              <span className="big">{int(o.dau.value)}</span>
              <Delta value={o.dau.deltaPct} suffix=" vs previous period" />
            </div>
            <div className="note" style={{ fontSize: 13 }}>Trailing 24 hours active unique users</div>
          </div>
          <div className="card">
            <div className="card-label">Weekly active users</div>
            <div className="value-row">
              <span className="big">{int(o.wau.value)}</span>
              <span className="note-13">{pct(o.wau.pctOfMau, 0)} of MAU</span>
            </div>
            <div className="note" style={{ fontSize: 13 }}>Trailing 7 consecutive days</div>
          </div>
          <div className="card">
            <div className="card-label">Monthly active users</div>
            <div className="value-row">
              <span className="big">{int(o.mau.value)}</span>
              <span className="mono note-13">DAU/MAU: {pct(o.mau.dauOverMau)}</span>
            </div>
            <div className="note" style={{ fontSize: 13 }}>30-day cohort active user base</div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-label">Product health &amp; friction</div>
        <div className="grid g-1-1">
          <div className="card">
            <div className="card-label" style={{ color: 'var(--ink)', fontSize: 12 }}>
              Onboarding completion
              <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400, color: 'var(--muted)', fontSize: 12 }}>Benchmark: {pct(ob.benchmark)}</span>
            </div>
            <div className="big-36" style={{ marginTop: 22 }}>{pct(ob.pct)}</div>
            <div className="bar" style={{ marginTop: 22 }}><i style={{ width: `${ob.pct ?? 0}%` }} /></div>
            <div className="divider" />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 500 }}>{ob.completed} / {ob.total} completed</span>
              <span className="pill red" style={{ fontWeight: 500 }}>{ob.dropped} incomplete</span>
            </div>
          </div>
          <div className="card">
            <div className="card-label" style={{ color: 'var(--ink)', fontSize: 12 }}>
              Overlay reply-use rate
              <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, fontSize: 12, color: acceptanceColor(o.replyUse.pct) }}>
                {acceptance(o.replyUse.pct).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
              </span>
            </div>
            <div className="big-36" style={{ marginTop: 22 }}>{pct(o.replyUse.pct)}</div>
            <div className="bar" style={{ marginTop: 22 }}><i style={{ width: `${o.replyUse.pct ?? 0}%` }} /></div>
            <div className="divider" />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{o.replyUse.used} / {o.replyUse.total} replies used</span>
              <span className="pill red" style={{ fontWeight: 500 }}>{o.replyUse.notUsed} not used or regenerated</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <Funnel data={data} />
      </section>

      <section className="section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
          <span className="tc-title" style={{ fontSize: 20 }}>Retention &amp; Cohort Dynamics</span>
          <span className="tc-help">Weekly retention matrix (N={data.people} tracked users)</span>
        </div>
        <RetentionTable data={data} variant="product" />
      </section>

      <section className="section">
        <div className="section-label">Operational efficiency</div>
        <div className="grid g3">
          <div className="card">
            <div className="note-13">Cost per Active User</div>
            <div className="mono" style={{ fontSize: 24, fontWeight: 700, marginTop: 14 }}>{usd(o.cost.perActiveUser)}</div>
            <div className="note">{data.rangeLabel === 'All time' ? 'All time' : `Trailing ${data.rangeLabel.replace('Last ', '')}`}</div>
          </div>
          <div className="card">
            <div className="note-13">Gross Margin</div>
            <div className="mono" style={{ fontSize: 24, fontWeight: 700, marginTop: 14, color: o.cost.grossMarginPct === null ? 'var(--muted)' : 'var(--green)' }}>
              {o.cost.grossMarginPct === null ? 'Pre-revenue' : pct(o.cost.grossMarginPct)}
            </div>
            <div className="note">{o.cost.infraUsd > 0 ? 'Model & infra blended' : 'Model cost only'}</div>
          </div>
          <div className="card">
            <div className="note-13">Avg. Overlay Frequency</div>
            <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span className="mono" style={{ fontSize: 24, fontWeight: 700, color: 'var(--purple)' }}>{dec(o.overlayFrequency.value)}</span>
              <span className="note-13">sessions / day</span>
            </div>
            <div className="note">{o.overlayFrequency.value !== null && o.overlayFrequency.value >= 3 ? 'Habitual usage' : 'Per active overlay user'}</div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-label">Where new accounts stop</div>
        <p className="section-help">Accounts created in this range that have not had a first reply yet, by the last onboarding screen we saw.</p>
        <div className="card table-card">
          <table>
            <thead>
              <tr>
                <th style={{ paddingLeft: 24 }}>Last screen seen</th>
                <th className="c">Accounts</th>
                <th>Share of drop-offs</th>
              </tr>
            </thead>
            <tbody>
              {ob.dropSteps.length === 0 && <tr><td colSpan={3} className="empty">No drop-offs in this range.</td></tr>}
              {ob.dropSteps.map((d) => (
                <tr key={d.step || 'unknown'}>
                  <td style={{ paddingLeft: 24, fontWeight: 500 }}>{d.step ? humanStep(d.step) : <span style={{ color: 'var(--muted)' }}>Not recorded (older app build)</span>}</td>
                  <td className="c mono" style={{ fontWeight: 700 }}>{d.count}</td>
                  <td style={{ width: '45%' }}>
                    <div className="share">
                      <div className="bar"><i style={{ width: `${(d.count / maxDrop) * 100}%`, background: d.step ? 'var(--purple)' : 'var(--purple-3)' }} /></div>
                      <em>{pct((d.count / Math.max(ob.dropped, 1)) * 100, 0)}</em>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function ProductSkeleton() {
  return (
    <>
      <Skel h={40} w={260} />
      <div className="grid g3" style={{ marginTop: 40 }}>{[0, 1, 2].map((i) => <Skel key={i} h={150} />)}</div>
      <div className="grid g-1-1" style={{ marginTop: 40 }}>{[0, 1].map((i) => <Skel key={i} h={185} />)}</div>
      <div style={{ marginTop: 40 }}><Skel h={240} /></div>
    </>
  );
}
