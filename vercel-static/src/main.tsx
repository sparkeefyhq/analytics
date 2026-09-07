import { FormEvent, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { pickTodaysFocus } from "./focus";
import "./style.css";

type Metric = {
  id: string;
  name: string;
  target: number;
  actual: number | null;
  unit: string;
  comparator: "gte" | "lte" | "eq";
  category: string;
  valueType?: "number" | "fraction" | "percent";
  targetDenominator?: number | null;
  actualDenominator?: number | null;
  minimumDenominator?: number | null;
  definition?: string;
};
// Kept only for backwards-compatible action handling; the Phase 0 UI no longer
// renders participant evidence or release-gate controls.
type ReleaseGate = { id: string; actual: number };
type CohortParticipant = any;
type Check = { id: string; label: string; completed: boolean };
type Phase = {
  id: string;
  position: number;
  name: string;
  objective: string;
  actualUsers: number;
  userMin: number;
  userMax: number;
  elapsedDays: number;
  durationMin: number;
  durationMax: number;
  durationUnit: string;
  status: string;
  features: string[];
  metrics: Metric[];
  checks: Check[];
};
type Tracker = {
  phases: Phase[];
  canEdit: boolean;
  viewerEmail: string | null;
  authenticated: true;
  phase0Unmet?: string[];
};
type Routine = {
  id: string;
  routine_id: string;
  title: string;
  time: string;
  status: "pending" | "completed" | "skipped";
  note: string;
  completed_at: string | null;
  icon_type?: string | null;
  icon_source?: string;
  link?: string;
};
type Task = {
  id: string;
  title: string;
  description: string;
  due_date: string | null;
  due_time: string | null;
  priority: string;
  category: string;
  status: string;
  link: string;
  icon_type?: string | null;
  icon_source?: string;
  completed_at: string | null;
  position?: number;
};
type Diary = {
  completed: string;
  moved_forward: string;
  learned: string;
  blocker: string;
  insight: string;
  tomorrow: string;
  mood: string;
  notes: string;
  finished_at: string | null;
};
type Meeting = {
  id: string;
  title: string;
  category: string;
  contact: string;
  scheduled_date: string;
  scheduled_time: string;
  meeting_link: string;
  description: string;
  status: "scheduled" | "follow-up" | "followed-up" | "cancelled";
  preparation_goal: string;
  talking_points: string;
  questions: string;
  desired_next_step: string;
  outcome: string;
  next_step: string;
  follow_up_date: string | null;
  private_notes: string;
};
type FounderData = {
  date: string;
  routines: Routine[];
  tasks: Task[];
  diary: Diary | null;
  diaryHistory: {
    entry_date: string;
    mood: string;
    finished_at: string | null;
  }[];
  meetings: Meeting[];
  launchDate: string | null;
  integrations: { googleCalendar: boolean; zohoEmail: boolean };
};
type Suggestion = {
  id: string;
  author_email: string;
  title: string;
  body: string;
  category: string;
  priority: string;
  phase_id: string | null;
  status: string;
  pinned: number;
  founder_priority: number;
  founder_note: string;
  created_at: string;
};
type Reply = {
  id: string;
  suggestion_id: string;
  author_email: string;
  body: string;
  created_at: string;
};
type SuggestionsData = {
  suggestions: Suggestion[];
  replies: Reply[];
  votes: { suggestion_id: string; count: number }[];
  viewerEmail: string;
  canEdit: boolean;
};

const titleCase = (value: string) =>
  value.replace(/\b\w/g, (l) => l.toUpperCase());
const passes = (m: Metric) =>
  m.actual !== null &&
  (m.valueType === "percent"
    ? Boolean(
        m.actualDenominator &&
        (!m.minimumDenominator ||
          m.actualDenominator >= m.minimumDenominator) &&
        (m.actual / m.actualDenominator) * 100 >= m.target,
      )
    : m.valueType === "fraction"
      ? Boolean(
          m.actualDenominator &&
          (!m.minimumDenominator ||
            m.actualDenominator >= m.minimumDenominator) &&
          (!m.targetDenominator ||
            m.actualDenominator >= m.targetDenominator) &&
          m.actual >= m.target,
        )
      : m.comparator === "lte"
        ? m.actual <= m.target
        : m.comparator === "eq"
          ? m.actual === m.target
          : m.actual >= m.target);
const ready = (p: Phase) =>
  p.metrics.every(passes) && p.checks.every((c) => c.completed);
const blankDiary: Diary = {
  completed: "",
  moved_forward: "",
  learned: "",
  blocker: "",
  insight: "",
  tomorrow: "",
  mood: "Focused",
  notes: "",
  finished_at: null,
};

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const d = (await r.json()) as { error?: string };
      if (!r.ok) throw Error(d.error || "Unable to sign in.");
      onSuccess();
    } catch (x) {
      setError(x instanceof Error ? x.message : "Unable to sign in.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="login">
      <div className="login-box">
        <div className="brand light">
          <b>✦</b> Sparkeefy
        </div>
        <section className="login-card">
          <span className="lock">⌁</span>
          <small>INTERNAL WORKSPACE</small>
          <h1>Launch control</h1>
          <p>
            Your execution, launch decisions and team ideas—one calm operating
            system.
          </p>
          <form onSubmit={submit}>
            <label>
              Email
              <input
                required
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Password
              <input
                required
                type="password"
                autoComplete="current-password"
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && <div className="error">{error}</div>}
            <button className="primary" disabled={loading}>
              {loading ? "Checking access…" : "Enter Launch Control →"}
            </button>
          </form>
          <em>Access is limited to the Sparkeefy launch team.</em>
        </section>
      </div>
    </main>
  );
}

function Sidebar({
  view,
  setView,
  canEdit,
  email,
  onLogout,
  suggestionCount,
}: {
  view: string;
  setView: (v: string) => void;
  canEdit: boolean;
  email: string | null;
  onLogout: () => void;
  suggestionCount: number;
}) {
  const go = (v: string) => {
    history.pushState({}, "", `/${v}`);
    setView(v);
  };
  return (
    <aside className="sidebar">
      <div className="brand">
        <b>✦</b>
        <span>
          Sparkeefy<small>Launch Control</small>
        </span>
      </div>
      <p className="side-label">WORKSPACE</p>
      {canEdit && (
        <button
          className={view === "sarthak" ? "nav active" : "nav"}
          onClick={() => go("sarthak")}
        >
          <i>☀</i>
          <span>Sarthak</span>
        </button>
      )}
      <button
        className={view === "launch" ? "nav active" : "nav"}
        onClick={() => go("launch")}
      >
        <i>◈</i>
        <span>Launch</span>
      </button>
      <button
        className={view === "suggestions" ? "nav active" : "nav"}
        onClick={() => go("suggestions")}
      >
        <i>✦</i>
        <span>Suggestions</span>
        {suggestionCount > 0 && <em>{suggestionCount}</em>}
      </button>
      <div className="sidebar-bottom">
        <div className="identity">
          <span>{(email || "S")[0].toUpperCase()}</span>
          <div>
            <b>{canEdit ? "Sarthak" : "Team member"}</b>
            <small>{email}</small>
          </div>
        </div>
        <button onClick={onLogout}>Sign out</button>
      </div>
    </aside>
  );
}

function Sarthak({
  data,
  save,
  notice,
}: {
  data: FounderData;
  save: (
    action: string,
    patch?: Record<string, unknown>,
    id?: string,
  ) => Promise<void>;
  notice: (m: string) => void;
}) {
  const [task, setTask] = useState(""),
    [time, setTime] = useState(""),
    [repeat, setRepeat] = useState(false),
    [diary, setDiary] = useState<Diary>(data.diary || blankDiary);
  useEffect(() => setDiary(data.diary || blankDiary), [data]);
  useEffect(() => {
    const fired = new Set<string>();
    const tick = () => {
      if (!("Notification" in window) || Notification.permission !== "granted")
        return;
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(new Date());
      const hour = parts.find((x) => x.type === "hour")?.value || "00",
        minute = parts.find((x) => x.type === "minute")?.value || "00",
        current = `${hour}:${minute}`;
      for (const item of data.routines.filter((x) => x.status === "pending")) {
        const [h, m] = item.time.split(":").map(Number),
          total = (h * 60 + m + 30) % (24 * 60),
          follow = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`,
          key = `${item.id}-${current}`;
        if (!fired.has(key) && (current === item.time || current === follow)) {
          new Notification("Sparkeefy Launch Control", {
            body: `${item.title} is ready when you are.`,
          });
          fired.add(key);
        }
      }
    };
    tick();
    const timer = window.setInterval(tick, 30000);
    return () => window.clearInterval(timer);
  }, [data.routines]);
  const done =
      data.routines.filter((r) => r.status === "completed").length +
      data.tasks.filter((t) => t.status === "complete").length,
    total = data.routines.length + data.tasks.length,
    percent = total ? Math.round((done / total) * 100) : 0,
    next = data.routines.find((r) => r.status === "pending");
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!task.trim()) return;
    await save(
      repeat ? "routine_create" : "task_create",
      repeat
        ? { title: task, time: time || "09:00" }
        : {
            title: task,
            dueDate: data.date,
            dueTime: time || null,
            priority: "medium",
            category: "Founder",
          },
    );
    setTask("");
    setTime("");
    setRepeat(false);
  }
  async function saveDiary(finished = false) {
    await save("diary_save", {
      entryDate: data.date,
      completed: diary.completed,
      movedForward: diary.moved_forward,
      learned: diary.learned,
      blocker: diary.blocker,
      insight: diary.insight,
      tomorrow: diary.tomorrow,
      mood: diary.mood,
      notes: diary.notes,
      finished,
    });
    notice(finished ? "Today is saved and finished." : "Diary saved.");
  }
  return (
    <section className="page founder">
      <header className="page-head">
        <div>
          <p className="eyebrow">PRIVATE FOUNDER WORKSPACE</p>
          <h1>Good morning, Sarthak.</h1>
          <p>{data.date} · Build the signal before you scale the noise.</p>
        </div>
        <div className="completion">
          <b>{percent}%</b>
          <span>daily momentum</span>
        </div>
      </header>
      <section className="focus-card">
        <div>
          <p className="eyebrow">TODAY’S FOCUS</p>
          <h2>
            {next
              ? `Next: ${next.title}`
              : "The essentials are done. Protect the learning loop."}
          </h2>
          <p>
            {done} completed · {Math.max(total - done, 0)} remaining
          </p>
        </div>
        <button
          className="outline"
          onClick={() => {
            "Notification" in window
              ? Notification.requestPermission().then(() =>
                  notice(
                    "Browser reminders are enabled while this tab stays open.",
                  ),
                )
              : notice("Browser notifications are not supported here.");
          }}
        >
          Enable reminders
        </button>
      </section>
      <div className="founder-grid">
        <article className="card routines">
          <div className="card-title">
            <div>
              <p className="eyebrow">REPEATABLE EVENTS</p>
              <h3>Daily Reddit rhythm</h3>
            </div>
            <span>Asia/Kolkata</span>
          </div>
          <div className="routine-list">
            {data.routines.map((r) => (
              <div className={`routine ${r.status}`} key={r.id}>
                <time>{r.time}</time>
                <span className="routine-dot" />
                <div>
                  <b>{r.title}</b>
                  <small>
                    {r.status === "completed"
                      ? "Done today"
                      : r.status === "skipped"
                        ? "Skipped today"
                        : "Scheduled today"}
                  </small>
                </div>
                <button
                  className="icon-button"
                  onClick={() =>
                    void save(
                      "routine_update",
                      {
                        status:
                          r.status === "completed" ? "pending" : "completed",
                        note: r.note,
                      },
                      r.id,
                    )
                  }
                >
                  {r.status === "completed" ? "✓" : "○"}
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    void save(
                      "routine_update",
                      { status: "skipped", note: r.note },
                      r.id,
                    )
                  }
                >
                  Skip
                </button>
              </div>
            ))}
          </div>
        </article>
        <article className="card tasks">
          <div className="card-title">
            <div>
              <p className="eyebrow">YOUR LIST</p>
              <h3>Tasks that move the week</h3>
            </div>
          </div>
          <form className="quick-add" onSubmit={add}>
            <input
              placeholder="Add a task or repeatable event…"
              value={task}
              onChange={(e) => setTask(e.target.value)}
            />
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
            <label>
              <input
                type="checkbox"
                checked={repeat}
                onChange={(e) => setRepeat(e.target.checked)}
              />{" "}
              repeat daily
            </label>
            <button className="primary">Add</button>
          </form>
          <div className="task-list">
            {data.tasks.length === 0 && (
              <p className="empty">
                No custom tasks yet. Add the next thing that matters.
              </p>
            )}
            {data.tasks.map((t) => (
              <div
                className={`task ${t.status === "complete" ? "done" : ""}`}
                key={t.id}
              >
                <button
                  className="check"
                  onClick={() =>
                    void save(
                      "task_update",
                      {
                        ...t,
                        dueDate: t.due_date,
                        dueTime: t.due_time,
                        status: t.status === "complete" ? "open" : "complete",
                      },
                      t.id,
                    )
                  }
                >
                  {t.status === "complete" ? "✓" : ""}
                </button>
                <div>
                  <b>{t.title}</b>
                  <small>
                    {t.category} · {t.due_time || "No time set"} ·{" "}
                    <em className={`priority ${t.priority}`}>{t.priority}</em>
                  </small>
                </div>
                <button
                  className="text-button danger"
                  onClick={() => {
                    if (confirm(`Delete “${t.title}”?`))
                      void save("task_delete", undefined, t.id);
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </article>
      </div>
      <article className="card diary">
        <div className="card-title">
          <div>
            <p className="eyebrow">DAILY DONE</p>
            <h3>Close the day with evidence</h3>
          </div>
          <select
            value={diary.mood}
            onChange={(e) => setDiary({ ...diary, mood: e.target.value })}
          >
            {["Focused", "High energy", "Steady", "Stretched", "Drained"].map(
              (x) => (
                <option key={x}>{x}</option>
              ),
            )}
          </select>
        </div>
        <div className="diary-grid">
          {[
            ["completed", "What I completed today"],
            ["moved_forward", "What moved Sparkeefy forward"],
            ["learned", "What I learned"],
            ["blocker", "Biggest blocker"],
            ["insight", "Important user insight"],
            ["tomorrow", "Tomorrow’s top priority"],
          ].map(([field, label]) => (
            <label key={field}>
              <span>{label}</span>
              <textarea
                value={diary[field as keyof Diary] as string}
                onChange={(e) =>
                  setDiary({ ...diary, [field]: e.target.value })
                }
              />
            </label>
          ))}
        </div>
        <label className="full-field">
          <span>Freeform notes</span>
          <textarea
            value={diary.notes}
            onChange={(e) => setDiary({ ...diary, notes: e.target.value })}
          />
        </label>
        <div className="diary-actions">
          <span>
            {diary.finished_at ? "Finished today" : "Draft not yet finished"}
          </span>
          <button className="outline" onClick={() => void saveDiary()}>
            Save draft
          </button>
          <button className="primary" onClick={() => void saveDiary(true)}>
            Finish day
          </button>
        </div>
      </article>
    </section>
  );
}

function SarthakV2({
  data,
  save,
  notice,
}: {
  data: FounderData;
  save: (
    action: string,
    patch?: Record<string, unknown>,
    id?: string,
  ) => Promise<void>;
  notice: (m: string) => void;
}) {
  const [tasks, setTasks] = useState<Task[]>(data.tasks),
    [routines, setRoutines] = useState<Routine[]>(data.routines),
    [draft, setDraft] = useState({
      title: "",
      dueDate: data.date,
      time: "",
      priority: "medium",
      repeat: "none",
    }),
    [diary, setDiary] = useState<Diary>(data.diary || blankDiary),
    [undo, setUndo] = useState<{ label: string; run: () => void } | null>(null),
    [dragId, setDragId] = useState<string | null>(null);
  useEffect(() => {
    setTasks(data.tasks);
    setRoutines(data.routines);
    setDiary(data.diary || blankDiary);
  }, [data]);
  const ist = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hour12: false,
    }).format(new Date()),
    hour = Number(ist),
    greeting =
      hour < 5
        ? "Working late, Sarthak?"
        : hour < 12
          ? "Good morning, Sarthak."
          : hour < 17
            ? "Good afternoon, Sarthak."
            : hour < 22
              ? "Good evening, Sarthak."
              : "Working late, Sarthak?";
  const completedTime = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat("en-IN", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date(value))
      : "";
  const activeTasks = tasks.filter((t) => t.status !== "complete"),
    completedTasks = tasks.filter((t) => t.status === "complete"),
    activeRoutines = routines.filter((r) => r.status === "pending"),
    completedRoutines = routines.filter((r) => r.status !== "pending");
  const rank = (t: Task) =>
    `${t.due_date && t.due_date < data.date ? "0" : t.due_date === data.date ? "1" : "2"}-${t.due_time ? "0" : "1"}-${t.priority === "high" ? "0" : t.priority === "medium" ? "1" : "2"}-${t.due_time || "99:99"}-${t.title}`;
  const today = activeTasks
      .filter((t) => !t.due_date || t.due_date <= data.date)
      .sort((a, b) => rank(a).localeCompare(rank(b))),
    upcoming = activeTasks
      .filter((t) => t.due_date && t.due_date > data.date)
      .sort((a, b) => rank(a).localeCompare(rank(b)));
  const focus = pickTodaysFocus(
    [...activeTasks, ...activeRoutines],
    data.date,
  ) as Task | Routine | null;
  const done = completedTasks.length + completedRoutines.length,
    total = tasks.length + routines.length,
    percent = total ? Math.round((done / total) * 100) : 0;
  const toast = (label: string, run: () => void) => {
    setUndo({ label, run });
    window.setTimeout(() => setUndo(null), 5200);
  };
  const taskPatch = (t: Task, status: string) => ({
    title: t.title,
    description: t.description,
    dueDate: t.due_date,
    dueTime: t.due_time,
    priority: t.priority,
    category: t.category,
    link: t.link,
    status,
  });
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) return;
    if (draft.repeat === "daily") {
      setRoutines([
        ...routines,
        {
          id: `optimistic-${Date.now()}`,
          routine_id: `optimistic-${Date.now()}`,
          title: draft.title,
          time: draft.time || "09:00",
          status: "pending",
          note: "",
          completed_at: null,
        },
      ]);
      await save("routine_create", {
        title: draft.title,
        time: draft.time || "09:00",
      });
    } else {
      const optimistic: Task = {
        id: `optimistic-${Date.now()}`,
        title: draft.title,
        description: "",
        due_date: draft.dueDate || data.date,
        due_time: draft.time || null,
        priority: draft.priority,
        category: "Founder",
        status: "open",
        link: "",
        completed_at: null,
      };
      setTasks([...tasks, optimistic]);
      await save("task_create", {
        title: draft.title,
        dueDate: optimistic.due_date,
        dueTime: optimistic.due_time,
        priority: optimistic.priority,
        category: "Founder",
      });
    }
    setDraft({
      title: "",
      dueDate: data.date,
      time: "",
      priority: "medium",
      repeat: "none",
    });
    notice("Added to your command centre.");
  }
  function completeTask(t: Task) {
    setTasks(
      tasks.map((x) =>
        x.id === t.id
          ? { ...x, status: "complete", completed_at: new Date().toISOString() }
          : x,
      ),
    );
    void save("task_update", taskPatch(t, "complete"), t.id);
    toast(`Completed “${t.title}”`, () => {
      setTasks((xs) =>
        xs.map((x) =>
          x.id === t.id ? { ...x, status: "open", completed_at: null } : x,
        ),
      );
      void save("task_update", taskPatch(t, "open"), t.id);
    });
  }
  function updateRoutine(
    r: Routine,
    status: "completed" | "skipped" | "pending",
  ) {
    setRoutines(
      routines.map((x) =>
        x.id === r.id
          ? {
              ...x,
              status,
              completed_at:
                status === "pending" ? null : new Date().toISOString(),
            }
          : x,
      ),
    );
    void save("routine_update", { status, note: r.note }, r.id);
    if (status !== "pending")
      toast(
        `${status === "skipped" ? "Skipped" : "Completed"} “${r.title}”`,
        () => {
          setRoutines((xs) =>
            xs.map((x) =>
              x.id === r.id
                ? { ...x, status: "pending", completed_at: null }
                : x,
            ),
          );
          void save(
            "routine_update",
            { status: "pending", note: r.note },
            r.id,
          );
        },
      );
  }
  function rescheduleRoutine(r: Routine) {
    const time = prompt("New routine time (HH:MM)", r.time);
    if (!time) return;
    setRoutines((xs) => xs.map((x) => (x.id === r.id ? { ...x, time } : x)));
    void save("routine_edit", { title: r.title, time }, r.routine_id);
  }
  function removeRoutine(r: Routine) {
    if (!confirm(`Delete recurring routine “${r.title}”?`)) return;
    setRoutines((xs) => xs.filter((x) => x.id !== r.id));
    void save("routine_delete", undefined, r.routine_id);
    toast(`Deleted “${r.title}”`, () => {
      setRoutines((xs) => [...xs, r]);
      void save("routine_restore", undefined, r.routine_id);
    });
  }
  function remove(t: Task) {
    setTasks(tasks.filter((x) => x.id !== t.id));
    void save("task_delete", undefined, t.id);
    toast(`Deleted “${t.title}”`, () => {
      setTasks((xs) => [...xs, t]);
      void save("task_restore", undefined, t.id);
    });
  }
  function reorder(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const movable = tasks.filter((x) => !x.due_time && x.status !== "complete"),
      from = movable.findIndex((x) => x.id === dragId),
      to = movable.findIndex((x) => x.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...movable];
    next.splice(to, 0, next.splice(from, 1)[0]);
    const order = next.map((x) => x.id);
    setTasks(
      tasks.map((x) => {
        const pos = order.indexOf(x.id);
        return pos >= 0 ? ({ ...x, position: pos } as Task) : x;
      }),
    );
    void save("task_reorder", { order });
    setDragId(null);
  }
  async function finish(finished = false) {
    await save("diary_save", {
      entryDate: data.date,
      completed: "",
      movedForward: "",
      learned: "",
      insight: "",
      blocker: diary.blocker,
      tomorrow: diary.tomorrow,
      mood: diary.mood,
      notes: diary.notes,
      finished,
    });
    notice(finished ? "Day locked in." : "Draft saved.");
  }
  const TaskRow = ({ t }: { t: Task }) => {
    const reschedule = () => {
      const dueDate = prompt(
        "Reschedule date (YYYY-MM-DD)",
        t.due_date || data.date,
      );
      if (!dueDate) return;
      setTasks((xs) =>
        xs.map((x) => (x.id === t.id ? { ...x, due_date: dueDate } : x)),
      );
      void save("task_update", { ...taskPatch(t, "open"), dueDate }, t.id);
    };
    const rename = (title: string) => {
      const nextTitle = title.trim() || t.title;
      setTasks((xs) =>
        xs.map((x) => (x.id === t.id ? { ...x, title: nextTitle } : x)),
      );
      void save(
        "task_update",
        { ...taskPatch(t, "open"), title: nextTitle },
        t.id,
      );
    };
    return (
      <div
        className="task todo-row"
        draggable={!t.due_time}
        onDragStart={() => setDragId(t.id)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => reorder(t.id)}
      >
        <button className="check" onClick={() => completeTask(t)}></button>
        <div>
          <b
            contentEditable
            suppressContentEditableWarning
            onBlur={(e) => rename(e.currentTarget.textContent || "")}
          >
            {t.title}
          </b>
          <small>
            {t.due_date && t.due_date < data.date ? "Overdue · " : ""}
            {t.due_date === data.date
              ? t.due_time || "Today"
              : t.due_date || "Today"}{" "}
            · <em className={`priority ${t.priority}`}>{t.priority}</em>
          </small>
        </div>
        <button className="text-button" onClick={reschedule}>
          Move
        </button>
        <button className="text-button danger" onClick={() => remove(t)}>
          Delete
        </button>
      </div>
    );
  };
  return (
    <section className="page founder v2">
      <header className="page-head">
        <div>
          <p className="eyebrow">PRIVATE FOUNDER WORKSPACE</p>
          <h1>{greeting}</h1>
          <p>{data.date} · A lighter, sharper daily command centre.</p>
        </div>
        <div className="completion">
          <b>{percent}%</b>
          <span>daily completion</span>
        </div>
      </header>
      <section className="focus-card">
        <div>
          <p className="eyebrow">TODAY’S FOCUS</p>
          <h2>{focus ? focus.title : "You’re clear for today."}</h2>
          <p>
            {focus && "time" in focus
              ? `${focus.time} · recurring routine`
              : `${focus?.due_time || "No time set"} · one-off task`}
          </p>
        </div>
        <button
          className="outline"
          onClick={() => {
            "Notification" in window
              ? Notification.requestPermission().then(() =>
                  notice("Browser reminders enabled while this tab is open."),
                )
              : notice("Browser notifications are unavailable here.");
          }}
        >
          Enable reminders
        </button>
      </section>
      <article className="card todo-create">
        <form onSubmit={add}>
          <input
            autoFocus
            placeholder="Add a task…"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <input
            type="date"
            value={draft.dueDate}
            onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })}
          />
          <input
            type="time"
            value={draft.time}
            onChange={(e) => setDraft({ ...draft, time: e.target.value })}
          />
          <select
            value={draft.priority}
            onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <select
            value={draft.repeat}
            onChange={(e) => setDraft({ ...draft, repeat: e.target.value })}
          >
            <option value="none">Does not repeat</option>
            <option value="daily">Repeat daily</option>
          </select>
          <button className="primary">Add</button>
        </form>
      </article>
      <div className="command-grid">
        <div>
          <article className="card actionable">
            <div className="card-title">
              <div>
                <p className="eyebrow">TODAY</p>
                <h3>Actionable work</h3>
              </div>
              <span>{today.length}</span>
            </div>
            {today.length ? (
              today.map((t) => <TaskRow key={t.id} t={t} />)
            ) : (
              <p className="empty">You’re clear for today.</p>
            )}
          </article>
          <article className="card actionable upcoming">
            <div className="card-title">
              <div>
                <p className="eyebrow">UPCOMING</p>
                <h3>Later, not lost</h3>
              </div>
              <span>{upcoming.length}</span>
            </div>
            {upcoming.length ? (
              upcoming.map((t) => <TaskRow key={t.id} t={t} />)
            ) : (
              <p className="empty">Nothing scheduled after today.</p>
            )}
          </article>
        </div>
        <article className="card routines">
          <div className="card-title">
            <div>
              <p className="eyebrow">REPEATABLE EVENTS</p>
              <h3>Recurring routines</h3>
            </div>
            <span>Asia/Kolkata</span>
          </div>
          <div className="routine-list">
            {activeRoutines.map((r) => (
              <div className="routine pending" key={r.id}>
                <time>{r.time}</time>
                <span className="routine-dot" />
                <div>
                  <b>{r.title}</b>
                  <small>Scheduled today</small>
                </div>
                <button
                  className="icon-button"
                  onClick={() => updateRoutine(r, "completed")}
                >
                  ○
                </button>
                <button
                  className="text-button"
                  onClick={() => updateRoutine(r, "skipped")}
                >
                  Skip
                </button>
                <button
                  className="text-button"
                  onClick={() => rescheduleRoutine(r)}
                >
                  Move
                </button>
                <button
                  className="text-button danger"
                  onClick={() => removeRoutine(r)}
                >
                  Delete
                </button>
              </div>
            ))}
            {!activeRoutines.length && (
              <p className="empty">No active routines left today.</p>
            )}
          </div>
        </article>
      </div>
      <details className="completed-today">
        <summary>
          Completed today <span>{done}</span>
        </summary>
        <div>
          {completedTasks.map((t) => (
            <div className="task done" key={t.id}>
              <button
                className="check"
                onClick={() => {
                  setTasks((xs) =>
                    xs.map((x) =>
                      x.id === t.id
                        ? { ...x, status: "open", completed_at: null }
                        : x,
                    ),
                  );
                  void save("task_update", taskPatch(t, "open"), t.id);
                }}
              >
                ✓
              </button>
              <div>
                <b>{t.title}</b>
                <small>Completed {completedTime(t.completed_at)}</small>
              </div>
              <button
                className="text-button"
                onClick={() => {
                  setTasks((xs) =>
                    xs.map((x) =>
                      x.id === t.id
                        ? { ...x, status: "open", completed_at: null }
                        : x,
                    ),
                  );
                  void save("task_update", taskPatch(t, "open"), t.id);
                }}
              >
                Undo
              </button>
            </div>
          ))}
          {completedRoutines.map((r) => (
            <div className="routine completed" key={r.id}>
              <time>{r.time}</time>
              <span className="routine-dot" />
              <div>
                <b>{r.title}</b>
                <small>
                  {r.status === "skipped" ? "Skipped" : "Completed"}{" "}
                  {completedTime(r.completed_at)}
                </small>
              </div>
              <button
                className="text-button"
                onClick={() => updateRoutine(r, "pending")}
              >
                Undo
              </button>
            </div>
          ))}
        </div>
      </details>
      <article className="card diary compact">
        <div className="card-title">
          <div>
            <p className="eyebrow">DAILY DONE</p>
            <h3>A short close-out, backed by real work</h3>
          </div>
          <select
            disabled={Boolean(diary.finished_at)}
            value={diary.mood}
            onChange={(e) => setDiary({ ...diary, mood: e.target.value })}
          >
            {["Focused", "High energy", "Steady", "Stretched", "Drained"].map(
              (x) => (
                <option key={x}>{x}</option>
              ),
            )}
          </select>
        </div>
        <div className="auto-summary">
          <b>
            {done} completed · {percent}% complete
          </b>
          <p>
            {[
              ...completedTasks.map((t) => t.title),
              ...completedRoutines.map(
                (r) =>
                  `${r.title}${r.status === "skipped" ? " (Skipped)" : ""}`,
              ),
            ].join(" · ") || "Completed work will appear here automatically."}
          </p>
        </div>
        <div className="diary-short">
          <label>
            <span>Biggest blocker</span>
            <textarea
              disabled={Boolean(diary.finished_at)}
              value={diary.blocker}
              onChange={(e) => setDiary({ ...diary, blocker: e.target.value })}
            />
          </label>
          <label>
            <span>Tomorrow’s top priority</span>
            <textarea
              disabled={Boolean(diary.finished_at)}
              value={diary.tomorrow}
              onChange={(e) => setDiary({ ...diary, tomorrow: e.target.value })}
            />
          </label>
          <label>
            <span>Notes</span>
            <textarea
              disabled={Boolean(diary.finished_at)}
              value={diary.notes}
              onChange={(e) => setDiary({ ...diary, notes: e.target.value })}
            />
          </label>
        </div>
        <div className="diary-actions">
          <span>
            {diary.finished_at ? "Finished today" : "Draft not yet finished"}
          </span>
          <button
            disabled={Boolean(diary.finished_at)}
            className="outline"
            onClick={() => void finish()}
          >
            Save draft
          </button>
          <button
            disabled={Boolean(diary.finished_at)}
            className="primary"
            onClick={() => void finish(true)}
          >
            Finish day
          </button>
        </div>
      </article>
      {undo && (
        <div className="undo-toast">
          <span>{undo.label}</span>
          <button
            onClick={() => {
              undo.run();
              setUndo(null);
            }}
          >
            Undo
          </button>
        </div>
      )}
    </section>
  );
}

const iconFor = (title: string, stored?: string | null) =>
  stored ||
  (/\breddit\b/i.test(title)
    ? "reddit"
    : /\binstagram\b/i.test(title)
      ? "instagram"
      : /\blinkedin\b/i.test(title)
        ? "linkedin"
        : /\byoutube\b|\bvideo\b/i.test(title)
          ? "youtube"
          : /\bwhatsapp\b|\bmessage\b/i.test(title)
            ? "whatsapp"
            : /\bemail\b|\boutreach\b/i.test(title)
              ? "mail"
              : /\bcall\b|\bmeeting\b/i.test(title)
                ? "calendar"
                : /\binvestor\b|\bfundraising\b/i.test(title)
                  ? "briefcase"
                  : /\buser interview\b|\bfeedback\b/i.test(title)
                    ? "users"
                    : /\bfigma\b|\bdesign\b/i.test(title)
                      ? "design"
                      : /\bdevelopment\b|\bbug\b|\bcode\b/i.test(title)
                        ? "code"
                        : /\banalytics\b|\bmetrics\b/i.test(title)
                          ? "chart"
                          : "task");
const markUrl = (kind: string) =>
  (
    ({
      reddit: "https://cdn.simpleicons.org/reddit/FF4500",
      instagram: "https://cdn.simpleicons.org/instagram/E4405F",
      linkedin: "https://cdn.simpleicons.org/linkedin/0A66C2",
      youtube: "https://cdn.simpleicons.org/youtube/FF0000",
      whatsapp: "https://cdn.simpleicons.org/whatsapp/25D366",
      design: "https://cdn.simpleicons.org/figma/F24E1E",
    }) as Record<string, string>
  )[kind];
const genericMark = (kind: string) =>
  (
    ({
      mail: "✉",
      calendar: "◷",
      briefcase: "▣",
      users: "♧",
      code: "‹›",
      chart: "◫",
      task: "✓",
    }) as Record<string, string>
  )[kind] || "✓";
const validUrl = (value: string) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
};
const indiaNow = () =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
const displayDate = (date: string) => {
  const [, month, day] = date.split("-");
  return `${day} / ${month}`;
};
const tomorrow = (date: string) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
};
const timeParts = (value: string | null | undefined) => {
  if (!value) return { hour: "", minute: "00", period: "AM" };
  const [rawHour, minute = "00"] = value.split(":");
  const hour = Number(rawHour);
  return {
    hour: String(hour % 12 || 12),
    minute,
    period: hour >= 12 ? "PM" : "AM",
  };
};
const to24HourTime = (hour: string, minute: string, period: string) => {
  if (!hour) return "";
  let value = Number(hour) % 12;
  if (period === "PM") value += 12;
  return `${String(value).padStart(2, "0")}:${minute}`;
};
function TimePicker({
  value,
  onChange,
  label = "Time",
}: {
  value: string | null | undefined;
  onChange: (value: string) => void;
  label?: string;
}) {
  const parts = timeParts(value);
  const update = (patch: Partial<typeof parts>) => {
    const next = { ...parts, ...patch };
    onChange(to24HourTime(next.hour, next.minute, next.period));
  };
  return (
    <div className="time-picker" aria-label={label}>
      <select
        aria-label={`${label} hour`}
        value={parts.hour}
        onChange={(event) => update({ hour: event.target.value })}
      >
        <option value="">Time</option>
        {Array.from({ length: 12 }, (_, index) => String(index + 1)).map(
          (hour) => (
            <option key={hour} value={hour}>
              {hour}
            </option>
          ),
        )}
      </select>
      <select
        aria-label={`${label} minute`}
        value={parts.minute}
        disabled={!parts.hour}
        onChange={(event) => update({ minute: event.target.value })}
      >
        {[
          "00",
          "05",
          "10",
          "15",
          "20",
          "25",
          "30",
          "35",
          "40",
          "45",
          "50",
          "55",
        ].map((minute) => (
          <option key={minute} value={minute}>
            {minute}
          </option>
        ))}
      </select>
      <select
        aria-label={`${label} AM or PM`}
        value={parts.period}
        disabled={!parts.hour}
        onChange={(event) => update({ period: event.target.value })}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}
function WorkIcon({
  title,
  type,
  link,
}: {
  title: string;
  type?: string | null;
  link?: string;
}) {
  const kind = iconFor(title, type),
    mark = markUrl(kind),
    body = mark ? <img src={mark} alt="" /> : <span>{genericMark(kind)}</span>;
  return link && validUrl(link) ? (
    <a
      className="work-icon"
      href={link}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${title}`}
    >
      {body}
    </a>
  ) : (
    <span className="work-icon">{body}</span>
  );
}

function SarthakV3({
  data,
  save,
  notice,
}: {
  data: FounderData;
  save: (
    action: string,
    patch?: Record<string, unknown>,
    id?: string,
  ) => Promise<void>;
  notice: (m: string) => void;
}) {
  const [tasks, setTasks] = useState(data.tasks),
    [routines, setRoutines] = useState(data.routines),
    [meetings, setMeetings] = useState(data.meetings),
    [draft, setDraft] = useState({
      title: "",
      date: data.date,
      time: "",
      priority: "medium",
      repeat: "none",
    }),
    [meetingDraft, setMeetingDraft] = useState({
      title: "",
      category: "Other",
      contact: "",
      date: data.date,
      time: "",
      meetingLink: "",
    }),
    [diary, setDiary] = useState<Diary>(data.diary || blankDiary),
    [editTask, setEditTask] = useState<string | null>(null),
    [editRoutine, setEditRoutine] = useState<string | null>(null),
    [editMeeting, setEditMeeting] = useState<string | null>(null),
    [redditExpanded, setRedditExpanded] = useState(false),
    [redditOffset, setRedditOffset] = useState({ x: 0, y: 0 }),
    [redditDrag, setRedditDrag] = useState<{
      pointerId: number;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
    } | null>(null),
    [undo, setUndo] = useState<{ label: string; run: () => void } | null>(null),
    [saving, setSaving] = useState(false),
    [clock, setClock] = useState(indiaNow());
  useEffect(() => {
    setTasks(data.tasks);
    setRoutines(data.routines);
    setMeetings(data.meetings);
    setDiary(data.diary || blankDiary);
  }, [data]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(indiaNow()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("sparkeefy:reddit-offset");
      if (saved) {
        const value = JSON.parse(saved);
        if (Number.isFinite(value.x) && Number.isFinite(value.y)) {
          setRedditOffset({ x: value.x, y: value.y });
        }
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(
        "sparkeefy:reddit-offset",
        JSON.stringify(redditOffset),
      );
    } catch {}
  }, [redditOffset]);
  const hour = Number(clock.slice(0, 2)),
    greeting =
      hour < 5
        ? "Working late, Sarthak?"
        : hour < 12
          ? "Good morning, Sarthak."
          : hour < 17
            ? "Good afternoon, Sarthak."
            : hour < 22
              ? "Good evening, Sarthak."
              : "Working late, Sarthak?";
  const activeTasks = tasks.filter((t) => t.status === "open"),
    todayTasks = activeTasks.filter(
      (t) => !t.due_date || t.due_date <= data.date,
    ),
    activeRoutines = routines.filter((r) => r.status === "pending"),
    completedTasks = tasks.filter((t) => t.status === "complete"),
    finishedRoutines = routines.filter((r) => r.status !== "pending"),
    todayMeetings = meetings.filter(
      (m) => m.scheduled_date === data.date && m.status === "scheduled",
    ),
    followUps = meetings.filter((m) => m.status === "follow-up");
  const redditRoutines = activeRoutines.filter(
      (routine) => iconFor(routine.title, routine.icon_type) === "reddit",
    ),
    otherRoutines = activeRoutines.filter(
      (routine) => iconFor(routine.title, routine.icon_type) !== "reddit",
    );
  const timed = (a: Task, b: Task) =>
    `${a.due_date && a.due_date < data.date ? "0" : "1"}-${a.due_time || "99:99"}-${a.priority === "high" ? "0" : a.priority === "medium" ? "1" : "2"}-${a.position || 0}`.localeCompare(
      `${b.due_date && b.due_date < data.date ? "0" : "1"}-${b.due_time || "99:99"}-${b.priority === "high" ? "0" : b.priority === "medium" ? "1" : "2"}-${b.position || 0}`,
    );
  todayTasks.sort(timed);
  const focus = pickTodaysFocus(
      [...todayTasks, ...activeRoutines, ...todayMeetings],
      data.date,
      clock,
    ) as Task | Routine | Meeting | null,
    eligible = [
      ...todayTasks,
      ...completedTasks.filter((t) => !t.due_date || t.due_date <= data.date),
      ...routines,
    ],
    completedCount =
      completedTasks.filter((t) => !t.due_date || t.due_date <= data.date)
        .length + routines.filter((r) => r.status === "completed").length,
    total = Math.max(eligible.length, 0),
    percent = total ? Math.round((completedCount / total) * 100) : 0,
    remaining =
      todayTasks.length + activeRoutines.length + todayMeetings.length;
  const persisted = (
    label: string,
    action: string,
    patch: Record<string, unknown> | undefined,
    id: string | undefined,
    rollback: () => void,
  ) => {
    void save(action, patch, id).catch(() => {
      rollback();
      notice(`Couldn’t save ${label}. Your change was restored.`);
    });
  };
  const showUndo = (label: string, run: () => void) => {
    setUndo({ label, run });
    window.setTimeout(() => setUndo(null), 5200);
  };
  const taskPatch = (task: Task, status = task.status) => ({
    title: task.title,
    description: task.description,
    dueDate: task.due_date,
    dueTime: task.due_time,
    priority: task.priority,
    category: task.category,
    link: task.link,
    iconType: task.icon_type,
    iconSource: task.icon_source,
    status,
  });
  const routinePatch = (routine: Routine) => ({
    title: routine.title,
    time: routine.time,
    link: routine.link || "",
    iconType: routine.icon_type,
    iconSource: routine.icon_source,
  });
  function completeTask(task: Task) {
    const before = tasks;
    setTasks((xs) =>
      xs.map((x) =>
        x.id === task.id
          ? { ...x, status: "complete", completed_at: new Date().toISOString() }
          : x,
      ),
    );
    persisted("task", "task_update", taskPatch(task, "complete"), task.id, () =>
      setTasks(before),
    );
    showUndo(`Completed “${task.title}”`, () => {
      const restored = { ...task, status: "open", completed_at: null };
      setTasks((xs) => xs.map((x) => (x.id === task.id ? restored : x)));
      persisted(
        "task",
        "task_update",
        taskPatch(restored, "open"),
        task.id,
        () => setTasks(before),
      );
    });
  }
  function setRoutine(
    routine: Routine,
    status: "pending" | "completed" | "skipped",
  ) {
    const before = routines;
    setRoutines((xs) =>
      xs.map((x) =>
        x.id === routine.id
          ? {
              ...x,
              status,
              completed_at:
                status === "pending" ? null : new Date().toISOString(),
            }
          : x,
      ),
    );
    persisted(
      "routine",
      "routine_update",
      { status, note: routine.note },
      routine.id,
      () => setRoutines(before),
    );
    if (status !== "pending")
      showUndo(
        `${status === "skipped" ? "Skipped" : "Completed"} “${routine.title}”`,
        () => setRoutine(routine, "pending"),
      );
  }
  function deleteTask(task: Task) {
    const before = tasks;
    setTasks((xs) => xs.filter((x) => x.id !== task.id));
    persisted("task", "task_delete", undefined, task.id, () =>
      setTasks(before),
    );
    showUndo(`Deleted “${task.title}”`, () => {
      setTasks(before);
      persisted("task", "task_restore", undefined, task.id, () =>
        setTasks(before.filter((x) => x.id !== task.id)),
      );
    });
  }
  async function addTask(event: FormEvent) {
    event.preventDefault();
    if (!draft.title.trim() || saving) return;
    setSaving(true);
    const snapshot = { ...draft };
    const optimisticId = `optimistic-${Date.now()}`;
    if (draft.repeat === "daily") {
      const item: Routine = {
        id: optimisticId,
        routine_id: optimisticId,
        title: draft.title,
        time: draft.time || "09:00",
        status: "pending",
        note: "",
        completed_at: null,
      };
      setRoutines((xs) => [...xs, item]);
      try {
        await save("routine_create", { title: draft.title, time: item.time });
      } catch {
        setRoutines((xs) => xs.filter((x) => x.id !== optimisticId));
        notice("Couldn’t add routine. Try again.");
        setSaving(false);
        return;
      }
    } else {
      const item: Task = {
        id: optimisticId,
        title: draft.title,
        description: "",
        due_date: draft.date || null,
        due_time: draft.time || null,
        priority: draft.priority,
        category: "General",
        status: "open",
        link: "",
        completed_at: null,
      };
      setTasks((xs) => [...xs, item]);
      try {
        await save("task_create", {
          title: item.title,
          dueDate: item.due_date,
          dueTime: item.due_time,
          priority: item.priority,
          category: item.category,
        });
      } catch {
        setTasks((xs) => xs.filter((x) => x.id !== optimisticId));
        notice("Couldn’t add task. Try again.");
        setSaving(false);
        return;
      }
    }
    setDraft({
      title: "",
      date: data.date,
      time: "",
      priority: "medium",
      repeat: "none",
    });
    setSaving(false);
    notice("Added to today.");
  }
  async function addMeeting(event: FormEvent) {
    event.preventDefault();
    if (!meetingDraft.title.trim()) return;
    try {
      await save("meeting_create", meetingDraft);
      setMeetingDraft({
        title: "",
        category: "Other",
        contact: "",
        date: data.date,
        time: "",
        meetingLink: "",
      });
      notice("Meeting added.");
    } catch {
      notice("Couldn’t add meeting. Check the details and try again.");
    }
  }
  function saveTask(task: Task) {
    const before = tasks;
    persisted("task", "task_update", taskPatch(task), task.id, () =>
      setTasks(before),
    );
    setEditTask(null);
  }
  function saveRoutine(routine: Routine) {
    const before = routines;
    persisted(
      "routine",
      "routine_edit",
      routinePatch(routine),
      routine.routine_id,
      () => setRoutines(before),
    );
    setEditRoutine(null);
  }
  function saveMeeting(meeting: Meeting) {
    const before = meetings;
    persisted(
      "meeting",
      "meeting_update",
      {
        title: meeting.title,
        category: meeting.category,
        contact: meeting.contact,
        date: meeting.scheduled_date,
        time: meeting.scheduled_time,
        meetingLink: meeting.meeting_link,
        description: meeting.description,
        status: meeting.status,
        preparationGoal: meeting.preparation_goal,
        talkingPoints: meeting.talking_points,
        questions: meeting.questions,
        desiredNextStep: meeting.desired_next_step,
        outcome: meeting.outcome,
        nextStep: meeting.next_step,
        followUpDate: meeting.follow_up_date,
        privateNotes: meeting.private_notes,
      },
      meeting.id,
      () => setMeetings(before),
    );
    setEditMeeting(null);
  }
  const displayTime = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat("en-IN", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date(value))
      : "";
  const focusMeta =
    focus && "scheduled_date" in focus
      ? `${focus.scheduled_time} · meeting`
      : focus && "routine_id" in focus
        ? `${focus.time} · recurring routine`
        : focus
          ? `${focus.due_date && focus.due_date < data.date ? "Overdue · " : ""}${focus.due_time || "No time"} · one-off task`
          : "";
  const TaskRow = ({ task }: { task: Task }) => {
    const editing = editTask === task.id;
    return (
      <article className="work-row task-row">
        <button
          className="check"
          onClick={() => completeTask(task)}
          aria-label={`Complete ${task.title}`}
        ></button>
        <WorkIcon title={task.title} type={task.icon_type} link={task.link} />
        <div className="work-copy">
          <b>{task.title}</b>
          <small>
            {task.due_date && task.due_date < data.date ? "Overdue · " : ""}
            {task.due_time || "No time"} · {task.priority}
          </small>
        </div>
        <button
          className="text-button"
          onClick={() => setEditTask(editing ? null : task.id)}
        >
          {editing ? "Close" : "Edit"}
        </button>
        <button
          className="text-button"
          onClick={() => {
            const next = { ...task, due_date: tomorrow(data.date) };
            setTasks((xs) => xs.map((x) => (x.id === task.id ? next : x)));
            saveTask(next);
          }}
        >
          Tomorrow
        </button>
        <button className="text-button danger" onClick={() => deleteTask(task)}>
          Delete
        </button>
        {editing && (
          <div className="row-editor">
            <input
              value={task.title}
              onChange={(e) =>
                setTasks((xs) =>
                  xs.map((x) =>
                    x.id === task.id ? { ...x, title: e.target.value } : x,
                  ),
                )
              }
            />
            <input
              type="date"
              value={task.due_date || ""}
              onChange={(e) =>
                setTasks((xs) =>
                  xs.map((x) =>
                    x.id === task.id
                      ? { ...x, due_date: e.target.value || null }
                      : x,
                  ),
                )
              }
            />
            <TimePicker
              label="Task time"
              value={task.due_time}
              onChange={(value) =>
                setTasks((xs) =>
                  xs.map((x) =>
                    x.id === task.id ? { ...x, due_time: value || null } : x,
                  ),
                )
              }
            />
            <select
              value={task.priority}
              onChange={(e) =>
                setTasks((xs) =>
                  xs.map((x) =>
                    x.id === task.id ? { ...x, priority: e.target.value } : x,
                  ),
                )
              }
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <select
              value={task.icon_source || "inferred"}
              onChange={(e) =>
                setTasks((xs) =>
                  xs.map((x) =>
                    x.id === task.id
                      ? { ...x, icon_source: e.target.value }
                      : x,
                  ),
                )
              }
            >
              <option value="inferred">Infer icon</option>
              <option value="manual">Manual icon</option>
            </select>
            {task.icon_source === "manual" && (
              <input
                placeholder="Icon type"
                value={task.icon_type || ""}
                onChange={(e) =>
                  setTasks((xs) =>
                    xs.map((x) =>
                      x.id === task.id
                        ? { ...x, icon_type: e.target.value }
                        : x,
                    ),
                  )
                }
              />
            )}
            <input
              placeholder="https://…"
              value={task.link || ""}
              onChange={(e) =>
                setTasks((xs) =>
                  xs.map((x) =>
                    x.id === task.id ? { ...x, link: e.target.value } : x,
                  ),
                )
              }
            />
            <button className="primary" onClick={() => saveTask(task)}>
              Save
            </button>
          </div>
        )}
      </article>
    );
  };
  const RoutineRow = ({ routine }: { routine: Routine }) => {
    const editing = editRoutine === routine.id;
    return (
      <article className="work-row routine-row">
        <button
          className="check"
          onClick={() => setRoutine(routine, "completed")}
          aria-label={`Complete ${routine.title}`}
        ></button>
        <WorkIcon
          title={routine.title}
          type={routine.icon_type}
          link={routine.link}
        />
        <time>{routine.time}</time>
        <div className="work-copy">
          <b>{routine.title}</b>
          <small>
            {routine.status === "pending"
              ? routine.time < clock
                ? "Overdue"
                : routine.time === clock
                  ? "Next"
                  : "Later"
              : routine.status}
          </small>
        </div>
        <button
          className="text-button"
          onClick={() => setRoutine(routine, "skipped")}
        >
          Skip
        </button>
        <button
          className="text-button"
          onClick={() => setEditRoutine(editing ? null : routine.id)}
        >
          {editing ? "Close" : "Edit"}
        </button>
        {editing && (
          <div className="row-editor">
            <input
              value={routine.title}
              onChange={(e) =>
                setRoutines((xs) =>
                  xs.map((x) =>
                    x.id === routine.id ? { ...x, title: e.target.value } : x,
                  ),
                )
              }
            />
            <TimePicker
              label="Routine time"
              value={routine.time}
              onChange={(value) =>
                setRoutines((xs) =>
                  xs.map((x) =>
                    x.id === routine.id ? { ...x, time: value || "09:00" } : x,
                  ),
                )
              }
            />
            <select
              value={routine.icon_source || "inferred"}
              onChange={(e) =>
                setRoutines((xs) =>
                  xs.map((x) =>
                    x.id === routine.id
                      ? { ...x, icon_source: e.target.value }
                      : x,
                  ),
                )
              }
            >
              <option value="inferred">Infer icon</option>
              <option value="manual">Manual icon</option>
            </select>
            {routine.icon_source === "manual" && (
              <input
                placeholder="Icon type"
                value={routine.icon_type || ""}
                onChange={(e) =>
                  setRoutines((xs) =>
                    xs.map((x) =>
                      x.id === routine.id
                        ? { ...x, icon_type: e.target.value }
                        : x,
                    ),
                  )
                }
              />
            )}
            <input
              placeholder="https://…"
              value={routine.link || ""}
              onChange={(e) =>
                setRoutines((xs) =>
                  xs.map((x) =>
                    x.id === routine.id ? { ...x, link: e.target.value } : x,
                  ),
                )
              }
            />
            <button className="primary" onClick={() => saveRoutine(routine)}>
              Save
            </button>
            <button
              className="text-button danger"
              onClick={() => {
                if (confirm(`Pause ${routine.title}?`)) {
                  setRoutines((xs) => xs.filter((x) => x.id !== routine.id));
                  persisted(
                    "routine",
                    "routine_delete",
                    undefined,
                    routine.routine_id,
                    () => setRoutines(data.routines),
                  );
                }
              }}
            >
              Pause
            </button>
          </div>
        )}
      </article>
    );
  };
  const RedditRoutineGroup = () =>
    redditRoutines.length ? (
      <section
        className={`routine-group movable-routine-group ${redditDrag ? "is-dragging" : ""}`}
        style={{
          transform: `translate(${redditOffset.x}px, ${redditOffset.y}px)`,
        }}
      >
        <div className="routine-group-toggle">
          <button
            className="drag-handle"
            aria-label="Move Reddit posts"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              setRedditDrag({
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                originX: redditOffset.x,
                originY: redditOffset.y,
              });
            }}
            onPointerMove={(event) => {
              if (!redditDrag || redditDrag.pointerId !== event.pointerId)
                return;
              setRedditOffset({
                x: redditDrag.originX + event.clientX - redditDrag.startX,
                y: redditDrag.originY + event.clientY - redditDrag.startY,
              });
            }}
            onPointerUp={(event) => {
              if (redditDrag?.pointerId === event.pointerId)
                setRedditDrag(null);
            }}
          >
            ⠿
          </button>
          <span className="work-icon" aria-hidden="true">
            <img src={markUrl("reddit")} alt="" />
          </span>
          <button
            className="reddit-group-toggle"
            onClick={() => setRedditExpanded((expanded) => !expanded)}
            aria-expanded={redditExpanded}
          >
            <span>
              <b>Reddit posts</b>
              <small>
                {redditRoutines.length} routines · {redditRoutines[0].time}
                {redditRoutines.length > 1
                  ? `, ${redditRoutines[redditRoutines.length - 1].time}`
                  : ""}
              </small>
            </span>
            <span className="routine-group-count">{redditRoutines.length}</span>
            <span className="routine-group-chevron" aria-hidden="true">
              {redditExpanded ? "−" : "+"}
            </span>
          </button>
        </div>
        {redditExpanded && (
          <div className="routine-group-items">
            {redditRoutines.map((routine) => (
              <RoutineRow key={routine.id} routine={routine} />
            ))}
          </div>
        )}
      </section>
    ) : null;
  return (
    <section className="page founder v3">
      <header className="page-head founder-head">
        <div>
          <p className="eyebrow">PRIVATE FOUNDER WORKSPACE</p>
          <h1>{greeting}</h1>
          <p>
            <b>{displayDate(data.date)}</b> · A lighter, sharper daily command
            centre.
          </p>
          <small className="live-summary">
            {remaining} remaining · {completedCount} completed ·{" "}
            {focus && "scheduled_date" in focus
              ? focus.scheduled_time
              : focus && "routine_id" in focus
                ? focus.time
                : focus?.due_time || "no timed item"}
          </small>
        </div>
        <div className="header-metrics">
          {data.launchDate && (
            <div className="countdown">
              <b>
                {Math.max(
                  0,
                  Math.round(
                    (Date.parse(`${data.launchDate}T00:00:00+05:30`) -
                      Date.now()) /
                      86400000,
                  ),
                ) === 0
                  ? "Launch day"
                  : `${Math.max(0, Math.round((Date.parse(`${data.launchDate}T00:00:00+05:30`) - Date.now()) / 86400000))} days`}
              </b>
              <span>until launch</span>
            </div>
          )}
          <div className={`progress-mini ${percent === 100 ? "complete" : ""}`}>
            <b>{percent}%</b>
            <span>today</span>
          </div>
        </div>
      </header>
      <section className="focus-card focus-v3">
        <div>
          <p className="eyebrow">TODAY’S FOCUS</p>
          {focus ? (
            <>
              <div className="focus-title">
                <WorkIcon
                  title={focus.title}
                  type={"icon_type" in focus ? focus.icon_type : undefined}
                  link={
                    "link" in focus
                      ? focus.link
                      : "meeting_link" in focus
                        ? focus.meeting_link
                        : undefined
                  }
                />
                <h2>{focus.title}</h2>
              </div>
              <p>{focusMeta}</p>
            </>
          ) : (
            <>
              <h2>You’re clear for today.</h2>
              <p>Everything eligible is complete or skipped.</p>
            </>
          )}
        </div>
        {focus && (
          <div className="focus-actions">
            <button
              className="primary"
              onClick={() =>
                "scheduled_date" in focus
                  ? saveMeeting({ ...focus, status: "follow-up" })
                  : "routine_id" in focus
                    ? setRoutine(focus, "completed")
                    : completeTask(focus)
              }
            >
              {"scheduled_date" in focus ? "Prepare" : "Done"}
            </button>
            {("link" in focus && focus.link) ||
            ("meeting_link" in focus && focus.meeting_link) ? (
              <a
                className="outline"
                href={("link" in focus ? focus.link : focus.meeting_link) || ""}
                target="_blank"
                rel="noreferrer"
              >
                {"scheduled_date" in focus && clock >= focus.scheduled_time
                  ? "Join"
                  : "Open link"}
              </a>
            ) : null}
          </div>
        )}
      </section>
      <div className="v3-grid">
        <div>
          <article className="card actionable">
            <div className="card-title">
              <div>
                <p className="eyebrow">TODAY</p>
                <h3>Tasks</h3>
              </div>
              <span>{todayTasks.length}</span>
            </div>
            <div className="todo-create">
              <form onSubmit={addTask}>
                <input
                  autoFocus
                  placeholder="Add a task…"
                  value={draft.title}
                  onChange={(e) =>
                    setDraft({ ...draft, title: e.target.value })
                  }
                />
                <input
                  type="date"
                  value={draft.date}
                  onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                />
                <TimePicker
                  label="Task time"
                  value={draft.time}
                  onChange={(value) => setDraft({ ...draft, time: value })}
                />
                <select
                  value={draft.priority}
                  onChange={(e) =>
                    setDraft({ ...draft, priority: e.target.value })
                  }
                >
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
                <select
                  value={draft.repeat}
                  onChange={(e) =>
                    setDraft({ ...draft, repeat: e.target.value })
                  }
                >
                  <option value="none">Does not repeat</option>
                  <option value="daily">Repeat daily</option>
                </select>
                <button className="primary" disabled={saving}>
                  {saving ? "Adding…" : "Add"}
                </button>
              </form>
            </div>
            {todayTasks.length ? (
              todayTasks.map((task) => <TaskRow key={task.id} task={task} />)
            ) : (
              <p className="empty">
                {activeRoutines.length
                  ? "No tasks due today. Your routines are still on schedule."
                  : "No tasks due today."}
              </p>
            )}
          </article>
          <article className="card meetings">
            <div className="card-title">
              <div>
                <p className="eyebrow">MEETINGS & FOLLOW-UPS</p>
                <h3>Meetings</h3>
              </div>
              <span>{todayMeetings.length + followUps.length}</span>
            </div>
            <form className="meeting-add" onSubmit={addMeeting}>
              <input
                placeholder="Meeting title"
                value={meetingDraft.title}
                onChange={(e) =>
                  setMeetingDraft({ ...meetingDraft, title: e.target.value })
                }
              />
              <select
                value={meetingDraft.category}
                onChange={(e) =>
                  setMeetingDraft({ ...meetingDraft, category: e.target.value })
                }
              >
                {[
                  "Investor",
                  "Team",
                  "User interview",
                  "Advisor",
                  "Partner",
                  "Personal",
                  "Other",
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
              <input
                type="date"
                value={meetingDraft.date}
                onChange={(e) =>
                  setMeetingDraft({ ...meetingDraft, date: e.target.value })
                }
              />
              <TimePicker
                label="Meeting time"
                value={meetingDraft.time}
                onChange={(value) =>
                  setMeetingDraft({ ...meetingDraft, time: value })
                }
              />
              <input
                placeholder="Meet / Zoom link"
                value={meetingDraft.meetingLink}
                onChange={(e) =>
                  setMeetingDraft({
                    ...meetingDraft,
                    meetingLink: e.target.value,
                  })
                }
              />
              <button className="outline">Add meeting</button>
            </form>
            {[...todayMeetings, ...followUps].map((meeting) => (
              <article className="meeting-row" key={meeting.id}>
                <WorkIcon
                  title={meeting.title}
                  type={
                    meeting.category === "Investor"
                      ? "briefcase"
                      : meeting.category === "User interview"
                        ? "users"
                        : "calendar"
                  }
                  link={meeting.meeting_link}
                />
                <div>
                  <b>{meeting.title}</b>
                  <small>
                    {meeting.category} ·{" "}
                    {meeting.scheduled_date === data.date
                      ? meeting.scheduled_time
                      : `${displayDate(meeting.scheduled_date)} · ${meeting.scheduled_time}`}{" "}
                    ·{" "}
                    {meeting.status === "follow-up"
                      ? "Needs follow-up"
                      : meeting.scheduled_time >= clock &&
                          meeting.scheduled_time <=
                            `${clock.slice(0, 2)}:${String(Math.min(59, Number(clock.slice(3)) + 15)).padStart(2, "0")}`
                        ? "Join now"
                        : "Needs preparation"}
                  </small>
                </div>
                <button
                  className="text-button"
                  onClick={() =>
                    setEditMeeting(
                      editMeeting === meeting.id ? null : meeting.id,
                    )
                  }
                >
                  {editMeeting === meeting.id ? "Close" : "Prepare"}
                </button>
                {meeting.meeting_link && (
                  <a
                    className="text-button"
                    target="_blank"
                    rel="noreferrer"
                    href={meeting.meeting_link}
                  >
                    Join
                  </a>
                )}
                {editMeeting === meeting.id && (
                  <div className="meeting-editor">
                    <textarea
                      placeholder="Goal for this meeting"
                      value={meeting.preparation_goal}
                      onChange={(e) =>
                        setMeetings((xs) =>
                          xs.map((x) =>
                            x.id === meeting.id
                              ? { ...x, preparation_goal: e.target.value }
                              : x,
                          ),
                        )
                      }
                    />
                    <textarea
                      placeholder="Three talking points"
                      value={meeting.talking_points}
                      onChange={(e) =>
                        setMeetings((xs) =>
                          xs.map((x) =>
                            x.id === meeting.id
                              ? { ...x, talking_points: e.target.value }
                              : x,
                          ),
                        )
                      }
                    />
                    <textarea
                      placeholder="Questions to ask"
                      value={meeting.questions}
                      onChange={(e) =>
                        setMeetings((xs) =>
                          xs.map((x) =>
                            x.id === meeting.id
                              ? { ...x, questions: e.target.value }
                              : x,
                          ),
                        )
                      }
                    />
                    <textarea
                      placeholder="Desired next step / outcome"
                      value={meeting.desired_next_step}
                      onChange={(e) =>
                        setMeetings((xs) =>
                          xs.map((x) =>
                            x.id === meeting.id
                              ? { ...x, desired_next_step: e.target.value }
                              : x,
                          ),
                        )
                      }
                    />
                    <button
                      className="primary"
                      onClick={() => saveMeeting(meeting)}
                    >
                      Save preparation
                    </button>
                    <button
                      className="outline"
                      onClick={() =>
                        saveMeeting({ ...meeting, status: "follow-up" })
                      }
                    >
                      Needs follow-up
                    </button>
                  </div>
                )}
              </article>
            ))}
            {!todayMeetings.length && !followUps.length && (
              <p className="empty">
                No meetings today.{" "}
                <span>
                  Connect founder email to track replies and follow-ups.
                </span>
              </p>
            )}
            <small className="integration-note">
              Google Calendar and founder email are disconnected until their
              read-only OAuth credentials are configured.
            </small>
          </article>
        </div>
        <article className="card routines">
          <div className="card-title">
            <div>
              <p className="eyebrow">EVERY DAY</p>
              <h3>Routines</h3>
            </div>
            <span>IST</span>
          </div>
          <RedditRoutineGroup />
          {otherRoutines.map((routine) => (
            <RoutineRow key={routine.id} routine={routine} />
          ))}
          {!activeRoutines.length && (
            <p className="empty">No active routines left today.</p>
          )}
        </article>
      </div>
      <details className="completed-today">
        <summary>
          Completed today{" "}
          <span>{completedCount + finishedRoutines.length}</span>
        </summary>
        <div>
          {completedTasks
            .filter((task) => !task.due_date || task.due_date <= data.date)
            .map((task) => (
              <article className="work-row done" key={task.id}>
                <WorkIcon title={task.title} type={task.icon_type} />
                <div className="work-copy">
                  <b>{task.title}</b>
                  <small>Completed {displayTime(task.completed_at)}</small>
                </div>
                <button
                  className="text-button"
                  onClick={() => {
                    const next = {
                      ...task,
                      status: "open",
                      completed_at: null,
                    };
                    setTasks((xs) =>
                      xs.map((x) => (x.id === task.id ? next : x)),
                    );
                    persisted(
                      "task",
                      "task_update",
                      taskPatch(next, "open"),
                      task.id,
                      () => setTasks(tasks),
                    );
                  }}
                >
                  Undo
                </button>
              </article>
            ))}
          {finishedRoutines.map((routine) => (
            <article className="work-row done" key={routine.id}>
              <WorkIcon title={routine.title} type={routine.icon_type} />
              <div className="work-copy">
                <b>{routine.title}</b>
                <small>
                  {routine.status === "skipped" ? "Skipped" : "Completed"}{" "}
                  {displayTime(routine.completed_at)}
                </small>
              </div>
              <button
                className="text-button"
                onClick={() => setRoutine(routine, "pending")}
              >
                Undo
              </button>
            </article>
          ))}
        </div>
      </details>
      <article className="card diary compact">
        <div className="card-title">
          <div>
            <p className="eyebrow">DAILY DONE</p>
            <h3>Close out with the evidence</h3>
          </div>
          <select
            disabled={Boolean(diary.finished_at)}
            value={diary.mood}
            onChange={(e) => setDiary({ ...diary, mood: e.target.value })}
          >
            {["Focused", "High energy", "Steady", "Stretched", "Drained"].map(
              (x) => (
                <option key={x}>{x}</option>
              ),
            )}
          </select>
        </div>
        <div className="auto-summary">
          <b>
            {completedCount} completed · {percent}% complete
          </b>
          <p>
            {[
              ...completedTasks
                .filter((task) => !task.due_date || task.due_date <= data.date)
                .map((task) => task.title),
              ...finishedRoutines.map(
                (routine) =>
                  `${routine.title}${routine.status === "skipped" ? " (Skipped)" : ""}`,
              ),
            ].join(" · ") || "Completed work will appear here automatically."}
          </p>
        </div>
        <div className="diary-short">
          <label>
            <span>Biggest blocker</span>
            <textarea
              disabled={Boolean(diary.finished_at)}
              value={diary.blocker}
              onChange={(e) => setDiary({ ...diary, blocker: e.target.value })}
            />
          </label>
          <label>
            <span>Tomorrow’s top priority</span>
            <textarea
              disabled={Boolean(diary.finished_at)}
              value={diary.tomorrow}
              onChange={(e) => setDiary({ ...diary, tomorrow: e.target.value })}
            />
          </label>
          <label>
            <span>Notes</span>
            <textarea
              disabled={Boolean(diary.finished_at)}
              value={diary.notes}
              onChange={(e) => setDiary({ ...diary, notes: e.target.value })}
            />
          </label>
        </div>
        <div className="diary-actions">
          <span>
            {diary.finished_at ? "Finished today" : "Draft not yet finished"}
          </span>
          {diary.finished_at ? (
            <button
              className="outline"
              onClick={() =>
                void save("diary_save", {
                  entryDate: data.date,
                  blocker: diary.blocker,
                  tomorrow: diary.tomorrow,
                  mood: diary.mood,
                  notes: diary.notes,
                  finished: false,
                })
              }
            >
              Reopen
            </button>
          ) : (
            <>
              <button
                className="outline"
                onClick={() =>
                  void save("diary_save", {
                    entryDate: data.date,
                    blocker: diary.blocker,
                    tomorrow: diary.tomorrow,
                    mood: diary.mood,
                    notes: diary.notes,
                    finished: false,
                  })
                }
              >
                Save draft
              </button>
              <button
                className="primary"
                onClick={() =>
                  void save("diary_save", {
                    entryDate: data.date,
                    blocker: diary.blocker,
                    tomorrow: diary.tomorrow,
                    mood: diary.mood,
                    notes: diary.notes,
                    finished: true,
                  })
                }
              >
                Finish day
              </button>
            </>
          )}
        </div>
      </article>
      {undo && (
        <div className="undo-toast">
          <span>{undo.label}</span>
          <button
            onClick={() => {
              undo.run();
              setUndo(null);
            }}
          >
            Undo
          </button>
        </div>
      )}
    </section>
  );
}

function Launch({
  data,
  save,
}: {
  data: Tracker;
  save: (a: string, p?: Record<string, unknown>, id?: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState("phase-0"),
    phase = data.phases.find((p) => p.id === selected) || data.phases[0],
    [local, setLocal] = useState<Phase>(phase),
    [cohortSearch, setCohortSearch] = useState(""),
    [cohortFilter, setCohortFilter] = useState("all"),
    [cohortDraft, setCohortDraft] = useState<CohortParticipant | null>(null),
    [showAdvanceConfirm, setShowAdvanceConfirm] = useState(false);
  useEffect(() => setLocal(phase), [phase]);
  const progress =
      local.metrics.filter(passes).length +
      local.checks.filter((c) => c.completed).length,
    total = local.metrics.length + local.checks.length;
  const phaseZero = local.id === "phase-0";
  const cohortActual = phaseZero
    ? (local.metrics.find((metric) => metric.name === "Onboarding completion")
        ?.actualDenominator ?? local.actualUsers)
    : local.actualUsers;
  const checklistComplete =
    local.checks.length > 0 && local.checks.every((check) => check.completed);
  const participants: CohortParticipant[] = [];
  const releaseGates: ReleaseGate[] = [];
  const filteredParticipants: CohortParticipant[] = [];
  const cohortSummary = { independent: 0, assisted: 0, inactive: 0, issues: 0 };
  const newParticipant = (): CohortParticipant => ({});
  const update = (
    m: Metric,
    k: "target" | "actual" | "actualDenominator",
    v: string,
  ) =>
    setLocal({
      ...local,
      metrics: local.metrics.map((x) =>
        x.id === m.id
          ? { ...x, [k]: v === "" && k === "actual" ? null : Number(v) }
          : x,
      ),
    });
  const metricActual = (m: Metric) =>
    m.actual === null
      ? "—"
      : m.valueType === "percent"
        ? `${m.actual}/${m.actualDenominator || 0} · ${m.actualDenominator ? Math.round((m.actual / m.actualDenominator) * 100) : 0}%`
        : m.valueType === "fraction"
          ? `${m.actual}/${m.actualDenominator || 0}`
          : `${m.actual}`;
  const metricPercent = (m: Metric) =>
    m.actual === null || m.actualDenominator === null
      ? null
      : m.actualDenominator > 0
        ? Math.round((m.actual / m.actualDenominator) * 100)
        : 0;
  const unmetRequirements = phaseZero
    ? data.phase0Unmet || []
    : [
        ...local.metrics
          .filter((metric) => !passes(metric))
          .map((metric) => metric.name),
        ...local.checks
          .filter((check) => !check.completed)
          .map((check) => check.label),
      ];
  const phaseCanAdvance = unmetRequirements.length === 0;
  return (
    <section className="page launch">
      <header className="page-head">
        <div>
          <p className="eyebrow">ANDROID V3 · VALIDATION ROADMAP</p>
          <h1>Earn the right to scale.</h1>
          <p>Each cohort opens only when the evidence does.</p>
        </div>
        <div className="completion">
          <b>
            {progress}/{total}
          </b>
          <span>checks passed</span>
        </div>
      </header>
      <div className="phase-tabs">
        {data.phases.map((p) => (
          <button
            className={p.id === local.id ? "selected" : ""}
            key={p.id}
            onClick={() => setSelected(p.id)}
          >
            <small>Phase {p.position}</small>
            <b>
              {p.status === "active"
                ? "Active"
                : p.status === "complete"
                  ? "Complete"
                  : "Planned"}
            </b>
          </button>
        ))}
      </div>
      <article className="card phase-card">
        <div className="phase-hero">
          <span>{local.position}</span>
          <div>
            <h2>{local.name}</h2>
            <p>{local.objective}</p>
          </div>
          <b className={phaseCanAdvance ? "pass-badge" : "active-badge"}>
            {local.status === "complete"
              ? "Complete"
              : phaseCanAdvance
                ? "Ready to advance"
                : "In progress"}
          </b>
        </div>
        <div className="phase-info">
          <div>
            Cohort
            <strong>
              {local.userMin === local.userMax
                ? `${cohortActual} / ${local.userMax} users`
                : `${cohortActual} / ${local.userMin} to ${local.userMax} users`}
            </strong>
          </div>
          <div>
            Duration
            <strong>
              Day {local.elapsedDays} / {local.durationMin}–{local.durationMax}{" "}
              {local.durationUnit}
            </strong>
          </div>
          <div>
            Features<strong>{local.features.join(" · ")}</strong>
          </div>
        </div>
      </article>
      {phaseZero && (
        <section className="phase-zero-brief">
          <div>
            <p className="eyebrow">CORE QUESTION</p>
            <h3>
              Can 15 target users get useful help independently and return
              without prompting?
            </h3>
          </div>
          <div className="phase-zero-wedge">
            <b>15 Indian men aged 18 to 28</b>
            <span>Use real users and log every result.</span>
          </div>
          <details>
            <summary>Phase 0 configuration</summary>
            <div className="config-grid">
              <span>
                <b>Enabled</b>AI Wingman V3 · person context · user reminders ·
                feedback · analytics
              </span>
              <span>
                <b>Disabled</b>Monetization · Spark Meter · Situation Pass ·
                referrals · marketing notifications · gamification · paid
                acquisition
              </span>
              <span>
                <b>Reminder rule</b>Explicit user reminders only.
                Neutral private copy; reminder opens are{" "}
                <em>reminder-assisted</em>, never organic.
              </span>
            </div>
          </details>
        </section>
      )}
      <article className="card metrics">
        <div className="card-title">
          <div>
            <p className="eyebrow">DECISION METRICS</p>
            <h3>Measure the real loop</h3>
          </div>
          <span>{data.canEdit ? "Editable by Sarthak" : "View only"}</span>
        </div>
        <div className="metric-table">
          <div className="metric-row head">
            <span>Metric</span>
            <span>Target</span>
            <span>Actual</span>
            <span>Completed</span>
          </div>
          {local.metrics.map((m) => (
            <div className="metric-row" key={m.id}>
              <span>
                <b>{m.name}</b>
                <small>{m.category}</small>
              </span>
              <div className="metric-target">
                <b>
                  {m.valueType === "percent"
                    ? `≥ ${m.target}%`
                    : `≥ ${m.target}${m.targetDenominator ? `/${m.targetDenominator}` : ""}`}
                </b>
                <small>benchmark</small>
              </div>
              <div className="metric-actual">
                <input
                  disabled={!data.canEdit}
                  type="number"
                  min="0"
                  aria-label={`${m.name} completed count`}
                  placeholder="Done"
                  value={m.actual ?? ""}
                  onChange={(e) => update(m, "actual", e.target.value)}
                  onBlur={() => {
                    const cur = local.metrics.find((x) => x.id === m.id) || m;
                    void save(
                      "metric",
                      {
                        target: cur.target,
                        actual: cur.actual,
                        actualDenominator: cur.actualDenominator,
                      },
                      m.id,
                    );
                  }}
                />
                {m.valueType !== "number" && (
                  <>
                    <span>/</span>
                    <input
                      disabled={!data.canEdit}
                      type="number"
                      min="0"
                      aria-label={`${m.name} total count`}
                      placeholder="Total"
                      value={m.actualDenominator ?? ""}
                      onChange={(e) =>
                        update(m, "actualDenominator", e.target.value)
                      }
                      onBlur={() => {
                        const cur =
                          local.metrics.find((x) => x.id === m.id) || m;
                        void save(
                          "metric",
                          {
                            target: cur.target,
                            actual: cur.actual,
                            actualDenominator: cur.actualDenominator,
                          },
                          m.id,
                        );
                      }}
                    />
                  </>
                )}
                <small>{metricActual(m)}</small>
              </div>
              <b
                className={`metric-completion ${
                  metricPercent(m) === null
                    ? "pending"
                    : passes(m)
                      ? "pass"
                      : "fail"
                }`}
              >
                {metricPercent(m) === null ? "—" : `${metricPercent(m)}%`}
              </b>
              {m.definition && (
                <p className="metric-definition">{m.definition}</p>
              )}
            </div>
          ))}
        </div>
      </article>
      {false && phaseZero && (
        <>
          <article className="card evidence-snapshot">
            <div className="card-title">
              <div>
                <p className="eyebrow">EVIDENCE SNAPSHOT</p>
                <h3>Minimum evidence before Phase 1</h3>
              </div>
              <span>Private cohort data</span>
            </div>
            <div className="evidence-stats">
              <span>
                <b>
                  {participants.filter((p) => p.status !== "dropped").length}/10
                </b>
                eligible participants
              </span>
              <span>
                <b>
                  {participants.filter((p) => p.meaningfulActivation).length}/8
                </b>
                meaningful situations
              </span>
              <span>
                <b>
                  {participants.reduce((n, p) => n + p.genuineRequestCount, 0)}
                  /50
                </b>
                genuine requests
              </span>
              <span>
                <b>
                  {participants.reduce(
                    (n, p) => n + p.usefulnessResponseCount,
                    0,
                  )}
                  /30
                </b>
                usefulness responses
              </span>
              <span>
                <b>
                  {participants.reduce((n, p) => n + p.reminderTestCount, 0)}/20
                </b>
                reminder tests
              </span>
            </div>
          </article>
          <article className="card trust-gates">
            <div className="card-title">
              <div>
                <p className="eyebrow">TRUST & RELEASE GATES</p>
                <h3>Hard-zero requirements</h3>
                <p>
                  One incident or unresolved blocker prevents advancement. These
                  are never averaged into a score.
                </p>
              </div>
              <span>
                {releaseGates.filter((gate) => gate.actual !== 0).length
                  ? "Blocked"
                  : "All clear"}
              </span>
            </div>
            <div className="gate-list">
              {releaseGates.map((gate) => (
                <label key={gate.id}>
                  <span>{gate.name}</span>
                  <input
                    disabled={!data.canEdit}
                    type="number"
                    min="0"
                    defaultValue={gate.actual}
                    onBlur={(event) =>
                      void save(
                        "release_gate",
                        { actual: Number(event.target.value) },
                        gate.id,
                      )
                    }
                  />
                  <b className={gate.actual === 0 ? "pass" : "fail"}>
                    {gate.actual === 0
                      ? "0 · clear"
                      : `${gate.actual} · blocking`}
                  </b>
                </label>
              ))}
            </div>
          </article>
        </>
      )}
      <div className="launch-bottom">
        <article className={`card checklist ${checklistComplete ? "complete" : ""}`}>
          <div className="card-title">
            <div>
              <p className="eyebrow">PHASE 0</p>
              <h3>Checklist</h3>
            </div>
            <div className="checklist-actions">
              <span className={checklistComplete ? "checklist-status done" : "checklist-status"}>
                {checklistComplete ? "Complete" : local.status === "active" ? "In progress" : "Not started"}
              </span>
              <button
                className="outline"
                disabled={!data.canEdit || checklistComplete}
                onClick={() => void save("start", undefined, local.id)}
              >
                {checklistComplete ? "Done" : "Start"}
              </button>
            </div>
          </div>
          {local.checks.map((c) => (
            <label className={c.completed ? "checked" : ""} key={c.id}>
              <input
                disabled={!data.canEdit}
                type="checkbox"
                checked={c.completed}
                onChange={(e) =>
                  void save("check", { completed: e.target.checked }, c.id)
                }
              />
              {c.label}
            </label>
          ))}
        </article>
        <article className={`advance-card ${phaseCanAdvance ? "ready" : ""}`}>
          <h3>
            {phaseCanAdvance
              ? "This phase earned the next cohort."
              : "Keep improving this phase."}
          </h3>
          <p>
            {phaseCanAdvance ? (
              "Every benchmark and checklist item is complete."
            ) : (
              <>
                <b>{unmetRequirements.length} exact requirements remain.</b>
                <span className="unmet-list">
                  {unmetRequirements.slice(0, 5).join(" · ")}
                  {unmetRequirements.length > 5 ? " · …" : ""}
                </span>
              </>
            )}
          </p>
          <button
            disabled={
              !data.canEdit || !phaseCanAdvance || local.status === "complete"
            }
            className="primary"
            onClick={() => setShowAdvanceConfirm(true)}
          >
            {local.status === "complete" ? "Phase complete" : "Advance phase →"}
          </button>
        </article>
      </div>
      {false && phaseZero && data.canEdit && (
        <article className="card cohort-evidence">
          <div className="card-title">
            <div>
              <p className="eyebrow">PRIVATE COHORT EVIDENCE</p>
              <h3>Anonymous participant evidence</h3>
              <p>
                Only Sarthak can view or edit this data. Do not add names,
                contact details, stories or screenshots.
              </p>
            </div>
            <button
              className="outline"
              onClick={() => setCohortDraft(newParticipant())}
            >
              Add participant
            </button>
          </div>
          <div className="cohort-summary">
            <span>
              <b>{cohortSummary.independent}</b>independently activated
            </span>
            <span>
              <b>{cohortSummary.assisted}</b>assisted activation
            </span>
            <span>
              <b>{cohortSummary.inactive}</b>not activated
            </span>
            <span className={cohortSummary.issues ? "warn" : ""}>
              <b>{cohortSummary.issues}</b>unresolved issues
            </span>
          </div>
          <div className="cohort-controls">
            <input
              placeholder="Search P0-001…"
              value={cohortSearch}
              onChange={(event) => setCohortSearch(event.target.value)}
            />
            <select
              value={cohortFilter}
              onChange={(event) => setCohortFilter(event.target.value)}
            >
              <option value="all">All participants</option>
              <option value="invited">Invited</option>
              <option value="activated">Activated</option>
              <option value="independent">Independent</option>
              <option value="issues">Issues</option>
            </select>
          </div>
          {filteredParticipants.length ? (
            <div className="cohort-table">
              <div className="cohort-row cohort-head">
                <span>ID</span>
                <span>Status</span>
                <span>Activation</span>
                <span>Requests</span>
                <span>Reminder</span>
                <span>Issues</span>
                <span />
              </div>
              {filteredParticipants.map((participant) => (
                <div className="cohort-row" key={participant.id}>
                  <b>{participant.participantId}</b>
                  <span>{participant.status}</span>
                  <span>
                    {participant.independentlyActivated
                      ? "Independent"
                      : participant.meaningfulActivation
                        ? "Assisted"
                        : "Not activated"}
                  </span>
                  <span>{participant.genuineRequestCount}</span>
                  <span>
                    {participant.reminderTestCount
                      ? `${participant.reminderTestCount} tested`
                      : "Not tested"}
                  </span>
                  <span
                    className={
                      participant.productIssue || participant.trustConcern
                        ? "fail"
                        : "pass"
                    }
                  >
                    {participant.productIssue || participant.trustConcern
                      ? "Review"
                      : "Clear"}
                  </span>
                  <button
                    className="text-button"
                    onClick={() => setCohortDraft({ ...participant })}
                  >
                    Edit
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="cohort-empty">
              <b>No anonymous participants yet.</b>
              <span>
                Add P0-001 when you recruit the first eligible participant.
              </span>
            </div>
          )}
          {cohortDraft && (
            <div className="cohort-editor">
              <div className="card-title">
                <div>
                  <p className="eyebrow">
                    {cohortDraft.id ? "EDIT PARTICIPANT" : "ADD PARTICIPANT"}
                  </p>
                  <h3>{cohortDraft.participantId}</h3>
                </div>
                <button
                  className="text-button"
                  onClick={() => setCohortDraft(null)}
                >
                  Close
                </button>
              </div>
              <div className="cohort-form">
                <label>
                  Anonymous ID
                  <input
                    value={cohortDraft.participantId}
                    onChange={(event) =>
                      setCohortDraft({
                        ...cohortDraft,
                        participantId: event.target.value.toUpperCase(),
                      })
                    }
                  />
                </label>
                <label>
                  Status
                  <select
                    value={cohortDraft.status}
                    onChange={(event) =>
                      setCohortDraft({
                        ...cohortDraft,
                        status: event.target.value,
                      })
                    }
                  >
                    {[
                      "invited",
                      "onboarded",
                      "activated",
                      "completed",
                      "dropped",
                    ].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Age band
                  <select
                    value={cohortDraft.ageBand}
                    onChange={(event) =>
                      setCohortDraft({
                        ...cohortDraft,
                        ageBand: event.target.value,
                      })
                    }
                  >
                    {["18–20", "21–24", "25–28", "other"].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Relationship state
                  <select
                    value={cohortDraft.relationshipState}
                    onChange={(event) =>
                      setCohortDraft({
                        ...cohortDraft,
                        relationshipState: event.target.value,
                      })
                    }
                  >
                    {[
                      "relationship",
                      "talking-stage",
                      "dating",
                      "conflict",
                      "breakup",
                      "other",
                    ].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Recruitment source
                  <input
                    value={cohortDraft.recruitmentSource}
                    onChange={(event) =>
                      setCohortDraft({
                        ...cohortDraft,
                        recruitmentSource: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Situation category
                  <select
                    value={cohortDraft.situationCategory}
                    onChange={(event) =>
                      setCohortDraft({
                        ...cohortDraft,
                        situationCategory: event.target.value,
                      })
                    }
                  >
                    {["reply-help", "repair", "planning", "other"].map(
                      (value) => (
                        <option key={value}>{value}</option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  Genuine requests
                  <input
                    type="number"
                    min="0"
                    value={cohortDraft.genuineRequestCount}
                    onChange={(event) =>
                      setCohortDraft({
                        ...cohortDraft,
                        genuineRequestCount: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Usefulness responses
                  <input
                    type="number"
                    min="0"
                    value={cohortDraft.usefulnessResponseCount}
                    onChange={(event) =>
                      setCohortDraft({
                        ...cohortDraft,
                        usefulnessResponseCount: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Reminder tests
                  <input
                    type="number"
                    min="0"
                    value={cohortDraft.reminderTestCount}
                    onChange={(event) =>
                      setCohortDraft({
                        ...cohortDraft,
                        reminderTestCount: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Return source
                  <select
                    value={cohortDraft.returnSource}
                    onChange={(event) =>
                      setCohortDraft({
                        ...cohortDraft,
                        returnSource: event.target.value,
                      })
                    }
                  >
                    {[
                      "organic",
                      "reminder-assisted",
                      "founder-prompted",
                      "referral",
                      "internal-test",
                      "unknown",
                    ].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label>
                  First answer useful
                  <select
                    value={cohortDraft.firstAnswerUseful}
                    onChange={(event) =>
                      setCohortDraft({
                        ...cohortDraft,
                        firstAnswerUseful: event.target
                          .value as CohortParticipant["firstAnswerUseful"],
                      })
                    }
                  >
                    {["not-rated", "yes", "no"].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Notion reference URL
                  <input
                    placeholder="https://www.notion.so/..."
                    value={cohortDraft.notionReferenceUrl}
                    onChange={(event) =>
                      setCohortDraft({
                        ...cohortDraft,
                        notionReferenceUrl: event.target.value,
                      })
                    }
                  />
                </label>
              </div>
              <div className="cohort-toggles">
                {[
                  ["Close friend or teammate", "closeFriendOrTeammate"],
                  ["Onboarding completed", "onboardingCompleted"],
                  ["Meaningful activation", "meaningfulActivation"],
                  ["Independently activated", "independentlyActivated"],
                  ["Reminder tested", "reminderTested"],
                  ["Trust concern", "trustConcern"],
                  ["Product issue", "productIssue"],
                  ["Founder explained product", "founderExplainedProduct"],
                  ["Founder helped onboarding", "founderHelpedOnboarding"],
                  ["Founder suggested situation", "founderSuggestedSituation"],
                  ["Founder helped formulate request", "founderHelpedRequest"],
                  ["Founder solved product problem", "founderSolvedProblem"],
                  ["Founder prompted return", "founderPromptedReturn"] as const,
                ].map(([label, key]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={cohortDraft[key]}
                      onChange={(event) =>
                        setCohortDraft({
                          ...cohortDraft,
                          [key]: event.target.checked,
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
              <label className="evidence-note">
                Sanitized evidence note
                <textarea
                  maxLength={280}
                  placeholder="No names, message content or relationship story."
                  value={cohortDraft.evidenceNote}
                  onChange={(event) =>
                    setCohortDraft({
                      ...cohortDraft,
                      evidenceNote: event.target.value,
                    })
                  }
                />
              </label>
              <div className="cohort-actions">
                <button
                  className="primary"
                  onClick={() =>
                    void save(
                      cohortDraft.id ? "cohort_update" : "cohort_create",
                      cohortDraft as unknown as Record<string, unknown>,
                      cohortDraft.id || undefined,
                    ).then(() => setCohortDraft(null))
                  }
                >
                  Save participant
                </button>
                {cohortDraft.id && (
                  <button
                    className="text-button danger"
                    onClick={() => {
                      if (confirm(`Delete ${cohortDraft.participantId}?`))
                        void save(
                          "cohort_delete",
                          undefined,
                          cohortDraft.id,
                        ).then(() => setCohortDraft(null));
                    }}
                  >
                    Delete participant
                  </button>
                )}
              </div>
            </div>
          )}
        </article>
      )}
      {phaseZero && (
        <section className="phase-zero-reference">
          <details>
            <summary>Diagnostic signals: not advancement gates</summary>
            <p>
              Answer latency · reminder open and completion rates · sessions per
              participant · requests per activated participant · permission
              acceptance · situation category · relationship state · founder
              interventions · return source · second-situation attempts ·
              feedback themes · confusion points.
            </p>
            <em>These help diagnose Phase 0. They cannot pass or fail it.</em>
          </details>
          <details>
            <summary>Founder operating rules</summary>
            <p>
              Sarthak may recruit users and explain why Sparkeefy exists. He
              must not tell participants what to ask, write their situation,
              navigate every screen, ask them to return, manufacture a second
              situation or count internal testing.
            </p>
            <b>
              Founder-recruited is acceptable. Founder-operated is not
              independent evidence.
            </b>
          </details>
          <details>
            <summary>Analytics event reference</summary>
            <p>
              <b>Onboarding:</b> onboarding_started · onboarding_completed ·
              onboarding_abandoned
              <br />
              <b>Wingman:</b> wingman_opened · situation_submitted ·
              response_started · response_completed · response_failed ·
              response_rated · person_context_created · person_context_retrieved
              <br />
              <b>Reminders:</b> reminder_created · reminder_edited ·
              reminder_scheduled · reminder_delivered · reminder_opened ·
              reminder_completed · reminder_dismissed · reminder_deleted ·
              notification_permission_requested · notification_permission_result
              <br />
              <b>Attribution:</b> session_started · return_source_classified ·
              founder_intervention_recorded
            </p>
            <em>
              Return source values: organic, reminder-assisted,
              founder-prompted, referral, internal-test, unknown. Unknown never
              defaults to organic. This is a measurement contract; it does not
              claim unverified mobile instrumentation.
            </em>
          </details>
        </section>
      )}
      {showAdvanceConfirm && (
        <div className="confirm-modal" role="dialog" aria-modal="true">
          <div>
            <p className="eyebrow">CONFIRM ADVANCEMENT</p>
            <h3>Advance Phase 0?</h3>
            <p>
              Phase 0 confirms release readiness only. It does not confirm
              retention, product-market fit or readiness to scale acquisition.
            </p>
            <div>
              <button
                className="outline"
                onClick={() => setShowAdvanceConfirm(false)}
              >
                Cancel
              </button>
              <button
                className="primary"
                onClick={() => {
                  setShowAdvanceConfirm(false);
                  void save("advance", { confirmed: true }, local.id);
                }}
              >
                Confirm advance
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Suggestions({
  data,
  phases,
  save,
  notice,
}: {
  data: SuggestionsData;
  phases: Phase[];
  save: (a: string, p?: Record<string, unknown>, id?: string) => Promise<void>;
  notice: (m: string) => void;
}) {
  const [form, setForm] = useState({
      title: "",
      body: "",
      category: "Product",
      priority: "medium",
      phaseId: "",
    }),
    [active, setActive] = useState<string | null>(null),
    [reply, setReply] = useState(""),
    [filter, setFilter] = useState("all");
  const items = data.suggestions.filter(
      (s) => filter === "all" || s.status === filter,
    ),
    selected = data.suggestions.find((s) => s.id === active),
    replies = data.replies.filter((r) => r.suggestion_id === active),
    votes = (id: string) =>
      Number(data.votes.find((v) => v.suggestion_id === id)?.count || 0);
  async function create(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.body.trim()) return;
    await save("suggestion_create", form);
    setForm({
      title: "",
      body: "",
      category: "Product",
      priority: "medium",
      phaseId: "",
    });
    notice("Suggestion shared with the team.");
  }
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!active || !reply.trim()) return;
    await save("suggestion_reply", { body: reply }, active);
    setReply("");
  }
  return (
    <section className="page suggestions">
      <header className="page-head">
        <div>
          <p className="eyebrow">TEAM DISCUSSION</p>
          <h1>Make the next idea visible.</h1>
          <p>A thoughtful backlog of product, growth and launch ideas.</p>
        </div>
        <div className="completion">
          <b>
            {
              data.suggestions.filter(
                (s) => !["shipped", "archived"].includes(s.status),
              ).length
            }
          </b>
          <span>open ideas</span>
        </div>
      </header>
      <div className="suggestion-layout">
        <div>
          <article className="card composer">
            <div className="card-title">
              <div>
                <p className="eyebrow">NEW SUGGESTION</p>
                <h3>What should Sparkeefy learn or build?</h3>
              </div>
            </div>
            <form onSubmit={create}>
              <input
                placeholder="A clear, specific title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
              <textarea
                placeholder="Context, user problem, proposed solution and why it matters…"
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
              />
              <div className="form-row">
                <select
                  value={form.category}
                  onChange={(e) =>
                    setForm({ ...form, category: e.target.value })
                  }
                >
                  {[
                    "Product",
                    "Wingman",
                    "Spark Meter",
                    "Notifications",
                    "Growth",
                    "Design",
                    "Bug",
                    "Other",
                  ].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
                <select
                  value={form.priority}
                  onChange={(e) =>
                    setForm({ ...form, priority: e.target.value })
                  }
                >
                  <option value="low">Low priority</option>
                  <option value="medium">Medium priority</option>
                  <option value="high">High priority</option>
                </select>
                <select
                  value={form.phaseId}
                  onChange={(e) =>
                    setForm({ ...form, phaseId: e.target.value })
                  }
                >
                  <option value="">No phase yet</option>
                  {phases.map((p) => (
                    <option key={p.id} value={p.id}>
                      Phase {p.position}: {p.name}
                    </option>
                  ))}
                </select>
                <button className="primary">Share idea</button>
              </div>
            </form>
          </article>
          <div className="feed-tools">
            <b>Suggestions</b>
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All status</option>
              {[
                "new",
                "reviewing",
                "planned",
                "shipped",
                "not now",
                "archived",
              ].map((x) => (
                <option key={x} value={x}>
                  {titleCase(x)}
                </option>
              ))}
            </select>
          </div>
          <div className="suggestion-feed">
            {items.map((s) => (
              <article
                className={`suggestion ${active === s.id ? "open" : ""}`}
                key={s.id}
                onClick={() => setActive(s.id)}
              >
                <button
                  className="vote"
                  onClick={(e) => {
                    e.stopPropagation();
                    void save("suggestion_vote", undefined, s.id);
                  }}
                >
                  ↑<b>{votes(s.id)}</b>
                </button>
                <div>
                  <div className="suggestion-tags">
                    {s.pinned === 1 && <span className="pinned">Pinned</span>}
                    <span>{s.category}</span>
                    <span className={`status ${s.status.replace(" ", "-")}`}>
                      {titleCase(s.status)}
                    </span>
                  </div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                  <small>
                    {s.author_email.split("@")[0]} ·{" "}
                    {new Date(s.created_at).toLocaleDateString("en-IN")} ·{" "}
                    {
                      data.replies.filter((r) => r.suggestion_id === s.id)
                        .length
                    }{" "}
                    replies
                  </small>
                </div>
              </article>
            ))}
            {items.length === 0 && (
              <p className="empty">No suggestions here yet.</p>
            )}
          </div>
        </div>
        <aside className="discussion">
          {selected ? (
            <>
              <div className="discussion-head">
                <div>
                  <p className="eyebrow">DISCUSSION</p>
                  <h3>{selected.title}</h3>
                </div>
                <button className="text-button" onClick={() => setActive(null)}>
                  Close
                </button>
              </div>
              <p>{selected.body}</p>
              {data.canEdit && (
                <div className="founder-controls">
                  <select
                    value={selected.status}
                    onChange={(e) =>
                      void save(
                        "suggestion_manage",
                        {
                          status: e.target.value,
                          pinned: selected.pinned === 1,
                          founderPriority: selected.founder_priority === 1,
                          founderNote: selected.founder_note,
                          phaseId: selected.phase_id,
                        },
                        selected.id,
                      )
                    }
                  >
                    {[
                      "new",
                      "reviewing",
                      "planned",
                      "shipped",
                      "not now",
                      "archived",
                    ].map((x) => (
                      <option key={x} value={x}>
                        {titleCase(x)}
                      </option>
                    ))}
                  </select>
                  <button
                    className="outline"
                    onClick={() =>
                      void save(
                        "suggestion_manage",
                        {
                          status: selected.status,
                          pinned: selected.pinned !== 1,
                          founderPriority: selected.founder_priority === 1,
                          founderNote: selected.founder_note,
                          phaseId: selected.phase_id,
                        },
                        selected.id,
                      )
                    }
                  >
                    {selected.pinned ? "Unpin" : "Pin"}
                  </button>
                </div>
              )}
              <div className="replies">
                {replies.map((r) => (
                  <div
                    className={
                      r.author_email === data.viewerEmail
                        ? "reply mine"
                        : "reply"
                    }
                    key={r.id}
                  >
                    <b>
                      {r.author_email === data.viewerEmail
                        ? "You"
                        : r.author_email.split("@")[0]}
                    </b>
                    <p>{r.body}</p>
                  </div>
                ))}
              </div>
              <form className="reply-form" onSubmit={send}>
                <textarea
                  placeholder="Add a thoughtful reply…"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                />
                <button className="primary">Reply</button>
              </form>
            </>
          ) : (
            <div className="discussion-empty">
              <span>✦</span>
              <h3>Open an idea</h3>
              <p>
                Read the context, discuss it and decide what deserves attention.
              </p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function App() {
  const [tracker, setTracker] = useState<Tracker | null>(null),
    [founder, setFounder] = useState<FounderData | null>(null),
    [suggestions, setSuggestions] = useState<SuggestionsData | null>(null),
    [needsLogin, setNeedsLogin] = useState(false),
    [view, setView] = useState(location.pathname.split("/")[1] || "launch"),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const flash = (m: string) => {
    setNotice(m);
    window.setTimeout(() => setNotice(""), 2600);
  };
  async function loadTracker() {
    const r = await fetch("/api/tracker");
    if (r.status === 401) {
      setNeedsLogin(true);
      return null;
    }
    if (!r.ok) throw Error("Unable to load Launch Control.");
    const d = (await r.json()) as Tracker;
    setTracker(d);
    setNeedsLogin(false);
    return d;
  }
  async function loadWorkspace(name: string) {
    const r = await fetch(`/api/workspace?view=${name}`);
    if (!r.ok) {
      if (r.status === 403) {
        history.replaceState({}, "", "/launch");
        setView("launch");
        return;
      }
      throw Error("Unable to load workspace.");
    }
    if (name === "sarthak") setFounder((await r.json()) as FounderData);
    else setSuggestions((await r.json()) as SuggestionsData);
  }
  async function load() {
    try {
      setError("");
      const t = await loadTracker();
      if (!t) return;
      if (t.canEdit) await loadWorkspace("sarthak");
      await loadWorkspace("suggestions");
      if (!t.canEdit && view === "sarthak") {
        setView("launch");
        history.replaceState({}, "", "/launch");
      }
    } catch (x) {
      setError(
        x instanceof Error ? x.message : "Unable to load Launch Control.",
      );
    }
  }
  useEffect(() => {
    void load();
    const h = () => setView(location.pathname.split("/")[1] || "launch");
    addEventListener("popstate", h);
    return () => removeEventListener("popstate", h);
  }, []);
  async function launchSave(
    action: string,
    patch?: Record<string, unknown>,
    id?: string,
  ) {
    if (!tracker) return;
    const payload = [
      "metric",
      "check",
      "release_gate",
      "cohort_create",
      "cohort_update",
      "cohort_delete",
    ].includes(action)
      ? { action, id, patch }
      : { action, phaseId: id, patch };
    const r = await fetch("/api/tracker", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = (await r.json()) as Tracker & { error?: string };
    if (!r.ok) {
      setError(d.error || "Unable to save launch data.");
      return;
    }
    setTracker(d);
    flash("Launch Control saved.");
  }
  async function founderSave(
    action: string,
    patch?: Record<string, unknown>,
    id?: string,
  ) {
    const r = await fetch("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, id, patch }),
    });
    const d = (await r.json()) as FounderData & { error?: string };
    if (!r.ok) {
      setError(d.error || "Unable to save.");
      throw Error(d.error || "Unable to save.");
    }
    setFounder(d);
  }
  async function suggestionSave(
    action: string,
    patch?: Record<string, unknown>,
    id?: string,
  ) {
    const r = await fetch("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, suggestionId: id, patch }),
    });
    const d = (await r.json()) as SuggestionsData & { error?: string };
    if (!r.ok) {
      setError(d.error || "Unable to save suggestion.");
      return;
    }
    setSuggestions(d);
  }
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setNeedsLogin(true);
    setTracker(null);
  }
  if (needsLogin)
    return (
      <Login
        onSuccess={() => {
          history.replaceState({}, "", "/sarthak");
          setView("sarthak");
          void load();
        }}
      />
    );
  if (!tracker)
    return (
      <main className="loading">{error || "Preparing Launch Control…"}</main>
    );
  return (
    <main className="operating-system">
      <Sidebar
        view={view}
        setView={setView}
        canEdit={tracker.canEdit}
        email={tracker.viewerEmail}
        onLogout={() => void logout()}
        suggestionCount={
          suggestions?.suggestions.filter((s) => s.status === "new").length || 0
        }
      />
      <div className="main-area">
        {error && <div className="error toast-error">{error}</div>}
        {notice && <div className="toast">{notice}</div>}
        {view === "sarthak" && tracker.canEdit && founder && (
          <SarthakV3 data={founder} save={founderSave} notice={flash} />
        )}{" "}
        {view === "launch" && <Launch data={tracker} save={launchSave} />}{" "}
        {view === "suggestions" && suggestions && (
          <Suggestions
            data={suggestions}
            phases={tracker.phases}
            save={suggestionSave}
            notice={flash}
          />
        )}
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
