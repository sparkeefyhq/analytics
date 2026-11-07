import { CircleArrowRight, CreditCard, Zap } from 'lucide-react';
import type { Filters, Snapshot } from '../../server/types';
import { Scorecard } from '../components/insights';
import { Delta, Donut, RetentionTable, Skel, Sparkline } from '../components/parts';
import { dec, humanStep, int, pct, usd } from '../format';

interface Props {
  data: Snapshot | null;
  loading: boolean;
  filters: Filters;
}

/** Screen 1: Founder & Investor Summary (Figma 14223-28386). */
export function OverviewPage({ data }: Props) {
  if (!data) return <OverviewSkeleton />;
  const o = data.overview;
  const surfaceNote = data.filters.surface === 'combined' ? '' : data.filters.surface === 'overlay' ? ' · overlay only' : ' · in-app only';
  const audienceNote = data.filters.audience === 'internal' ? 'TEAM ACCOUNTS ONLY' : `${data.latestVersion ? `V${data.latestVersion}` : ''} PRODUCTION COHORT`;
  const costOk = o.cost.perActiveUser !== null && o.cost.perActiveUser <= o.cost.target;
  const dropText =
    o.onboarding.total === 0
      ? 'No signups in this range'
      : o.onboarding.dropped === 0
        ? 'Every new account reached a first reply'
        : `${o.onboarding.dropped} without a first reply${o.onboarding.topDropStep ? ` · most stop at ${humanStep(o.onboarding.topDropStep)} (${o.onboarding.dropSteps.find((d) => d.step === o.onboarding.topDropStep)?.count ?? 0})` : ''}`;

  return (
    <>
      <div className="eyebrow">
        <span className="badge-purple">Founder Telemetry</span>
        <span className="muted-cap">{audienceNote}</span>
      </div>
      <h1>Investor</h1>
      <p className="sub">Pilot progress and product usage{surfaceNote}</p>

      <section className="section" aria-label="User activity">
        <h2 className="section-label">User activity</h2>
        <div className="grid g4">
          <div className="card">
            <div className="card-label">Daily Active Users (DAU) <span className="sdot" style={{ background: 'var(--green)' }} /></div>
            <div className="value-row">
              <span className="big">{int(o.dau.value)}</span>
              <Delta value={o.dau.deltaPct} />
            </div>
            <div className="note" title="People can appear in both breakdown counts. The headline counts each person once." style={{ fontSize: 13, color: 'var(--ink)', opacity: 0.8 }}>
              Overlay: {o.dau.overlay} · In-app: {o.dau.app}
            </div>
            <div className="small-muted" style={{ marginTop: 2 }}>Unique users in the last 24 hours</div>
          </div>
          <div className="card">
            <div className="card-label">Weekly Active Users (WAU) <span className="sdot" style={{ background: '#e4d6c2' }} /></div>
            <div className="value-row">
              <span className="big">{int(o.wau.value)}</span>
              {o.wau.pctOfMau != null && <span className="pill purple" title="Weekly active users as a share of monthly active users">{pct(o.wau.pctOfMau, 0)} of MAU</span>}
            </div>
            <div className="note" style={{ fontSize: 13 }}>Unique users in the last 7 days</div>
          </div>
          <div className="card">
            <div className="card-label">Monthly Active Users (MAU) <span className="sdot" style={{ background: '#e4d6c2' }} /></div>
            <div className="value-row">
              <span className="big">{int(o.mau.value)}</span>
              {o.mau.dauOverMau != null && <span className="pill tan mono" title="Daily active users as a share of monthly active users">DAU/MAU {pct(o.mau.dauOverMau)}</span>}
            </div>
            <div className="note" style={{ fontSize: 13 }}>Unique users in the last 30 days</div>
          </div>
          <div className="card">
            <div className="card-label">Overlay sessions per active user <span className="sdot" style={{ background: 'var(--purple)' }} /></div>
            <div className="value-row" style={{ gap: 6 }}>
              <span className="big purple">{dec(o.overlayFrequency.value)}</span>
              <span className="unit">/ day</span>
            </div>
            <div className="note" style={{ fontSize: 13 }}>
              {o.overlayFrequency.value === null ? 'No overlay sessions in this range' : 'Daily average'}
              {o.overlayFrequency.deltaPct !== null && <> · <Delta value={o.overlayFrequency.deltaPct} /></>}
            </div>
          </div>
        </div>
      </section>

      <Scorecard data={data} />

      <div style={{ marginTop: 32 }}>
        <RetentionTable data={data} variant="founder" />
      </div>
      <details className="section">
        <summary className="section-label onboarding-disclosure">Cost and reply details</summary>
      <div className="grid g3" style={{ marginTop: 12 }}>
        <div className="card rich" data-benchmark={o.cost.perActiveUser === null ? undefined : costOk}>
          <div className="rc-head">
            <span className="rc-icon"><CreditCard /></span>
            <div>
              <div className="rc-title">Cost per active user</div>
              <div className="rc-sub">{o.cost.infraUsd > 0 ? 'Blended Infra & Model' : 'Model cost (overlay + in-app)'}</div>
            </div>
            <span className="tag-tan">{data.rangeLabel}</span>
          </div>
          <div className="value-row" style={{ marginTop: 20 }}>
            <span className="big-36">{usd(o.cost.perActiveUser)}</span>
            {o.cost.grossMarginPct !== null ? (
              <span className="pill green">{pct(o.cost.grossMarginPct)} gross margin</span>
            ) : (
              <span className="pill tan">Pre-revenue</span>
            )}
          </div>
          <div style={{ marginTop: 14 }}><Sparkline values={o.cost.series} /></div>
          <div className="foot">
            <div className="divider" />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span className="note-13">Target threshold ≤ {usd(o.cost.target)} / MAU</span>
              <span className="mono" style={{ fontSize: 12, color: costOk ? 'var(--green)' : 'var(--red)' }}>{o.cost.perActiveUser === null ? '–' : costOk ? 'Optimal' : 'Over target'}</span>
            </div>
            {o.cost.estimated && <div className="small-muted" style={{ marginTop: 6 }}>Overlay drafts before 1 Nov valued at the tracked average.</div>}
          </div>
        </div>

        <div className="card rich" data-benchmark={o.onboarding.pct === null ? undefined : o.onboarding.pct >= o.onboarding.benchmark}>
          <div className="rc-head">
            <span className="rc-icon"><CircleArrowRight /></span>
            <div>
              <div className="rc-title">New accounts with a first reply</div>
              <div className="rc-sub">First Launch to First Reply</div>
            </div>
            <span className="tag-purple">{o.onboarding.completed} / {o.onboarding.total} Completed</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 20 }}>
            <div>
              <div className="big-36">{pct(o.onboarding.pct)}</div>

            </div>
            <Donut value={o.onboarding.pct} />
            <span className="benchmark-edge">Target {pct(o.onboarding.benchmark)}</span>
          </div>
          <div className="foot">
            <div className="divider" />
            <span className="note-13">{dropText}</span>
          </div>
        </div>

        <div className="card rich">
          <div className="rc-head">
            <span className="rc-icon"><Zap /></span>
            <div>
              <div className="rc-title">Overlay reply-use rate</div>
              <div className="rc-sub">Recorded draft actions</div>
            </div>
            <span className="tag-green">{o.replyUse.used} / {o.replyUse.total} Replies</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 20, gap: 8 }}>
            <span className="big-36">{pct(o.replyUse.pct)}</span>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: acceptanceColor(o.replyUse.pct) }}>{acceptance(o.replyUse.pct)}</span>
          </div>
          <div className="bar tan" style={{ marginTop: 12 }}><i style={{ width: `${o.replyUse.pct ?? 0}%` }} /></div>
          <div className="foot">
            <div className="divider" />
            <span className="note-13">{o.replyUse.notUsed} not used or regenerated</span>
          </div>
        </div>
      </div>

      </details>
    </>
  );
}

export const acceptance = (p: number | null) => (p === null ? '' : p >= 65 ? 'HIGH ACCEPTANCE' : p >= 40 ? 'MODERATE ACCEPTANCE' : 'LOW ACCEPTANCE');
export const acceptanceColor = (p: number | null) => (p === null ? 'var(--muted)' : p >= 65 ? 'var(--green)' : p >= 40 ? 'var(--purple)' : 'var(--red)');

function OverviewSkeleton() {
  return (
    <>
      <Skel h={22} w={260} />
      <div style={{ height: 12 }} />
      <Skel h={40} w={220} />
      <div className="grid g4" style={{ marginTop: 40 }}>{[0, 1, 2, 3].map((i) => <Skel key={i} h={170} />)}</div>
      <div className="grid g3" style={{ marginTop: 32 }}>{[0, 1, 2].map((i) => <Skel key={i} h={240} />)}</div>
      <div style={{ marginTop: 32 }}><Skel h={320} /></div>
    </>
  );
}
