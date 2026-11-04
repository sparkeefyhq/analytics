export const int = (n: number | null | undefined) => (n === null || n === undefined ? '–' : Math.round(n).toLocaleString('en-US'));
export const pct = (n: number | null | undefined, digits = 1) => (n === null || n === undefined ? '–' : `${n.toFixed(digits)}%`);
export const signedPct = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined ? null : `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
export const dec = (n: number | null | undefined, digits = 1) => (n === null || n === undefined ? '–' : n.toFixed(digits));
export function usd(n: number | null | undefined) {
  if (n === null || n === undefined) return '–';
  if (n === 0) return '$0.00';
  if (Math.abs(n) < 0.01) return `$${n.toFixed(4)}`;
  if (Math.abs(n) < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}
export const secs = (ms: number | null | undefined) => (ms === null || ms === undefined ? '–' : `${(ms / 1000).toFixed(2)}s`);

export function ago(iso: string, now = Date.now()) {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'Yesterday' : `${d} days ago`;
}

/** Turns a screen id like "AccessibilityPermission" or "notification_permission" into words. */
export function humanStep(step: string | null) {
  if (!step) return null;
  return step
    .replace(/_screen_viewed$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\bScreen\b/i, '')
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function downloadCsv(name: string, rows: (string | number | null)[][]) {
  const text = rows
    .map((r) => r.map((v) => (v === null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v))).join(','))
    .join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
