import { ArrowDown, ArrowUp, Download } from 'lucide-react';
import type { RetentionCell, Snapshot } from '../../server/types';
import { downloadCsv, pct, signedPct } from '../format';

export function Skel({ h = 20, w = '100%' }: { h?: number; w?: number | string }) {
  return <div className="skeleton" style={{ height: h, width: w }} />;
}

/** Green when up, red when down. Hidden when there is no earlier period to compare with. */
export function Delta({ value, suffix = '', invert = false }: { value: number | null; suffix?: string; invert?: boolean }) {
  const text = signedPct(value);
  if (text === null || value === null) return null;
  const good = invert ? value <= 0 : value >= 0;
  const Icon = value >= 0 ? ArrowUp : ArrowDown;
  return (
    <span className={`pill ${good ? 'green' : 'red'}`}>
      <Icon /> {text}{suffix}
    </span>
  );
}

export function Sparkline({ values, height = 44 }: { values: number[]; height?: number }) {
  const w = 276;
  const pts = values.length > 1 ? values : [0, ...values, 0].slice(0, 2);
  const max = Math.max(...pts, 1e-9);
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * (w - 12), height - 6 - (v / max) * (height - 14)] as const);
  // Smooth curve through points.
  let d = `M${xy[0][0]},${xy[0][1]}`;
  for (let i = 1; i < xy.length; i += 1) {
    const [x0, y0] = xy[i - 1];
    const [x1, y1] = xy[i];
    const cx = (x0 + x1) / 2;
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  const last = xy[xy.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} role="img" aria-label="Daily cost per active user">
      <path d={d} fill="none" stroke="var(--purple)" strokeWidth="2" strokeLinecap="round" />
      <circle cx={last[0] + 6} cy={last[1]} r="4" fill="var(--purple)" />
    </svg>
  );
}

export function Donut({ value }: { value: number | null }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <svg width="54" height="54" viewBox="0 0 54 54" role="img" aria-label={`${Math.round(v)} percent`}>
      <circle cx="27" cy="27" r={r} fill="none" stroke="var(--tan)" strokeWidth="5" />
      <circle cx="27" cy="27" r={r} fill="none" stroke="var(--purple)" strokeWidth="5" strokeLinecap="round"
        strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 27 27)" />
      <text x="27" y="31" textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--ink)" fontFamily="Inter">{value === null ? '–' : `${Math.round(v)}%`}</text>
    </svg>
  );
}

export function LatencyCurve({ series, slaMs }: { series: { hour: string; p95: number | null }[]; slaMs: number }) {
  const w = 440;
  const h = 46;
  const vals = series.map((s) => s.p95);
  const present = vals.filter((v): v is number => v !== null);
  const max = Math.max(slaMs * 1.15, ...present);
  const y = (v: number) => h - 4 - (v / max) * (h - 8);
  // Carry the last known value across empty hours so the line reads as a rolling curve.
  let last = present[0] ?? 0;
  const filled = vals.map((v) => (v === null ? last : (last = v)));
  const d = filled.map((v, i) => `${i ? 'L' : 'M'}${(i / (filled.length - 1)) * w},${y(v)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" role="img" aria-label="P95 latency over the last 24 hours">
      <line x1="0" x2={w} y1={y(slaMs)} y2={y(slaMs)} stroke="var(--red)" strokeDasharray="4 4" strokeOpacity="0.5" />
      {present.length > 0 && <path d={d} fill="none" stroke="var(--purple)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

function Cell({ cell, tone }: { cell: RetentionCell; tone: 'green' | 'purple' | 'auto' }) {
  if (cell.kind === 'pending') {
    return (
      <span className="cell-pill pending">
        Pending <small>· {cell.note}</small>
      </span>
    );
  }
  const cls = tone === 'auto' ? (cell.pct >= 50 ? 'green' : cell.pct >= 30 ? 'purple' : 'red') : tone;
  return (
    <span className={`cell-pill ${cls}`}>
      <b>{cell.n}/{cell.d}</b> · {pct(cell.pct)}
    </span>
  );
}

export function RetentionTable({ data, variant }: { data: Snapshot; variant: 'founder' | 'product' }) {
  const r = data.overview.retention;
  const exportCsv = () =>
    downloadCsv('keefie-retention.csv', [
      ['Cohort', 'Users', 'D1', 'D7', 'D14', 'State'],
      ...r.rows.map((row) => [row.label, row.users, ...[row.d1, row.d7, row.d14].map((c) => (c.kind === 'value' ? `${c.n}/${c.d}` : `Pending ${c.note}`)), row.state]),
    ]);
  return (
    <div className="card table-card">
      {variant === 'founder' && (
        <div className="tc-head">
          <>
            <span className="tc-title">Retention Cohort Dynamics</span>
            <span className="pill tan" style={{ fontSize: 11, letterSpacing: 0.4 }}>LIVE DATA</span>
            <span className="tc-help">Weekly signup cohorts, return rate by day (N={data.people} tracked users)</span>
            <button className="btn" style={{ marginLeft: 'auto' }} onClick={exportCsv}><Download /> Export CSV</button>
          </>
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th style={{ paddingLeft: 54 }}>{variant === 'founder' ? 'Cohort week' : 'Cohort'}</th>
              <th className="c">{variant === 'founder' ? 'Started' : 'Users'}</th>
              <th className="c">{variant === 'founder' ? 'Day 1 return' : 'Day 1'}</th>
              <th className="c">{variant === 'founder' ? 'Day 7 return' : 'Day 7'}</th>
              <th className="c">{variant === 'founder' ? 'Day 14 return' : 'Day 14'}</th>
              {variant === 'founder' && <th className="c">State</th>}
            </tr>
          </thead>
          <tbody>
            {r.rows.length === 0 && (
              <tr><td colSpan={6} className="empty">No signups in this range yet.</td></tr>
            )}
            {r.rows.map((row, i) => (
              <tr key={row.start}>
                <td style={{ paddingLeft: 54 }}>
                  <span className="cohort-name">
                    {variant === 'founder' && <i style={{ opacity: 1 - (i / Math.max(r.rows.length, 1)) * 0.6 }} />}
                    {row.label}
                  </span>
                </td>
                <td className="c mono" style={{ fontWeight: 700 }}>{row.users}</td>
                <td className="c"><Cell cell={row.d1} tone="green" /></td>
                <td className="c">{variant === 'founder' ? <Cell cell={row.d7} tone="green" /> : <Plain cell={row.d7} />}</td>
                <td className="c"><Cell cell={row.d14} tone={variant === 'founder' ? 'purple' : 'auto'} /></td>
                {variant === 'founder' && (
                  <td className="c">
                    <span className={`state ${row.state === 'Settled' ? 'settled' : row.state === 'Measuring' ? 'measuring' : 'intake'}`}>{row.state}</span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {variant === 'founder' && (
        <div className="tc-foot">
          <span>
            Aggregated Cohort Average D1: <b className="g">{pct(r.avgD1)}</b> · Target baseline: &gt;{r.target}%
          </span>
          <span className="mono-cap">All calculations run in IST (UTC+5:30)</span>
        </div>
      )}
    </div>
  );
}

function Plain({ cell }: { cell: RetentionCell }) {
  if (cell.kind === 'pending') return <span className="small-muted mono">Pending</span>;
  return <span className="mono">{pct(cell.pct)}</span>;
}
