import { env } from 'cloudflare:workers';
import { EDITOR_EMAIL, trackerAccess } from '@/lib/auth';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

type Access = Awaited<ReturnType<typeof trackerAccess>>;
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

function database() {
  if (!env.DB) throw new Error('Database binding is unavailable.');
  return env.DB;
}

function indiaDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function ensureWorkspace() {
  const db = database();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS routines (
      id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, title TEXT NOT NULL, time TEXT NOT NULL,
      position INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS routine_occurrences (
      id TEXT PRIMARY KEY, routine_id TEXT NOT NULL, owner_email TEXT NOT NULL, date TEXT NOT NULL,
      title TEXT NOT NULL, time TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', note TEXT NOT NULL DEFAULT '',
      completed_at TEXT, updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_routine_occurrence_unique ON routine_occurrences(routine_id, date)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_routine_occurrence_owner_date ON routine_occurrences(owner_email, date)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS founder_tasks (
      id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      due_date TEXT, due_time TEXT, priority TEXT NOT NULL DEFAULT 'medium', category TEXT NOT NULL DEFAULT 'General',
      status TEXT NOT NULL DEFAULT 'open', link TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, completed_at TEXT, updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_founder_tasks_owner_status_due ON founder_tasks(owner_email, status, due_date)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS diary_entries (
      id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, entry_date TEXT NOT NULL, completed TEXT NOT NULL DEFAULT '',
      moved_forward TEXT NOT NULL DEFAULT '', learned TEXT NOT NULL DEFAULT '', blocker TEXT NOT NULL DEFAULT '',
      insight TEXT NOT NULL DEFAULT '', tomorrow TEXT NOT NULL DEFAULT '', mood TEXT NOT NULL DEFAULT 'Focused',
      notes TEXT NOT NULL DEFAULT '', finished_at TEXT, updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_diary_owner_date ON diary_entries(owner_email, entry_date)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS suggestions (
      id TEXT PRIMARY KEY, author_email TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Other', priority TEXT NOT NULL DEFAULT 'medium', phase_id TEXT,
      status TEXT NOT NULL DEFAULT 'new', pinned INTEGER NOT NULL DEFAULT 0, founder_priority INTEGER NOT NULL DEFAULT 0,
      founder_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_suggestions_status_created ON suggestions(status, created_at DESC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS suggestion_replies (
      id TEXT PRIMARY KEY, suggestion_id TEXT NOT NULL, author_email TEXT NOT NULL, body TEXT NOT NULL,
      parent_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_suggestion_replies_suggestion ON suggestion_replies(suggestion_id, created_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS suggestion_votes (
      suggestion_id TEXT NOT NULL, author_email TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (suggestion_id, author_email)
    )`),
  ]);

  const taskColumns = await db.prepare('PRAGMA table_info(founder_tasks)').all<{ name: string }>();
  if (!taskColumns.results.some((column) => column.name === 'deleted_at')) {
    await db.prepare('ALTER TABLE founder_tasks ADD COLUMN deleted_at TEXT').run();
  }

  const count = await db.prepare('SELECT COUNT(*) AS count FROM routines WHERE owner_email = ?').bind(EDITOR_EMAIL).first<{ count: number }>();
  if ((count?.count ?? 0) === 0) {
    const timestamp = now();
    await db.batch([
      db.prepare('INSERT INTO routines (id, owner_email, title, time, position, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)').bind('reddit-morning', EDITOR_EMAIL, 'Morning Reddit post', '10:00', 0, timestamp, timestamp),
      db.prepare('INSERT INTO routines (id, owner_email, title, time, position, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)').bind('reddit-evening', EDITOR_EMAIL, 'Evening Reddit post', '19:00', 1, timestamp, timestamp),
      db.prepare('INSERT INTO routines (id, owner_email, title, time, position, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)').bind('reddit-night', EDITOR_EMAIL, 'Night Reddit post', '22:00', 2, timestamp, timestamp),
    ]);
  }

  // Earlier builds accidentally stored this one-off item as a recurring routine.
  // Move it once, preserving its scheduled time and keeping the routine record inactive.
  const misplaced = await db.prepare("SELECT * FROM routines WHERE owner_email = ? AND lower(trim(title)) = 'plan all'")
    .bind(EDITOR_EMAIL).all<Record<string, unknown>>();
  if (misplaced.results.length) {
    const timestamp = now();
    const date = indiaDate();
    await db.batch(misplaced.results.flatMap((routine) => [
      db.prepare(`INSERT OR IGNORE INTO founder_tasks
        (id, owner_email, title, description, due_date, due_time, priority, category, status, link, position, created_at, updated_at)
        VALUES (?, ?, ?, '', ?, ?, 'medium', 'Founder', 'open', '', 0, ?, ?)`)
        .bind(`migrated-${String(routine.id)}`, EDITOR_EMAIL, String(routine.title), date, String(routine.time), timestamp, timestamp),
      db.prepare('DELETE FROM routine_occurrences WHERE routine_id = ? AND owner_email = ? AND date = ?')
        .bind(String(routine.id), EDITOR_EMAIL, date),
      db.prepare('UPDATE routines SET active = 0, updated_at = ? WHERE id = ?').bind(timestamp, String(routine.id)),
    ]));
  }
}

async function ensureToday(ownerEmail: string) {
  const db = database();
  const date = indiaDate();
  const routines = await db.prepare('SELECT * FROM routines WHERE owner_email = ? AND active = 1 ORDER BY position').bind(ownerEmail).all<Record<string, unknown>>();
  const timestamp = now();
  await db.batch(routines.results.map((routine) => db.prepare(`INSERT OR IGNORE INTO routine_occurrences
    (id, routine_id, owner_email, date, title, time, status, note, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', '', ?)`)
    .bind(`${String(routine.id)}-${date}`, String(routine.id), ownerEmail, date, String(routine.title), String(routine.time), timestamp)));
  return date;
}

function requireEditor(access: Access) {
  if (!access.canEdit) throw new Response(JSON.stringify({ error: 'Only Sarthak can access this workspace.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
}

async function founderData(access: Access) {
  requireEditor(access);
  await ensureWorkspace();
  const date = await ensureToday(EDITOR_EMAIL);
  const db = database();
  const [routines, tasks, diary, diaryHistory] = await Promise.all([
    db.prepare('SELECT * FROM routine_occurrences WHERE owner_email = ? AND date = ? ORDER BY time').bind(EDITOR_EMAIL, date).all(),
    db.prepare(`SELECT * FROM founder_tasks WHERE owner_email = ? AND deleted_at IS NULL
      ORDER BY CASE status WHEN 'complete' THEN 1 ELSE 0 END, due_date IS NULL, due_date, due_time IS NULL, due_time, position, created_at DESC`).bind(EDITOR_EMAIL).all(),
    db.prepare('SELECT * FROM diary_entries WHERE owner_email = ? AND entry_date = ?').bind(EDITOR_EMAIL, date).first(),
    db.prepare('SELECT entry_date, mood, finished_at FROM diary_entries WHERE owner_email = ? ORDER BY entry_date DESC LIMIT 14').bind(EDITOR_EMAIL).all(),
  ]);
  return { date, routines: routines.results, tasks: tasks.results, diary: diary ?? null, diaryHistory: diaryHistory.results };
}

async function suggestionData(access: Access) {
  await ensureWorkspace();
  const db = database();
  const [suggestions, replies, votes] = await Promise.all([
    db.prepare('SELECT * FROM suggestions ORDER BY pinned DESC, founder_priority DESC, created_at DESC').all(),
    db.prepare('SELECT * FROM suggestion_replies ORDER BY created_at').all(),
    db.prepare('SELECT suggestion_id, COUNT(*) AS count FROM suggestion_votes GROUP BY suggestion_id').all(),
  ]);
  return { suggestions: suggestions.results, replies: replies.results, votes: votes.results, viewerEmail: access.viewerEmail, canEdit: access.canEdit };
}

export async function GET(request: Request) {
  try {
    const access = await trackerAccess(request);
    if (!access.authenticated) return Response.json({ authenticated: false }, { status: 401 });
    const view = new URL(request.url).searchParams.get('view');
    if (view === 'sarthak') return Response.json(await founderData(access));
    if (view === 'suggestions') return Response.json(await suggestionData(access));
    return Response.json({ error: 'Unknown workspace view.' }, { status: 400 });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load workspace.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const access = await trackerAccess(request);
    if (!access.authenticated) return Response.json({ error: 'Sign in required.' }, { status: 401 });
    await ensureWorkspace();
    const body = await request.json() as { action: string; id?: string; suggestionId?: string; patch?: Record<string, unknown> };
    const db = database();
    const timestamp = now();

    if (body.action.startsWith('task_') || body.action.startsWith('routine_') || body.action.startsWith('diary_')) requireEditor(access);

    if (body.action === 'task_create') {
      const p = body.patch ?? {};
      await db.prepare(`INSERT INTO founder_tasks (id, owner_email, title, description, due_date, due_time, priority, category, status, link, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, 0, ?, ?)`)
        .bind(id('task'), EDITOR_EMAIL, String(p.title ?? '').trim(), String(p.description ?? ''), p.dueDate ? String(p.dueDate) : null, p.dueTime ? String(p.dueTime) : null, String(p.priority ?? 'medium'), String(p.category ?? 'General'), String(p.link ?? ''), timestamp, timestamp).run();
    } else if (body.action === 'task_reorder') {
      const order = Array.isArray(body.patch?.order) ? body.patch.order.map(String) : [];
      if (order.length) {
        await db.batch(order.map((taskId, position) => db.prepare(`UPDATE founder_tasks
          SET position = ?, updated_at = ?
          WHERE id = ? AND owner_email = ? AND deleted_at IS NULL`)
          .bind(position, timestamp, taskId, EDITOR_EMAIL)));
      }
    } else if (body.action === 'task_update' && body.id) {
      const p = body.patch ?? {};
      const status = String(p.status ?? 'open');
      await db.prepare(`UPDATE founder_tasks SET title=?, description=?, due_date=?, due_time=?, priority=?, category=?, status=?, link=?, completed_at=?, updated_at=? WHERE id=? AND owner_email=?`)
        .bind(String(p.title ?? ''), String(p.description ?? ''), p.dueDate ? String(p.dueDate) : null, p.dueTime ? String(p.dueTime) : null, String(p.priority ?? 'medium'), String(p.category ?? 'General'), status, String(p.link ?? ''), status === 'complete' ? timestamp : null, timestamp, body.id, EDITOR_EMAIL).run();
    } else if (body.action === 'task_delete' && body.id) {
      await db.prepare('UPDATE founder_tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND owner_email = ?').bind(timestamp, timestamp, body.id, EDITOR_EMAIL).run();
    } else if (body.action === 'task_restore' && body.id) {
      await db.prepare('UPDATE founder_tasks SET deleted_at = NULL, updated_at = ? WHERE id = ? AND owner_email = ?').bind(timestamp, body.id, EDITOR_EMAIL).run();
    } else if (body.action === 'routine_create') {
      const p = body.patch ?? {};
      const next = await db.prepare('SELECT COALESCE(MAX(position), -1) AS position FROM routines WHERE owner_email = ?').bind(EDITOR_EMAIL).first<{ position: number }>();
      await db.prepare('INSERT INTO routines (id, owner_email, title, time, position, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
        .bind(id('routine'), EDITOR_EMAIL, String(p.title ?? '').trim(), String(p.time ?? '09:00'), Number(next?.position ?? -1) + 1, timestamp, timestamp).run();
    } else if (body.action === 'routine_update' && body.id) {
      const p = body.patch ?? {};
      await db.prepare('UPDATE routine_occurrences SET status=?, note=?, updated_at=?, completed_at=? WHERE id=? AND owner_email=?')
        .bind(String(p.status ?? 'pending'), String(p.note ?? ''), timestamp, p.status === 'completed' || p.status === 'skipped' ? timestamp : null, body.id, EDITOR_EMAIL).run();
    } else if (body.action === 'routine_edit' && body.id) {
      const p = body.patch ?? {};
      const date = indiaDate();
      await db.batch([
        db.prepare('UPDATE routines SET title=?, time=?, updated_at=? WHERE id=? AND owner_email=?').bind(String(p.title ?? ''), String(p.time ?? ''), timestamp, body.id, EDITOR_EMAIL),
        db.prepare('UPDATE routine_occurrences SET title=?, time=?, updated_at=? WHERE routine_id=? AND owner_email=? AND date=?').bind(String(p.title ?? ''), String(p.time ?? ''), timestamp, body.id, EDITOR_EMAIL, date),
      ]);
    } else if (body.action === 'routine_delete' && body.id) {
      const date = indiaDate();
      await db.batch([
        db.prepare('UPDATE routines SET active=0, updated_at=? WHERE id=? AND owner_email=?').bind(timestamp, body.id, EDITOR_EMAIL),
        db.prepare('DELETE FROM routine_occurrences WHERE routine_id=? AND owner_email=? AND date=?').bind(body.id, EDITOR_EMAIL, date),
      ]);
    } else if (body.action === 'routine_restore' && body.id) {
      await db.prepare('UPDATE routines SET active=1, updated_at=? WHERE id=? AND owner_email=?').bind(timestamp, body.id, EDITOR_EMAIL).run();
    } else if (body.action === 'diary_save') {
      const p = body.patch ?? {};
      const entryDate = String(p.entryDate ?? indiaDate());
      await db.prepare(`INSERT INTO diary_entries (id, owner_email, entry_date, completed, moved_forward, learned, blocker, insight, tomorrow, mood, notes, finished_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_email, entry_date) DO UPDATE SET completed=excluded.completed, moved_forward=excluded.moved_forward, learned=excluded.learned, blocker=excluded.blocker, insight=excluded.insight, tomorrow=excluded.tomorrow, mood=excluded.mood, notes=excluded.notes, finished_at=excluded.finished_at, updated_at=excluded.updated_at`)
        .bind(`diary-${entryDate}`, EDITOR_EMAIL, entryDate, String(p.completed ?? ''), String(p.movedForward ?? ''), String(p.learned ?? ''), String(p.blocker ?? ''), String(p.insight ?? ''), String(p.tomorrow ?? ''), String(p.mood ?? 'Focused'), String(p.notes ?? ''), p.finished ? timestamp : null, timestamp).run();
    } else if (body.action === 'suggestion_create') {
      const p = body.patch ?? {};
      await db.prepare(`INSERT INTO suggestions (id, author_email, title, body, category, priority, phase_id, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`)
        .bind(id('suggestion'), access.viewerEmail, String(p.title ?? '').trim(), String(p.body ?? '').trim(), String(p.category ?? 'Other'), String(p.priority ?? 'medium'), p.phaseId ? String(p.phaseId) : null, timestamp, timestamp).run();
    } else if (body.action === 'suggestion_reply' && body.suggestionId) {
      const p = body.patch ?? {};
      await db.prepare('INSERT INTO suggestion_replies (id, suggestion_id, author_email, body, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id('reply'), body.suggestionId, access.viewerEmail, String(p.body ?? '').trim(), p.parentId ? String(p.parentId) : null, timestamp, timestamp).run();
    } else if (body.action === 'suggestion_vote' && body.suggestionId) {
      const existing = await db.prepare('SELECT suggestion_id FROM suggestion_votes WHERE suggestion_id=? AND author_email=?').bind(body.suggestionId, access.viewerEmail).first();
      if (existing) await db.prepare('DELETE FROM suggestion_votes WHERE suggestion_id=? AND author_email=?').bind(body.suggestionId, access.viewerEmail).run();
      else await db.prepare('INSERT INTO suggestion_votes (suggestion_id, author_email, created_at) VALUES (?, ?, ?)').bind(body.suggestionId, access.viewerEmail, timestamp).run();
    } else if (body.action === 'suggestion_manage' && body.suggestionId) {
      requireEditor(access);
      const p = body.patch ?? {};
      await db.prepare('UPDATE suggestions SET status=?, pinned=?, founder_priority=?, founder_note=?, phase_id=?, updated_at=? WHERE id=?')
        .bind(String(p.status ?? 'new'), p.pinned ? 1 : 0, p.founderPriority ? 1 : 0, String(p.founderNote ?? ''), p.phaseId ? String(p.phaseId) : null, timestamp, body.suggestionId).run();
    } else {
      return Response.json({ error: 'Unsupported action.' }, { status: 400 });
    }

    const view = body.action.startsWith('suggestion') ? 'suggestions' : 'sarthak';
    return Response.json(view === 'suggestions' ? await suggestionData(access) : await founderData(access));
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to save workspace.' }, { status: 500 });
  }
}
