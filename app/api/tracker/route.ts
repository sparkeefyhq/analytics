import { env } from 'cloudflare:workers';
import type { TrackerCheck, TrackerData, TrackerMetric, TrackerPhase } from '@/lib/tracker-types';
import { metricPassed } from '@/lib/tracker-types';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const EDITOR_EMAIL = 'sarthakverma0802@gmail.com';

type SeedMetric = [string, number, string?, ('gte' | 'lte' | 'eq')?];

const phaseSeeds = [
  {
    id: 'phase-0', position: 0, name: 'Power-user release candidate',
    objective: 'Prove the complete Android journey works and Wingman delivers trustworthy value.',
    userMin: 10, userMax: 15, durationMin: 3, durationMax: 5, status: 'active',
    features: ['Wingman V3', 'Analytics verified', 'Essential notifications only', 'Spark Meter hidden'],
    metrics: [
      ['Onboarding completion', 80], ['Activation', 70], ['D1 meaningful retention', 40],
      ['Returned on another day', 40], ['First-answer usefulness', 75], ['Successful AI responses', 98],
      ['Crash-free sessions', 99], ['Context leakage incidents', 0, 'count', 'eq'],
    ] as SeedMetric[],
    checks: ['Full Android journey tested end-to-end', 'No critical privacy or safety failures', 'All release-blocking bugs fixed'],
  },
  {
    id: 'phase-1', position: 1, name: 'Organic Wingman baseline',
    objective: 'Learn whether users return to Wingman naturally, without proactive retention nudges.',
    userMin: 30, userMax: 30, durationMin: 7, durationMax: 7, status: 'locked',
    features: ['Wingman V3', 'Person-specific memory', 'No proactive notifications', 'Spark Meter hidden'],
    metrics: [
      ['Onboarding completion', 80], ['Activation', 70], ['D1 meaningful retention', 40],
      ['D7 exact meaningful retention', 20], ['W1 meaningful retention', 45],
      ['Second-situation rate', 30], ['First-answer usefulness', 75], ['Memory correctness', 90],
    ] as SeedMetric[],
    checks: ['At least 8 user interviews completed', 'No founder reminders counted as organic return', 'No critical trust, privacy or safety failures'],
  },
  {
    id: 'phase-2', position: 2, name: 'Notification MVP',
    objective: 'Prove that contextual follow-ups create meaningful usage without masking weak organic pull.',
    userMin: 70, userMax: 70, durationMin: 14, durationMax: 14, status: 'locked',
    features: ['Wingman V3', 'Consent-based follow-ups', 'Notification holdout group', 'Spark Meter hidden'],
    metrics: [
      ['Activation', 70], ['D1 meaningful retention', 40], ['D7 exact meaningful retention', 20],
      ['Control W1 retention', 40], ['Overall W1 retention', 45], ['W2 meaningful retention', 35],
      ['Second-situation rate', 35], ['3+ active days in 14 days', 25],
      ['Notification → meaningful session', 30], ['Retention lift vs control', 8, 'pp'],
      ['Notification disable rate', 5, '%', 'lte'], ['Negative notification feedback', 5, '%', 'lte'],
    ] as SeedMetric[],
    checks: ['Eligible users split into control and notification groups', 'Notifications reveal no sensitive lock-screen context', 'Every notification deep-links to the relevant situation'],
  },
  {
    id: 'phase-3', position: 3, name: 'Spark Meter beta',
    objective: 'Test whether Spark Meter turns reactive Wingman usage into an ongoing relationship loop.',
    userMin: 150, userMax: 150, durationMin: 21, durationMax: 21, status: 'locked',
    features: ['Spark Meter beta for 50–75 eligible users', 'Weekly Spark Plan', 'Proven contextual notifications', 'Matched holdout group'],
    metrics: [
      ['Activation', 70], ['D1 meaningful retention', 40], ['D7 exact meaningful retention', 20],
      ['W1 meaningful retention', 45], ['W2 meaningful retention', 35], ['W3 meaningful retention', 30],
      ['Second-situation rate', 35], ['3+ active days in 14 days', 30], ['Spark Meter view rate', 60],
      ['State comprehension', 85], ['Perceived accuracy / usefulness', 70], ['Weekly plan creation', 50],
      ['Recommended action started', 40], ['Recommended action completed', 25],
      ['Spark → Wingman session', 30], ['Retention lift vs holdout', 8, 'pp'],
      ['Negative Spark Meter feedback', 5, '%', 'lte'],
    ] as SeedMetric[],
    checks: ['Spark Meter shown only when enough context exists', 'No fake scientific relationship score shown', 'Zero harmful high-confidence relationship claims'],
  },
  {
    id: 'phase-4', position: 4, name: 'Complete Sparkeefy loop',
    objective: 'Validate the complete loop across Wingman, Memory, Spark Meter, Weekly Plan and follow-ups.',
    userMin: 250, userMax: 250, durationMin: 30, durationMax: 30, status: 'locked',
    features: ['Wingman + Memory', 'Spark Meter', 'Weekly Spark Plan', 'Contextual notifications'],
    metrics: [
      ['Onboarding completion', 80], ['Activation', 70], ['D1 meaningful retention', 40],
      ['D7 exact meaningful retention', 20], ['W1 meaningful retention', 45], ['W2 meaningful retention', 35],
      ['W4 meaningful retention', 28], ['Second-situation rate', 40], ['3+ active days in 14 days', 30],
      ['Problem-to-Wingman rate', 50], ['Organic share of repeat sessions', 60],
      ['Memory differentiation', 60], ['Very disappointed if removed', 40],
      ['Crash-free sessions', 99.5], ['Successful Wingman responses', 99],
      ['Critical context / privacy incidents', 0, 'count', 'eq'],
    ] as SeedMetric[],
    checks: ['At least 40 qualified PMF survey responses', 'Retention reviewed by acquisition source', 'No critical trust, privacy or safety failures'],
  },
  {
    id: 'phase-5', position: 5, name: 'Android soft launch',
    objective: 'Check whether product pull survives beyond founder-connected and hand-picked testers.',
    userMin: 1000, userMax: 1000, durationMin: 4, durationMax: 6, durationUnit: 'weeks', status: 'locked',
    features: ['Complete Sparkeefy loop', 'Controlled communities', 'Channel cohort tracking', 'No broad paid marketing'],
    metrics: [
      ['Onboarding completion', 75], ['Activation', 65], ['D1 meaningful retention', 35],
      ['D7 exact meaningful retention', 18], ['W1 meaningful retention', 40], ['W2 meaningful retention', 30],
      ['W4 meaningful retention', 25], ['Second-situation rate', 35], ['Problem-to-Wingman rate', 40],
      ['Organic share of repeat sessions', 60], ['Referral / invite intent', 15],
    ] as SeedMetric[],
    checks: ['Success holds across at least two acquisition channels', 'No meaningful retention decline across cohorts', 'Paid acquisition remains paused until W4 matures'],
  },
] as const;

function db() {
  if (!env.DB) throw new Error('Database binding is unavailable.');
  return env.DB;
}

async function ensureDatabase() {
  const database = db();
  await database.batch([
    database.prepare(`CREATE TABLE IF NOT EXISTS phases (
      id TEXT PRIMARY KEY, position INTEGER NOT NULL, name TEXT NOT NULL, objective TEXT NOT NULL,
      user_min INTEGER NOT NULL, user_max INTEGER NOT NULL, duration_min INTEGER NOT NULL,
      duration_max INTEGER NOT NULL, duration_unit TEXT NOT NULL DEFAULT 'days', actual_users INTEGER NOT NULL DEFAULT 0,
      elapsed_days INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'locked', features TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
    )`),
    database.prepare(`CREATE TABLE IF NOT EXISTS metrics (
      id TEXT PRIMARY KEY, phase_id TEXT NOT NULL, position INTEGER NOT NULL, category TEXT NOT NULL,
      name TEXT NOT NULL, target REAL NOT NULL, actual REAL, unit TEXT NOT NULL DEFAULT '%',
      comparator TEXT NOT NULL DEFAULT 'gte'
    )`),
    database.prepare(`CREATE TABLE IF NOT EXISTS checks (
      id TEXT PRIMARY KEY, phase_id TEXT NOT NULL, position INTEGER NOT NULL, label TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0
    )`),
    database.prepare('CREATE INDEX IF NOT EXISTS idx_metrics_phase_position ON metrics(phase_id, position)'),
    database.prepare('CREATE INDEX IF NOT EXISTS idx_checks_phase_position ON checks(phase_id, position)'),
  ]);

  const existing = await database.prepare('SELECT COUNT(*) AS count FROM phases').first<{ count: number }>();
  if ((existing?.count ?? 0) > 0) return;

  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const phase of phaseSeeds) {
    statements.push(database.prepare(`INSERT INTO phases
      (id, position, name, objective, user_min, user_max, duration_min, duration_max, duration_unit, actual_users, elapsed_days, status, features, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, '', ?)`)
      .bind(phase.id, phase.position, phase.name, phase.objective, phase.userMin, phase.userMax, phase.durationMin, phase.durationMax, 'durationUnit' in phase ? phase.durationUnit : 'days', phase.status, JSON.stringify(phase.features), now));
    phase.metrics.forEach(([name, target, unit = '%', comparator = 'gte'], index) => {
      const category = /retention|situation|active days|Problem-to|Organic share/i.test(name)
        ? 'Retention'
        : /notification/i.test(name)
          ? 'Notifications'
          : /Spark|plan|action|comprehension|accuracy/i.test(name)
            ? 'Spark Meter'
            : /crash|successful|leakage|incident/i.test(name)
              ? 'Reliability'
              : 'Activation & quality';
      statements.push(database.prepare(`INSERT INTO metrics
        (id, phase_id, position, category, name, target, actual, unit, comparator)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
        .bind(`${phase.id}-metric-${index}`, phase.id, index, category, name, target, unit, comparator));
    });
    phase.checks.forEach((label, index) => {
      statements.push(database.prepare(`INSERT INTO checks
        (id, phase_id, position, label, completed) VALUES (?, ?, ?, ?, 0)`)
        .bind(`${phase.id}-check-${index}`, phase.id, index, label));
    });
  }
  await database.batch(statements);
}

async function loadTracker(): Promise<TrackerData> {
  await ensureDatabase();
  const database = db();
  const [phaseResult, metricResult, checkResult] = await Promise.all([
    database.prepare('SELECT * FROM phases ORDER BY position').all(),
    database.prepare('SELECT * FROM metrics ORDER BY phase_id, position').all(),
    database.prepare('SELECT * FROM checks ORDER BY phase_id, position').all(),
  ]);
  const allMetrics = metricResult.results.map((row) => ({
    id: String(row.id), phaseId: String(row.phase_id), position: Number(row.position), category: String(row.category),
    name: String(row.name), target: Number(row.target), actual: row.actual === null ? null : Number(row.actual),
    unit: String(row.unit), comparator: String(row.comparator) as TrackerMetric['comparator'],
  }));
  const allChecks = checkResult.results.map((row) => ({
    id: String(row.id), phaseId: String(row.phase_id), position: Number(row.position), label: String(row.label), completed: Boolean(row.completed),
  }));
  const phases = phaseResult.results.map((row) => ({
    id: String(row.id), position: Number(row.position), name: String(row.name), objective: String(row.objective),
    userMin: Number(row.user_min), userMax: Number(row.user_max), durationMin: Number(row.duration_min), durationMax: Number(row.duration_max),
    durationUnit: String(row.duration_unit), actualUsers: Number(row.actual_users), elapsedDays: Number(row.elapsed_days),
    status: String(row.status) as TrackerPhase['status'], features: JSON.parse(String(row.features)) as string[], notes: String(row.notes),
    updatedAt: String(row.updated_at), metrics: allMetrics.filter((metric) => metric.phaseId === row.id),
    checks: allChecks.filter((item) => item.phaseId === row.id),
  }));
  return { phases };
}

function viewerEmail(request: Request) {
  return request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase() ?? null;
}

function canEdit(request: Request) {
  return viewerEmail(request) === EDITOR_EMAIL;
}

async function trackerResponse(request: Request) {
  return { ...(await loadTracker()), viewerEmail: viewerEmail(request), canEdit: canEdit(request) };
}

export async function GET(request: Request) {
  try {
    return Response.json(await trackerResponse(request));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load tracker.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!canEdit(request)) {
      return Response.json({ error: 'This account has view-only access.' }, { status: 403 });
    }
    await ensureDatabase();
    const body = await request.json() as { action: string; id?: string; phaseId?: string; patch?: Record<string, unknown> };
    const database = db();
    const now = new Date().toISOString();

    if (body.action === 'phase' && body.id && body.patch) {
      const patch = body.patch;
      await database.prepare(`UPDATE phases SET name = ?, objective = ?, user_min = ?, user_max = ?, duration_min = ?,
        duration_max = ?, duration_unit = ?, actual_users = ?, elapsed_days = ?, features = ?, notes = ?, updated_at = ? WHERE id = ?`)
        .bind(String(patch.name), String(patch.objective), Number(patch.userMin), Number(patch.userMax), Number(patch.durationMin),
          Number(patch.durationMax), String(patch.durationUnit), Number(patch.actualUsers), Number(patch.elapsedDays),
          JSON.stringify(patch.features), String(patch.notes ?? ''), now, body.id).run();
    } else if (body.action === 'metric' && body.id && body.patch) {
      const actual = body.patch.actual === null || body.patch.actual === '' ? null : Number(body.patch.actual);
      await database.prepare('UPDATE metrics SET target = ?, actual = ? WHERE id = ?')
        .bind(Number(body.patch.target), actual, body.id).run();
    } else if (body.action === 'check' && body.id && body.patch) {
      await database.prepare('UPDATE checks SET completed = ? WHERE id = ?')
        .bind(body.patch.completed ? 1 : 0, body.id).run();
    } else if (body.action === 'advance' && body.phaseId) {
      const tracker = await loadTracker();
      const phase = tracker.phases.find((item) => item.id === body.phaseId);
      if (!phase) return Response.json({ error: 'Phase not found.' }, { status: 404 });
      const ready = phase.metrics.every(metricPassed) && phase.checks.every((item: TrackerCheck) => item.completed);
      if (!ready) return Response.json({ error: 'Complete every metric and checklist gate before advancing.' }, { status: 409 });
      const next = tracker.phases.find((item) => item.position === phase.position + 1);
      const statements = [database.prepare("UPDATE phases SET status = 'complete', updated_at = ? WHERE id = ?").bind(now, phase.id)];
      if (next) statements.push(database.prepare("UPDATE phases SET status = 'active', updated_at = ? WHERE id = ?").bind(now, next.id));
      await database.batch(statements);
    } else {
      return Response.json({ error: 'Unsupported update.' }, { status: 400 });
    }

    return Response.json(await trackerResponse(request));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to save changes.' }, { status: 500 });
  }
}
