import { useState } from 'react';
import type { Filters, Snapshot } from '../../server/types';
import { Funnel } from '../components/insights';
import { SCREEN_ORDER } from '../../server/users';
import { Skel } from '../components/parts';
import { ago, humanStep, pct } from '../format';

interface Props {
  data: Snapshot | null;
  loading: boolean;
  filters: Filters;
}

const CHECKPOINTS = [
  { label: 'Meet Keefie', start: 'IntroVideo', event: 'MeetKeefie' },
  { label: 'Create their profile', start: 'OverlayVideo', event: 'ProfilePicture' },
  { label: 'Try the demo', start: 'TryKeefie', event: 'TryKeefie' },
  { label: 'Log in', start: 'PhoneLogin', event: 'PhoneLogin' },
  { label: 'Permissions', start: 'NotificationPermission', event: 'Permissions' },
  { label: 'Reach Home', start: 'Home', event: 'Home' },
];

function checkpointFor(screen: string | null) {
  const index = screen ? SCREEN_ORDER.indexOf(screen) : -1;
  return CHECKPOINTS.filter((step) => SCREEN_ORDER.indexOf(step.start) <= index).length - 1;
}

export function ProductPage({ data }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  if (!data) return <ProductSkeleton />;

  const ob = data.overview.onboarding;
  const now = Date.parse(data.generatedAt);
  const followUps = (data.roster ?? []).filter((user) => !user.returning && !user.journey.setupAt)
    .map((user) => {
      const screen = user.journey.lastScreen;
      const due = now - Date.parse(user.journey.firstOpen) >= 86_400_000;
      return { user, screen, due, checkpoint: checkpointFor(screen) };
    })
    .filter(({ checkpoint }) => selected === null || checkpoint === selected)
    .sort((a, b) => Number(Boolean(b.screen && b.due)) - Number(Boolean(a.screen && a.due)) ||
      a.user.journey.firstOpen.localeCompare(b.user.journey.firstOpen));
  const biggestStop = data.funnel.reduce<Snapshot['funnel'][number] | undefined>((top, step) =>
    !step.permission && step.stoppedHere > (top?.stoppedHere ?? 0) ? step : top, undefined);

  return (
    <>
      <h1>Onboarding</h1>
      <p className="sub">See where setup stalls and who needs help.</p>

      <section className="section">
        <div className="section-label">Six setup checkpoints</div>
        <div className="grid g3">
          {CHECKPOINTS.map((checkpoint, index) => {
            const step = data.funnel.find((row) => row.screen === checkpoint.event);
            return (
              <button key={checkpoint.event} type="button" className="card onboarding-checkpoint"
                aria-pressed={selected === index} onClick={() => setSelected(selected === index ? null : index)}>
                <span className="card-label">{index + 1}. {checkpoint.label}</span>
                <span className="value-row"><strong className="big-36">{pct(step?.pctOfStart ?? null, 0)}</strong><span className="checkpoint-count">{step?.reached ?? '–'} reached</span></span>
                <span className="note">Of users who started onboarding</span>
              </button>
            );
          })}
        </div>
        {biggestStop && <p className="section-help onboarding-friction"><strong>Most common last screen</strong> · {biggestStop.label} · {biggestStop.stoppedHere} {biggestStop.stoppedHere === 1 ? 'person' : 'people'}</p>}
      </section>

      <section className="section">
        <details open>
          <summary className="section-label onboarding-disclosure">Screen and permission details</summary>
          <Funnel data={data} />
        </details>
      </section>

      <section className="section">
        <div className="card strip">
          <span>New accounts that got a first reply</span>
          <strong className="right">{ob.completed} / {ob.total} · {pct(ob.pct)}</strong>
        </div>
      </section>

      <section className="section">
        <div className="section-label">Who needs a follow-up</div>
        <p className="section-help">New accounts with setup still open. Installs without a linked account appear in the funnel.</p>
        <div className="card table-card">
          <div className="tc-head">
            <span className="tc-title">{selected === null ? 'All checkpoints' : CHECKPOINTS[selected].label}</span>
            {selected !== null && <button className="btn" onClick={() => setSelected(null)}>Clear filter</button>}
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>User</th><th>Last screen</th><th>Last active</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {followUps.length === 0 && <tr><td colSpan={5} className="empty">No matching accounts.</td></tr>}
                {followUps.map(({ user, screen, due }) => (
                  <tr key={user.id}>
                    <td><strong>{user.name || `Unnamed (…${user.id.slice(-5)})`}</strong></td>
                    <td>{screen ? humanStep(screen) : 'Unknown'}</td>
                    <td>{user.lastActive ? ago(user.lastActive) : 'Unknown'}</td>
                    <td><span className={`pill ${screen && due ? 'red' : 'tan'}`}>{!screen ? 'Unknown' : due ? 'Needs follow-up' : 'In progress'}</span></td>
                    <td><a className="link" href={`/users?${new URLSearchParams({ ...data.filters, user: user.id })}`}>View user →</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}

function ProductSkeleton() {
  return (
    <>
      <Skel h={40} w={260} />
      <div style={{ marginTop: 40 }}><Skel h={300} /></div>
      <div style={{ marginTop: 24 }}><Skel h={140} /></div>
    </>
  );
}
