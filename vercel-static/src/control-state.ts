type TrackerLike = { phases: { checks: { id: string; completed: boolean }[] }[] };
type Patch = Record<string, unknown>;

// Serial writes prevent an older response from overwriting a newer click.
// Pending checks remain visible while each response is reconciled.
export function createTrackerQueue<T extends TrackerLike>(publish: (value: T) => void, status: (value: string) => void) {
  let confirmed: T | null = null;
  let tail: Promise<void> = Promise.resolve();
  let sequence = 0;
  const pending = new Map<number, { action: string; patch?: Patch; id?: string }>();
  const render = () => {
    if (!confirmed) return;
    const checks = new Map<string, boolean>();
    for (const item of pending.values()) {
      if (item.action === "check" && item.id) checks.set(item.id, Boolean(item.patch?.completed));
    }
    publish({ ...confirmed, phases: confirmed.phases.map(phase => ({ ...phase, checks: phase.checks.map(check => checks.has(check.id) ? { ...check, completed: checks.get(check.id)! } : check) })) });
  };
  return {
    hydrate(value: T) { confirmed = value; render(); },
    enqueue(action: string, patch: Patch | undefined, id: string | undefined, send: () => Promise<T>) {
      const key = ++sequence;
      pending.set(key, { action, patch, id });
      render();
      status("Saving…");
      const task = tail.then(async () => {
        try {
          confirmed = await send();
          pending.delete(key);
          render();
          status(pending.size ? "Saving…" : "Saved");
        } catch (error) {
          pending.delete(key);
          render();
          status("Not saved");
          throw error;
        }
      });
      tail = task.catch(() => {});
      return task;
    },
  };
}

export function countdown(startedAt: string | null | undefined, durationMs: number, now: number) {
  const start = startedAt ? Date.parse(startedAt) : NaN;
  const elapsed = Number.isFinite(start) ? Math.max(0, now - start) : 0;
  const remaining = durationMs - elapsed;
  const overdue = remaining < 0;
  const seconds = overdue ? Math.floor(-remaining / 1000) : Math.ceil(remaining / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  const long = elapsed > 4 * 86400000 || seconds > 4 * 86400;
  const display = long ? `${Math.floor(hours / 24)}d ${pad(hours % 24)}h ${pad(minutes)}m` : `${pad(hours)}:${pad(minutes)}:${pad(seconds % 60)}`;
  return { display: `${overdue ? "+" : ""}${display}`, label: overdue ? "Overdue" : "Remaining", overdue };
}
