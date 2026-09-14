// lib/vercel-database.ts
import { AsyncLocalStorage } from "node:async_hooks";
import { createClient } from "@libsql/client";
var client;
var context = new AsyncLocalStorage();
function connection() {
  if (!client) {
    const isolated = process.env.VERCEL_ENV === "preview";
    const url = isolated ? process.env.V2_TURSO_DATABASE_URL : process.env.TURSO_DATABASE_URL;
    if (!url) throw Error("TURSO_DATABASE_URL is required.");
    if (isolated && url === process.env.TURSO_DATABASE_URL) throw Error("Preview must not use production storage.");
    client = createClient({ url, authToken: isolated ? process.env.V2_TURSO_AUTH_TOKEN : process.env.TURSO_AUTH_TOKEN });
  }
  return client;
}
function result(data) {
  return { results: data.rows.map((row) => Object.fromEntries(data.columns.map((name) => [name, row[name]]))), success: true, meta: { changes: data.rowsAffected, last_row_id: Number(data.lastInsertRowid ?? 0) } };
}
var Statement = class _Statement {
  constructor(sql, args = []) {
    this.sql = sql;
    this.args = args;
  }
  bind(...args) {
    return new _Statement(this.sql, args);
  }
  async all() {
    return result(await (context.getStore() ?? connection()).execute({ sql: this.sql, args: this.args }));
  }
  async first(column) {
    const { results } = await this.all();
    return results.length ? column ? results[0][column] : results[0] : null;
  }
  async run() {
    return this.all();
  }
};
var database = {
  prepare: (sql) => new Statement(sql),
  async batch(statements) {
    const tx = context.getStore();
    if (tx) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    }
    return (await connection().batch(statements.map(({ sql, args }) => ({ sql, args })), "write")).map(result);
  }
};
async function withWriteTransaction(run) {
  const tx = await connection().transaction("write");
  try {
    const response = await context.run(tx, run);
    if (response.ok) await tx.commit();
    else await tx.rollback();
    return response;
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}

// lib/runtime-env.ts
var env = new Proxy({ DB: database }, {
  get(target, key) {
    return key === "DB" ? target.DB : process.env[String(key)];
  }
});

// lib/auth.ts
var EDITOR_EMAIL = "sarthakverma0802@gmail.com";
var SESSION_COOKIE = "sparkeefy_launch_session";
var SESSION_SECONDS = 60 * 60 * 24 * 7;
var ALLOWED_EMAILS = /* @__PURE__ */ new Set([
  EDITOR_EMAIL,
  "ashmitsinghbhadoria1975@gmail.com",
  "nabeelahmad.dbg@gmail.com",
  "yogiroshan2005@gmail.com",
  "fahadchampion1@gmail.com",
  "aniketraj08309@gmail.com",
  "rahulpandey.creates@gmail.com"
]);
function runtimeSecret(key) {
  const value = env[key];
  if (!value) throw new Error(`Missing required runtime setting: ${key}.`);
  return value;
}
function encode(value) {
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function decode(value) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  return atob(base64);
}
function cookieValue(request, name) {
  const item = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item ? item.slice(name.length + 1) : null;
}
async function sign(value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(runtimeSecret("SPARKEEFY_SESSION_SECRET")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return encode(String.fromCharCode(...new Uint8Array(signature)));
}
async function signaturesMatch(left, right) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let different = 0;
  for (let index = 0; index < leftBytes.length; index += 1) different |= leftBytes[index] ^ rightBytes[index];
  return different === 0;
}
function normaliseEmail(email) {
  return email.trim().toLowerCase();
}
function emailIsAllowed(email) {
  return ALLOWED_EMAILS.has(normaliseEmail(email));
}
async function passwordMatches(candidate) {
  const expected = runtimeSecret("SPARKEEFY_LOGIN_PASSWORD");
  return signaturesMatch(await sha256(candidate), await sha256(expected));
}
async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return encode(String.fromCharCode(...new Uint8Array(digest)));
}
async function sessionCookie(email) {
  const payload = encode(JSON.stringify({ email, expiresAt: Date.now() + SESSION_SECONDS * 1e3 }));
  const signature = await sign(payload);
  return `${SESSION_COOKIE}=${payload}.${signature}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}
function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
async function getSession(request) {
  if (!process.env.SPARKEEFY_LOGIN_PASSWORD) return null;
  try {
    const session = cookieValue(request, SESSION_COOKIE);
    if (!session) return null;
    const separator = session.lastIndexOf(".");
    if (separator < 1) return null;
    const payload = session.slice(0, separator);
    const signature = session.slice(separator + 1);
    if (!await signaturesMatch(signature, await sign(payload))) return null;
    const parsed = JSON.parse(decode(payload));
    if (!emailIsAllowed(parsed.email) || parsed.expiresAt <= Date.now()) return null;
    return { email: normaliseEmail(parsed.email), expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}
async function trackerAccess(request) {
  const session = await getSession(request);
  return {
    authenticated: Boolean(session),
    viewerEmail: session?.email ?? null,
    canEdit: session?.email === EDITOR_EMAIL
  };
}

// lib/tracker-types.ts
function metricPassed(metric) {
  if (metric.actual === null || Number.isNaN(metric.actual)) return false;
  if (metric.valueType === "percent") {
    if (!metric.actualDenominator || metric.actualDenominator <= 0)
      return false;
    if (metric.minimumDenominator && metric.actualDenominator < metric.minimumDenominator)
      return false;
    return metric.actual / metric.actualDenominator * 100 >= metric.target;
  }
  if (metric.valueType === "fraction") {
    if (!metric.actualDenominator || metric.actualDenominator <= 0)
      return false;
    if (metric.minimumDenominator && metric.actualDenominator < metric.minimumDenominator)
      return false;
    if (metric.targetDenominator && metric.actualDenominator < metric.targetDenominator)
      return false;
    return metric.actual >= metric.target;
  }
  if (metric.comparator === "lte") return metric.actual <= metric.target;
  if (metric.comparator === "eq") return metric.actual === metric.target;
  return metric.actual >= metric.target;
}

// lib/posthog.ts
var unavailable = (source = "backend") => ({
  count: null,
  status: "unavailable",
  source
});

// lib/analytics-v2/source-backend.ts
import { createHmac } from "node:crypto";
var KNOWN = [
  "activity",
  "app-return",
  "onboarding",
  "people",
  "memory",
  "wingman",
  "responses",
  "sessions",
  "situations",
  "activation",
  "people-use",
  "attribution",
  "retries",
  "fallbacks",
  "latency",
  "tokens",
  "cost"
];
var ATTRIBUTIONS = ["organic", "reminder", "founder", "unknown"];
function backendConfig() {
  const baseUrl = process.env.V2_SPARKEEFY_BACKEND_URL;
  const adminKey = process.env.V2_SPARKEEFY_BACKEND_ADMIN_KEY;
  if (!baseUrl || !adminKey) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ""), adminKey };
}
async function fetchBackendAnalytics() {
  const config = backendConfig();
  if (!config) throw Error("Backend admin URL/key not configured");
  const response = await fetch(`${config.baseUrl}/api/admin/analytics/v2`, {
    headers: { "x-admin-api-key": config.adminKey },
    signal: AbortSignal.timeout(1e4)
  });
  if (!response.ok) throw Error(`Backend responded ${response.status}`);
  const body = await response.json();
  if (!body.data || !Array.isArray(body.data.facts) || !Array.isArray(body.data.members))
    throw Error("Unexpected backend response shape");
  return body.data;
}
function internalIds() {
  return new Set(
    (process.env.CONTROL_V2_INTERNAL_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  );
}
function cohortFor(firstOpenMs) {
  const boundary = (name) => {
    const v = process.env[name];
    return v && Number.isFinite(Date.parse(v)) ? Date.parse(v) : void 0;
  };
  const phase2 = boundary("CONTROL_V2_PHASE2_FROM");
  const phase1b = boundary("CONTROL_V2_PHASE1B_FROM");
  const phase1a = boundary("CONTROL_V2_PHASE1_FROM");
  if (phase2 !== void 0 && firstOpenMs >= phase2) return "phase-2";
  if (phase1b !== void 0 && firstOpenMs >= phase1b) return "phase-1b";
  if (phase1a !== void 0 && firstOpenMs >= phase1a) return "phase-1a";
  return "phase-0";
}
var names = /* @__PURE__ */ new Map();
function backendDisplayNames() {
  return names;
}
var cached;
var pending;
async function liveDatasetFromBackend() {
  if (cached && Date.now() - cached.at < 3e4) return cached.data;
  if (pending) return pending;
  pending = load().finally(() => {
    pending = void 0;
  });
  const data = await pending;
  cached = { at: Date.now(), data };
  return data;
}
async function load() {
  const base = {
    mode: "live",
    source: "Backend",
    state: "not-connected",
    detail: "Awaiting backend connection configuration.",
    asOf: (/* @__PURE__ */ new Date()).toISOString(),
    coverageFrom: (/* @__PURE__ */ new Date()).toISOString(),
    members: [],
    facts: [],
    capabilities: KNOWN
  };
  if (!process.env.V2_SPARKEEFY_BACKEND_URL || !process.env.V2_SPARKEEFY_BACKEND_ADMIN_KEY || !process.env.SPARKEEFY_SESSION_SECRET)
    return base;
  try {
    const secret = process.env.SPARKEEFY_SESSION_SECRET;
    const opaque = (value) => `participant-${createHmac("sha256", secret).update(value).digest("hex").slice(0, 16)}`;
    const remote = await fetchBackendAnalytics();
    const excluded = internalIds();
    const realMembers = remote.members.filter(
      (m) => typeof m.id === "string" && Number.isFinite(Date.parse(m.firstOpen))
    );
    if (!realMembers.length)
      return {
        ...base,
        state: "no-data",
        detail: "No real signups observed yet."
      };
    const coverageFrom = new Date(
      Math.min(...realMembers.map((m) => Date.parse(m.firstOpen)))
    ).toISOString();
    const allowed2 = realMembers.filter((m) => !excluded.has(m.id));
    const nextNames = /* @__PURE__ */ new Map();
    for (const m of realMembers) {
      const name = typeof m.name === "string" ? m.name.trim() : "";
      if (name) nextNames.set(opaque(m.id), name);
    }
    names = nextNames;
    base.members = realMembers.map((m) => ({
      id: opaque(m.id),
      cohort: cohortFor(Date.parse(m.firstOpen)),
      from: new Date(m.firstOpen).toISOString(),
      firstOpen: new Date(m.firstOpen).toISOString(),
      internal: excluded.has(m.id),
      test: false,
      acquisition: "unknown"
    }));
    base.coverageFrom = coverageFrom;
    if (!allowed2.length)
      return {
        ...base,
        state: "available",
        detail: "All observed signups are internal/test accounts."
      };
    const allowedIds = new Set(allowed2.map((m) => m.id));
    const facts = [];
    for (const row of remote.facts) {
      if (typeof row.user !== "string" || typeof row.at !== "string" || typeof row.kind !== "string" || !Number.isFinite(Date.parse(row.at)) || !allowedIds.has(row.user))
        continue;
      const owner = opaque(row.user);
      const fact = {
        id: `${owner}-${row.kind}-${row.at}-${facts.length}`,
        user: owner,
        kind: row.kind,
        at: new Date(row.at).toISOString()
      };
      if (row.request)
        fact.request = createHmac("sha256", owner).update(row.request).digest("hex");
      if (row.session)
        fact.session = createHmac("sha256", owner).update(row.session).digest("hex");
      if (row.person)
        fact.person = createHmac("sha256", owner).update(row.person).digest("hex");
      if (row.situation)
        fact.situation = createHmac("sha256", owner).update(row.situation).digest("hex");
      if (typeof row.attribution === "string" && ATTRIBUTIONS.includes(row.attribution))
        fact.attribution = row.attribution;
      if (typeof row.assisted === "boolean") fact.assisted = row.assisted;
      if (typeof row.people === "number" && Number.isFinite(row.people))
        fact.people = row.people;
      if (typeof row.memories === "number" && Number.isFinite(row.memories))
        fact.memories = row.memories;
      if (typeof row.latency === "number" && Number.isFinite(row.latency))
        fact.latency = row.latency;
      if (typeof row.input === "number" && Number.isFinite(row.input))
        fact.input = row.input;
      if (typeof row.output === "number" && Number.isFinite(row.output))
        fact.output = row.output;
      if (typeof row.cost === "number" && Number.isFinite(row.cost) && row.cost >= 0)
        fact.cost = row.cost;
      facts.push(fact);
    }
    let capabilities = KNOWN.filter((c) => remote.capabilities.includes(c));
    if (facts.some(
      (f) => ["message", "complete", "failed"].includes(f.kind) && !f.request
    ))
      capabilities = capabilities.filter((c) => c !== "wingman" && c !== "responses");
    if (facts.some((f) => f.kind === "person" && f.people === void 0))
      capabilities = capabilities.filter((c) => c !== "people");
    if (facts.some((f) => f.kind === "memory" && f.memories === void 0))
      capabilities = capabilities.filter((c) => c !== "memory");
    const usage = facts.filter((f) => f.kind === "usage");
    if (!usage.length || usage.some((f) => f.input === void 0 || f.output === void 0))
      capabilities = capabilities.filter((c) => c !== "tokens" && c !== "cost");
    if (usage.some((f) => f.cost === void 0))
      capabilities = capabilities.filter((c) => c !== "cost");
    return {
      ...base,
      state: "available",
      detail: "Backend Postgres (sparkeefy-backend) \xB7 live signup roster \xB7 30-second cache",
      capabilities,
      facts
    };
  } catch {
    names = /* @__PURE__ */ new Map();
    return {
      ...base,
      state: "query-error",
      detail: "V2 backend source query failed. No partial totals are shown.",
      facts: []
    };
  }
}

// lib/analytics-v2/phase0-backend.ts
var HOUR = 36e5;
var DAY = 24 * HOUR;
var IST_OFFSET_MS = 5.5 * HOUR;
var ACTIVE_KINDS = /* @__PURE__ */ new Set([
  "first_open",
  "onboarding",
  "person",
  "memory",
  "wingman",
  "message",
  "calendar"
]);
function group(data) {
  const members = data.members.filter((m) => !m.internal && !m.test);
  const facts = new Map(members.map((m) => [m.id, []]));
  for (const f of data.facts) {
    const list = facts.get(f.user);
    if (list) list.push(f);
  }
  return { members, facts };
}
function available(count, extra = {}) {
  return { count, status: "available", source: "backend", ...extra };
}
function usersWith(members, facts, pred) {
  return available(
    members.filter((m) => (facts.get(m.id) ?? []).some(pred)).length
  );
}
function requestOutcomes(facts) {
  const messages = /* @__PURE__ */ new Set(), complete = /* @__PURE__ */ new Set(), failed = /* @__PURE__ */ new Set();
  let retries = 0;
  for (const list of facts.values())
    for (const f of list) {
      const key = `${f.user}:${f.request ?? f.id}`;
      if (f.kind === "message") messages.add(key);
      else if (f.kind === "complete") complete.add(key);
      else if (f.kind === "failed") failed.add(key);
      else if (f.kind === "retry") retries++;
    }
  for (const key of complete) failed.delete(key);
  return {
    messages: messages.size,
    complete: complete.size,
    failed: failed.size,
    retries
  };
}
function dayWindow(members, facts, kind, dayIndex, minimumEvents, now3) {
  let eligible = 0, returned = 0, pending2 = 0;
  for (const m of members) {
    if (!m.firstOpen) continue;
    const start = Date.parse(m.firstOpen) + (dayIndex - 1) * DAY, end = start + DAY;
    if (now3 < start) {
      pending2++;
      continue;
    }
    eligible++;
    const seen = /* @__PURE__ */ new Set();
    for (const f of facts.get(m.id) ?? [])
      if (f.kind === kind) {
        const at = Date.parse(f.at);
        if (at >= start && at < end) seen.add(f.request ?? f.session ?? f.id);
      }
    if (seen.size >= minimumEvents) returned++;
  }
  return available(returned, { denominator: eligible, pending: pending2 });
}
function daysActive(members, facts, minDays) {
  let reached = 0, total = 0;
  for (const m of members) {
    if (!m.firstOpen) continue;
    total++;
    const first = Date.parse(m.firstOpen);
    const days = /* @__PURE__ */ new Set();
    for (const f of facts.get(m.id) ?? [])
      if (f.kind === "message") {
        const at = Date.parse(f.at);
        if (at >= first && at < first + 72 * HOUR)
          days.add(Math.floor((at - first) / DAY));
      }
    if (days.size >= minDays) reached++;
  }
  return available(reached, { denominator: total });
}
function istDayStart(now3) {
  return Math.floor((now3 + IST_OFFSET_MS) / DAY) * DAY - IST_OFFSET_MS;
}
function istWeekStart(now3) {
  const day = istDayStart(now3);
  const weekday = new Date(day + IST_OFFSET_MS).getUTCDay();
  return day - (weekday + 6) % 7 * DAY;
}
function istMonthStart(now3) {
  const d = new Date(now3 + IST_OFFSET_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - IST_OFFSET_MS;
}
function activeUsers(members, facts, since) {
  return usersWith(
    members,
    facts,
    (f) => ACTIVE_KINDS.has(f.kind) && Date.parse(f.at) >= since
  );
}
function organicSecond(members, facts) {
  let eligible = 0, organic = 0;
  for (const m of members) {
    const situations = (facts.get(m.id) ?? []).filter((f) => f.kind === "situation" && f.situation).sort((a, b) => a.at.localeCompare(b.at));
    const seen = /* @__PURE__ */ new Set();
    let second;
    for (const f of situations) {
      if (seen.has(f.situation)) continue;
      seen.add(f.situation);
      if (seen.size === 2) {
        second = f;
        break;
      }
    }
    if (seen.size === 0) continue;
    eligible++;
    if (second && (second.attribution ?? "organic") === "organic") organic++;
  }
  return available(organic, { denominator: eligible });
}
function personReused(members, facts) {
  let withPerson = 0, reused = 0;
  for (const m of members) {
    const list = facts.get(m.id) ?? [];
    if (!list.some((f) => f.kind === "person")) continue;
    withPerson++;
    const sessionsByPerson = /* @__PURE__ */ new Map();
    for (const f of list)
      if (f.kind === "message" && f.person && f.session) {
        const set = sessionsByPerson.get(f.person) ?? /* @__PURE__ */ new Set();
        set.add(f.session);
        sessionsByPerson.set(f.person, set);
      }
    if ([...sessionsByPerson.values()].some((set) => set.size >= 2)) reused++;
  }
  return available(reused, { denominator: withPerson });
}
function reminderReturn(members, facts) {
  let eligible = 0, returned = 0;
  for (const m of members) {
    const situations = (facts.get(m.id) ?? []).filter((f) => f.kind === "situation");
    if (!situations.length) continue;
    eligible++;
    if (situations.some((f) => f.attribution === "reminder")) returned++;
  }
  return available(returned, { denominator: eligible });
}
function topUsers(members, facts, names2, limit = 10) {
  return members.map((m) => ({
    distinctId: m.id,
    email: null,
    name: names2.get(m.id) ?? null,
    messageCount: new Set(
      (facts.get(m.id) ?? []).filter((f) => f.kind === "message").map((f) => f.request ?? f.id)
    ).size
  })).filter((u) => u.messageCount > 0).sort((a, b) => b.messageCount - a.messageCount).slice(0, limit);
}
var METRIC_KEYS = [
  "first_open",
  "onboarding",
  "first_answer",
  "wingman_open_day1",
  "first_message_day1",
  "five_messages_day1",
  "person_1",
  "person_2",
  "person_3",
  "memory_1",
  "memory_2",
  "calendar_created",
  "return_open_day2",
  "return_open_day3",
  "return_open_day4",
  "return_request_day2",
  "return_request_day3",
  "return_request_day4",
  "organic_second",
  "request_days_2",
  "request_days_3",
  "person_reused",
  "reminder_return",
  "responses_complete",
  "responses_failed",
  "responses_retried",
  "total_messages_sent"
];
function phase0SnapshotFromDataset(data, names2, now3 = Date.now()) {
  const status = data.state === "available" ? "available" : data.state === "query-error" ? "error" : "unavailable";
  if (status !== "available") {
    const off = () => ({ count: null, status, source: "backend" });
    return {
      version: 1,
      cohort: "phase-0",
      updatedAt: null,
      metrics: Object.fromEntries(METRIC_KEYS.map((key) => [key, off()])),
      activeUsers: { today: off(), week: off(), month: off(), all: off() },
      topUsers: []
    };
  }
  const { members, facts } = group(data);
  const gated = (cap, observation) => data.capabilities.includes(cap) ? observation() : unavailable("backend");
  const outcomes = requestOutcomes(facts);
  const people = (n) => gated(
    "people",
    () => usersWith(members, facts, (f) => f.kind === "person" && (f.people ?? 0) >= n)
  );
  const memory = (n) => gated(
    "memory",
    () => usersWith(members, facts, (f) => f.kind === "memory" && (f.memories ?? 0) >= n)
  );
  const window = (kind, day, min = 1) => gated("wingman", () => dayWindow(members, facts, kind, day, min, now3));
  return {
    version: 1,
    cohort: "phase-0",
    updatedAt: data.asOf,
    metrics: {
      first_open: gated(
        "activity",
        () => usersWith(members, facts, (f) => f.kind === "first_open")
      ),
      onboarding: gated(
        "onboarding",
        () => usersWith(members, facts, (f) => f.kind === "onboarding")
      ),
      first_answer: gated(
        "responses",
        () => usersWith(members, facts, (f) => f.kind === "complete")
      ),
      wingman_open_day1: window("wingman", 1),
      first_message_day1: window("message", 1),
      five_messages_day1: window("message", 1, 5),
      person_1: people(1),
      person_2: people(2),
      person_3: people(3),
      memory_1: memory(1),
      memory_2: memory(2),
      calendar_created: gated(
        "activity",
        () => usersWith(members, facts, (f) => f.kind === "calendar")
      ),
      return_open_day2: window("wingman", 2),
      return_open_day3: window("wingman", 3),
      return_open_day4: window("wingman", 4),
      return_request_day2: window("message", 2),
      return_request_day3: window("message", 3),
      return_request_day4: window("message", 4),
      organic_second: gated("situations", () => organicSecond(members, facts)),
      request_days_2: gated("wingman", () => daysActive(members, facts, 2)),
      request_days_3: gated("wingman", () => daysActive(members, facts, 3)),
      person_reused: gated("people-use", () => personReused(members, facts)),
      reminder_return: gated("attribution", () => reminderReturn(members, facts)),
      responses_complete: gated("responses", () => available(outcomes.complete)),
      responses_failed: gated("responses", () => available(outcomes.failed)),
      responses_retried: gated("retries", () => available(outcomes.retries)),
      total_messages_sent: gated("wingman", () => available(outcomes.messages))
    },
    activeUsers: {
      today: activeUsers(members, facts, istDayStart(now3)),
      week: activeUsers(members, facts, istWeekStart(now3)),
      month: activeUsers(members, facts, istMonthStart(now3)),
      all: activeUsers(members, facts, -Infinity)
    },
    topUsers: topUsers(members, facts, names2)
  };
}
async function phase0SnapshotFromBackend() {
  const data = await liveDatasetFromBackend();
  return phase0SnapshotFromDataset(data, backendDisplayNames());
}

// app/api/tracker/route.ts
var phase0Metrics = [
  {
    name: "Onboarding completion",
    target: 80,
    category: "Activation",
    valueType: "percent",
    definition: "Eligible participants who complete onboarding and reach Wingman."
  },
  {
    name: "Meaningful activation",
    target: 70,
    category: "Activation",
    valueType: "percent",
    definition: "Participants who submit a genuine personal situation and receive a usable Wingman response."
  },
  {
    name: "Independent activation",
    target: 60,
    category: "Activation",
    valueType: "percent",
    definition: "Participants who activate without live founder navigation."
  },
  {
    name: "First-answer usefulness",
    target: 75,
    category: "Value",
    valueType: "percent",
    definition: "First responses rated useful or very useful."
  },
  {
    name: "Wingman response success",
    target: 95,
    category: "Reliability",
    valueType: "percent",
    definition: "Genuine requests returning a complete, renderable response without an error."
  },
  {
    name: "Reminder delivery reliability",
    target: 95,
    category: "Reliability",
    valueType: "percent",
    definition: "Controlled reminders delivered within the accepted delivery window."
  },
  {
    name: "Reminder destination accuracy",
    target: 100,
    category: "Reliability",
    valueType: "percent",
    definition: "Reminder opens reaching the correct screen or context."
  },
  {
    name: "Analytics coverage",
    target: 100,
    category: "Measurement",
    valueType: "percent",
    definition: "Required events verified with the correct participant, timestamp, source and properties."
  },
  {
    name: "Day 1 unprompted return",
    target: 40,
    category: "Retention",
    valueType: "percent",
    definition: "Activated users who return the next day without a founder prompt or reminder."
  },
  {
    name: "Second real situation",
    target: 30,
    category: "Retention",
    valueType: "percent",
    definition: "Activated users who bring a second genuine situation within 72 hours."
  }
];
var phase0Checks = [
  "Release build frozen",
  "Android onboarding and Wingman journey tested",
  "15 users completed the cohort",
  "10 users recruited outside the team and close friends",
  "All 15 users interviewed",
  "50 Wingman requests logged",
  "30 usefulness ratings logged",
  "20 reminder tests completed",
  "Return source classified for every activated user",
  "Top three failure reasons documented",
  "Highest impact blocker fixed and retested",
  "Analytics verified",
  "Internal activity excluded",
  "Founder assistance recorded",
  "No blocking privacy, safety or journey bugs"
];
var phase0Gates = [
  "Cross-person context leakage",
  "Cross-user data leakage",
  "Sensitive notification exposure",
  "Critical privacy incidents",
  "Critical safety incidents",
  "Open P0 bugs",
  "Open release-blocking P1 bugs",
  "Reproducible core-journey crashes",
  "Missing critical analytics events"
];
var phase1aMetrics = [
  { id: "phase-1a-metric-0", category: "Cohort", name: "Eligible cohort completed", target: 50, comparator: "eq", valueType: "number", definition: "Eligible Indian men aged 18\u201328 who complete the Phase 1A observation protocol." },
  { id: "phase-1a-metric-1", category: "Activation", name: "Meaningful activation", target: 70, comparator: "gte", valueType: "percent", minimumDenominator: 50, definition: "Eligible participants who submit a genuine situation, receive a complete Wingman response and report it clearly or somewhat helped." },
  { id: "phase-1a-metric-2", category: "Independence", name: "Independent share of meaningful activations", target: 80, comparator: "gte", valueType: "percent", minimumDenominator: 35, definition: "Independent meaningful activations divided by all meaningful activations. Founder-guided or rescued sessions never count as independent." },
  { id: "phase-1a-metric-3", category: "Value", name: "First-answer usefulness", target: 75, comparator: "gte", valueType: "percent", minimumDenominator: 35, definition: "First completed genuine answers rated \u201CYes, clearly\u201D or \u201CSomewhat\u201D divided by all first genuine situations that received a complete answer." },
  { id: "phase-1a-metric-4", category: "Behavior", name: "Organic second-situation rate", target: 40, comparator: "gte", valueType: "percent", minimumDenominator: 35, definition: "Organic second-situation users divided by meaningfully activated users. This is the primary behavioral metric." },
  { id: "phase-1a-metric-5", category: "Reliability", name: "Genuine Wingman response success", target: 95, comparator: "gte", valueType: "percent", minimumDenominator: 35, definition: "Genuine requests returning a complete usable response without error or manual retry." },
  { id: "phase-1a-metric-6", category: "Trust & safety", name: "Critical trust/safety incidents", target: 0, comparator: "eq", valueType: "number", definition: "Privacy leaks, wrong-person memory, cross-account/context leaks, dangerous guidance or critical deletion/privacy failures." },
  { id: "phase-1a-metric-7", category: "Measurement", name: "Analytics / participant-state reconciliation", target: 100, comparator: "gte", valueType: "percent", minimumDenominator: 50, definition: "Every eligible participant has a valid final measurement state and correct denominator, source and version fields." }
];
var phase1bMetrics = [
  { id: "phase-1b-metric-0", category: "Activation", name: "Meaningful activation", target: 70, comparator: "gte", valueType: "percent", minimumDenominator: 100, definition: "Cold eligible users who meaningfully activate using the same Phase 1 definition." },
  { id: "phase-1b-metric-1", category: "Independence", name: "Independent share of meaningful activations", target: 80, comparator: "gte", valueType: "percent", minimumDenominator: 70, definition: "Independent meaningful activations divided by all meaningful activations in the colder cohort." },
  { id: "phase-1b-metric-2", category: "Behavior", name: "Organic second-situation rate", target: 40, comparator: "gte", valueType: "percent", minimumDenominator: 70, definition: "Organic second-situation users divided by meaningfully activated cold users." },
  { id: "phase-1b-metric-3", category: "Reliability", name: "Genuine Wingman response success", target: 95, comparator: "gte", valueType: "percent", minimumDenominator: 70, definition: "Genuine cold-cohort requests returning a complete usable response without error or manual retry." },
  { id: "phase-1b-metric-4", category: "Trust & safety", name: "Critical trust/safety incidents", target: 0, comparator: "eq", valueType: "number", definition: "Critical privacy, memory, safety or deletion failures. Any unresolved incident blocks advancement." },
  { id: "phase-1b-metric-5", category: "Measurement", name: "Analytics reconciliation", target: 100, comparator: "gte", valueType: "percent", minimumDenominator: 100, definition: "Every eligible colder participant has a reconciled measurement state, denominator, source and version." }
];
var phase1aChecks = [
  "Phase 1 build frozen/version tagged",
  "Phase 1 analytics verified",
  "50 eligible users recruited",
  "~25 dating/talking-stage users recruited",
  "~25 committed-relationship users recruited",
  "Team/paid/favour testers excluded",
  "SRM/non-SRM tagged",
  "Founder connection tagged",
  "Acquisition/recruitment source tagged",
  "Every genuine first situation classified",
  "Every founder-assisted session marked correctly",
  "Every activated user received full 14-day window",
  "No lifecycle return prompting during organic baseline",
  "Every return attribution classified",
  "Every non-returner opportunity state classified",
  "First-answer usefulness denominators reconcile",
  "Organic second-situation denominators reconcile",
  "Top three failure mechanisms documented",
  "Retained-user forensics completed",
  "Wedge comparison completed",
  "Leading wedge not explained primarily by SRM/friends",
  "Zero unresolved critical trust/safety issues",
  "Phase 1A decision documented"
];
var phase1bChecks = [
  "~100 eligible colder users recruited",
  "Same eligibility and 14-day observation rules applied",
  "Minimal founder involvement maintained",
  "Winning wedge/job defined from Phase 1A",
  "Every return attribution classified",
  "Cold-cohort denominators reconcile",
  "Cold organic repeater yield reviewed",
  "Zero unresolved critical trust/safety issues",
  "Phase 1 final decision documented"
];
function db() {
  if (!env.DB) throw new Error("Database binding is unavailable.");
  return env.DB;
}
var now = () => (/* @__PURE__ */ new Date()).toISOString();
var safeString = (value) => typeof value === "string" ? value : "";
var asNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
var asBool = (value) => value === true || value === 1 || value === "1";
var allowed = (value, values, fallback) => typeof value === "string" && values.includes(value) ? value : fallback;
var safeUrl = (value) => {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
};
async function addMetricColumn(database3, name, definition) {
  const result2 = await database3.prepare("PRAGMA table_info(metrics)").all();
  if (!result2.results.some((column) => column.name === name))
    await database3.prepare(`ALTER TABLE metrics ADD COLUMN ${definition}`).run();
}
async function addColumnIfMissing(database3, table, name, definition) {
  const result2 = await database3.prepare(`PRAGMA table_info(${table})`).all();
  if (!result2.results.some((column) => column.name === name))
    await database3.prepare(`ALTER TABLE ${table} ADD COLUMN ${definition}`).run();
}
async function initializeDatabase() {
  const database3 = db();
  await database3.batch([
    database3.prepare(
      `CREATE TABLE IF NOT EXISTS phases (id TEXT PRIMARY KEY, position INTEGER NOT NULL, name TEXT NOT NULL, objective TEXT NOT NULL, user_min INTEGER NOT NULL, user_max INTEGER NOT NULL, duration_min INTEGER NOT NULL, duration_max INTEGER NOT NULL, duration_unit TEXT NOT NULL DEFAULT 'days', actual_users INTEGER NOT NULL DEFAULT 0, elapsed_days INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'locked', features TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)`
    ),
    database3.prepare(
      `CREATE TABLE IF NOT EXISTS metrics (id TEXT PRIMARY KEY, phase_id TEXT NOT NULL, position INTEGER NOT NULL, category TEXT NOT NULL, name TEXT NOT NULL, target REAL NOT NULL, actual REAL, unit TEXT NOT NULL DEFAULT '%', comparator TEXT NOT NULL DEFAULT 'gte')`
    ),
    database3.prepare(
      `CREATE TABLE IF NOT EXISTS checks (id TEXT PRIMARY KEY, phase_id TEXT NOT NULL, position INTEGER NOT NULL, label TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0)`
    ),
    database3.prepare(
      `CREATE TABLE IF NOT EXISTS release_gates (id TEXT PRIMARY KEY, phase_id TEXT NOT NULL, position INTEGER NOT NULL, name TEXT NOT NULL, actual INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)`
    ),
    database3.prepare(
      `CREATE TABLE IF NOT EXISTS cohort_evidence (id TEXT PRIMARY KEY, phase_id TEXT NOT NULL, participant_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'invited', age_band TEXT NOT NULL DEFAULT 'other', relationship_state TEXT NOT NULL DEFAULT 'other', recruitment_source TEXT NOT NULL DEFAULT '', close_friend_or_teammate INTEGER NOT NULL DEFAULT 0, situation_category TEXT NOT NULL DEFAULT 'other', onboarding_completed INTEGER NOT NULL DEFAULT 0, meaningful_activation INTEGER NOT NULL DEFAULT 0, independently_activated INTEGER NOT NULL DEFAULT 0, first_answer_useful TEXT NOT NULL DEFAULT 'not-rated', genuine_request_count INTEGER NOT NULL DEFAULT 0, usefulness_response_count INTEGER NOT NULL DEFAULT 0, reminder_test_count INTEGER NOT NULL DEFAULT 0, reminder_tested INTEGER NOT NULL DEFAULT 0, reminder_delivery_result TEXT NOT NULL DEFAULT 'not-tested', reminder_destination_result TEXT NOT NULL DEFAULT 'not-tested', return_source TEXT NOT NULL DEFAULT 'unknown', founder_explained_product INTEGER NOT NULL DEFAULT 0, founder_helped_onboarding INTEGER NOT NULL DEFAULT 0, founder_suggested_situation INTEGER NOT NULL DEFAULT 0, founder_helped_request INTEGER NOT NULL DEFAULT 0, founder_solved_problem INTEGER NOT NULL DEFAULT 0, founder_prompted_return INTEGER NOT NULL DEFAULT 0, trust_concern INTEGER NOT NULL DEFAULT 0, product_issue INTEGER NOT NULL DEFAULT 0, evidence_note TEXT NOT NULL DEFAULT '', notion_reference_url TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`
    ),
    database3.prepare(
      "CREATE INDEX IF NOT EXISTS idx_metrics_phase_position ON metrics(phase_id, position)"
    ),
    database3.prepare(
      "CREATE INDEX IF NOT EXISTS idx_checks_phase_position ON checks(phase_id, position)"
    ),
    database3.prepare(
      "CREATE INDEX IF NOT EXISTS idx_release_gates_phase_position ON release_gates(phase_id, position)"
    ),
    database3.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_cohort_evidence_phase_participant ON cohort_evidence(phase_id, participant_id)"
    )
  ]);
  await addMetricColumn(
    database3,
    "value_type",
    "value_type TEXT NOT NULL DEFAULT 'number'"
  );
  await addMetricColumn(
    database3,
    "target_denominator",
    "target_denominator INTEGER"
  );
  await addMetricColumn(
    database3,
    "actual_denominator",
    "actual_denominator INTEGER"
  );
  await addMetricColumn(
    database3,
    "minimum_denominator",
    "minimum_denominator INTEGER"
  );
  await addMetricColumn(
    database3,
    "definition",
    "definition TEXT NOT NULL DEFAULT ''"
  );
  const phase = await database3.prepare("SELECT id FROM phases WHERE id = 'phase-0'").first();
  if (!phase)
    throw new Error(
      "Existing launch phases are required before applying Phase 0."
    );
  const timestamp = now();
  await database3.prepare(
    `UPDATE phases SET name=?, objective=?, user_min=15, user_max=15, duration_min=3, duration_max=5, duration_unit='days', status=CASE WHEN status='locked' THEN 'ready' ELSE status END, features=?, updated_at=? WHERE id='phase-0'`
  ).bind(
    "Phase 0: Power User Release Candidate",
    "Validate Android V3 with real users.",
    JSON.stringify([
      "AI Wingman V3",
      "Person context and memory",
      "User reminders",
      "Usefulness feedback",
      "Required analytics"
    ]),
    timestamp
  ).run();
  const phase1 = await database3.prepare("SELECT id FROM phases WHERE id = 'phase-1'").first();
  if (phase1) {
    await database3.prepare(
      `UPDATE phases SET name=?, objective=?, user_min=50, user_max=50, duration_min=14, duration_max=14, duration_unit='days', features=?, updated_at=? WHERE id='phase-1'`
    ).bind(
      "Phase 1: Organic Wingman Pull",
      "Prove that the right user independently gets real value and chooses Wingman again for another genuine relationship situation.",
      JSON.stringify([
        "AI Wingman V3",
        "Person context",
        "User-controlled memory",
        "User-created practical reminders",
        "Usefulness feedback",
        "Required analytics"
      ]),
      timestamp
    ).run();
    await database3.prepare(
      "INSERT OR IGNORE INTO phase1_state (phase_id,decision_1a,final_decision,updated_at) VALUES ('phase-1',NULL,NULL,?)"
    ).bind(timestamp).run();
    const allPhase1Metrics = [...phase1aMetrics, ...phase1bMetrics];
    await database3.batch(
      allPhase1Metrics.map(
        (metric, position) => database3.prepare(
          `INSERT INTO metrics (id,phase_id,position,category,name,target,actual,unit,comparator,value_type,target_denominator,actual_denominator,minimum_denominator,definition) VALUES (?, 'phase-1', ?, ?, ?, ?, NULL, ?, ?, ?, NULL, NULL, ?, ?) ON CONFLICT(id) DO UPDATE SET position=excluded.position,category=excluded.category,name=excluded.name,target=excluded.target,unit=excluded.unit,comparator=excluded.comparator,value_type=excluded.value_type,target_denominator=NULL,minimum_denominator=excluded.minimum_denominator,definition=excluded.definition`
        ).bind(
          metric.id,
          position,
          metric.category,
          metric.name,
          metric.target,
          metric.valueType === "percent" ? "%" : "count",
          metric.comparator,
          metric.valueType,
          metric.minimumDenominator ?? null,
          metric.definition
        )
      )
    );
    const allPhase1Checks = [
      ...phase1aChecks.map((label) => ({ id: `phase-1a-check-${phase1aChecks.indexOf(label)}`, label })),
      ...phase1bChecks.map((label) => ({ id: `phase-1b-check-${phase1bChecks.indexOf(label)}`, label }))
    ];
    await database3.batch(
      allPhase1Checks.map(
        (check, position) => database3.prepare(
          "INSERT INTO checks (id,phase_id,position,label,completed) VALUES (?, 'phase-1', ?, ?, 0) ON CONFLICT(id) DO UPDATE SET position=excluded.position,label=excluded.label"
        ).bind(check.id, position, check.label)
      )
    );
  }
  const marker = await database3.prepare(
    "SELECT id FROM metrics WHERE phase_id='phase-0' AND name='Independent activation'"
  ).first();
  if (!marker) {
    const legacy = await database3.prepare("SELECT COUNT(*) AS count FROM metrics WHERE phase_id='phase-0'").first();
    if (legacy?.count) throw new Error("Legacy Phase 0 evidence requires an explicit non-destructive migration.");
    const statements = [];
    phase0Metrics.forEach(
      (metric, position) => statements.push(
        database3.prepare(
          `INSERT INTO metrics (id,phase_id,position,category,name,target,actual,unit,comparator,value_type,target_denominator,actual_denominator,minimum_denominator,definition) VALUES (?, 'phase-0', ?, ?, ?, ?, NULL, ?, 'gte', ?, ?, NULL, ?, ?)`
        ).bind(
          `phase-0-metric-${position}`,
          position,
          metric.category,
          metric.name,
          metric.target,
          metric.valueType === "percent" ? "%" : metric.valueType === "fraction" ? "fraction" : "count",
          metric.valueType,
          metric.targetDenominator ?? null,
          metric.minimumDenominator ?? null,
          metric.definition
        )
      )
    );
    phase0Checks.forEach(
      (label, position) => statements.push(
        database3.prepare(
          "INSERT OR IGNORE INTO checks (id,phase_id,position,label,completed) VALUES (?, 'phase-0', ?, ?, 0)"
        ).bind(`phase-0-check-${position}`, position, label)
      )
    );
    await database3.batch(statements);
  }
  await database3.batch(
    phase0Metrics.map(
      (metric, position) => database3.prepare(
        `INSERT OR IGNORE INTO metrics (id,phase_id,position,category,name,target,actual,unit,comparator,value_type,target_denominator,actual_denominator,minimum_denominator,definition) VALUES (?, 'phase-0', ?, ?, ?, ?, NULL, '%', 'gte', 'percent', NULL, NULL, NULL, ?)`
      ).bind(
        `phase-0-metric-${position}`,
        position,
        metric.category,
        metric.name,
        metric.target,
        metric.definition
      )
    )
  );
  await database3.batch(
    phase0Metrics.map(
      (metric, position) => database3.prepare(
        `UPDATE metrics SET position=?, category=?, target=?, unit='%', comparator='gte', value_type='percent', target_denominator=NULL, minimum_denominator=NULL, definition=? WHERE phase_id='phase-0' AND name=?`
      ).bind(
        position,
        metric.category,
        metric.target,
        metric.definition,
        metric.name
      )
    )
  );
  await database3.batch(
    phase0Checks.map(
      (label, position) => database3.prepare(
        "INSERT INTO checks (id,phase_id,position,label,completed) VALUES (?, 'phase-0', ?, ?, 0) ON CONFLICT(id) DO UPDATE SET position=excluded.position,label=excluded.label"
      ).bind(`phase-0-check-${position}`, position, label)
    )
  );
  const gateCount = await database3.prepare(
    "SELECT COUNT(*) AS count FROM release_gates WHERE phase_id='phase-0'"
  ).first();
  if (!gateCount?.count)
    await database3.batch(
      phase0Gates.map(
        (name, position) => database3.prepare(
          "INSERT INTO release_gates (id,phase_id,position,name,actual,updated_at) VALUES (?, ?, ?, ?, 0, ?)"
        ).bind(
          `phase-0-gate-${position}`,
          "phase-0",
          position,
          name,
          timestamp
        )
      )
    );
}
var phase0SchemaReady = null;
function ensurePhase0PostHogSchema() {
  if (!phase0SchemaReady) {
    phase0SchemaReady = (async () => {
      const database3 = db();
      await addColumnIfMissing(
        database3,
        "cohort_evidence",
        "posthog_distinct_id",
        "posthog_distinct_id TEXT"
      );
      await database3.prepare(
        "CREATE TABLE IF NOT EXISTS posthog_metric_cache (key TEXT PRIMARY KEY, payload TEXT NOT NULL, computed_at TEXT NOT NULL)"
      ).run();
    })().catch((error) => {
      phase0SchemaReady = null;
      throw error;
    });
  }
  return phase0SchemaReady;
}
var databaseSetup = null;
function ensureDatabase() {
  if (env.SPARKEEFY_DATABASE_IMPORTED === "true") return Promise.resolve();
  if (!databaseSetup) {
    databaseSetup = initializeDatabase().catch((error) => {
      databaseSetup = null;
      throw error;
    });
  }
  return databaseSetup;
}
function metricFromRow(row) {
  return {
    id: String(row.id),
    phaseId: String(row.phase_id),
    position: asNumber(row.position),
    category: String(row.category),
    name: String(row.name),
    target: asNumber(row.target),
    actual: row.actual === null ? null : asNumber(row.actual),
    unit: String(row.unit),
    comparator: String(row.comparator),
    valueType: allowed(
      row.value_type,
      ["number", "fraction", "percent"],
      "number"
    ),
    targetDenominator: row.target_denominator === null ? null : asNumber(row.target_denominator),
    actualDenominator: row.actual_denominator === null ? null : asNumber(row.actual_denominator),
    minimumDenominator: row.minimum_denominator === null ? null : asNumber(row.minimum_denominator),
    definition: String(row.definition || "")
  };
}
async function loadTracker() {
  await ensureDatabase();
  const database3 = db();
  const [phaseRows, metricRows, checkRows, releaseGateRows] = await Promise.all([
    database3.prepare("SELECT * FROM phases ORDER BY position").all(),
    database3.prepare("SELECT * FROM metrics ORDER BY phase_id,position").all(),
    database3.prepare("SELECT * FROM checks ORDER BY phase_id,position").all(),
    database3.prepare("SELECT * FROM release_gates WHERE phase_id='phase-0' ORDER BY position").all()
  ]);
  const metrics = metricRows.results.map(
    (row) => metricFromRow(row)
  );
  const checks = checkRows.results.map((row) => ({
    id: String(row.id),
    phaseId: String(row.phase_id),
    position: asNumber(row.position),
    label: String(row.label),
    completed: asBool(row.completed)
  }));
  return {
    releaseGates: releaseGateRows.results.map((row) => ({
      id: String(row.id),
      phaseId: String(row.phase_id),
      position: asNumber(row.position),
      name: String(row.name),
      actual: asNumber(row.actual)
    })),
    phases: phaseRows.results.map((row) => ({
      id: String(row.id),
      position: asNumber(row.position),
      name: String(row.name),
      objective: String(row.objective),
      userMin: asNumber(row.user_min),
      userMax: asNumber(row.user_max),
      durationMin: asNumber(row.duration_min),
      durationMax: asNumber(row.duration_max),
      durationUnit: String(row.duration_unit),
      actualUsers: asNumber(row.actual_users),
      elapsedDays: asNumber(row.elapsed_days),
      status: String(row.status),
      features: JSON.parse(String(row.features)),
      notes: String(row.notes),
      startedAt: row.started_at === null ? null : String(row.started_at),
      updatedAt: String(row.updated_at),
      metrics: metrics.filter((metric) => metric.phaseId === row.id),
      checks: checks.filter((check) => check.phaseId === row.id)
    }))
  };
}
function participantFromRow(row) {
  const b = (name) => asBool(row[name]);
  return {
    id: String(row.id),
    phaseId: String(row.phase_id),
    participantId: String(row.participant_id),
    status: String(row.status),
    ageBand: String(row.age_band),
    relationshipState: String(row.relationship_state),
    recruitmentSource: String(row.recruitment_source),
    closeFriendOrTeammate: b("close_friend_or_teammate"),
    situationCategory: String(row.situation_category),
    onboardingCompleted: b("onboarding_completed"),
    meaningfulActivation: b("meaningful_activation"),
    independentlyActivated: b("independently_activated"),
    firstAnswerUseful: allowed(
      row.first_answer_useful,
      ["yes", "no", "not-rated"],
      "not-rated"
    ),
    genuineRequestCount: asNumber(row.genuine_request_count),
    usefulnessResponseCount: asNumber(row.usefulness_response_count),
    reminderTestCount: asNumber(row.reminder_test_count),
    reminderTested: b("reminder_tested"),
    reminderDeliveryResult: String(row.reminder_delivery_result),
    reminderDestinationResult: String(row.reminder_destination_result),
    returnSource: String(row.return_source),
    founderExplainedProduct: b("founder_explained_product"),
    founderHelpedOnboarding: b("founder_helped_onboarding"),
    founderSuggestedSituation: b("founder_suggested_situation"),
    founderHelpedRequest: b("founder_helped_request"),
    founderSolvedProblem: b("founder_solved_problem"),
    founderPromptedReturn: b("founder_prompted_return"),
    trustConcern: b("trust_concern"),
    productIssue: b("product_issue"),
    evidenceNote: String(row.evidence_note),
    notionReferenceUrl: String(row.notion_reference_url),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}
async function loadAnalyticsSnapshot() {
  await ensureDatabase();
  const rows = await db().prepare(
    "SELECT phase_id,status,onboarding_completed,meaningful_activation,independently_activated,first_answer_useful,return_source,updated_at FROM cohort_evidence ORDER BY updated_at DESC"
  ).all();
  const people = rows.results;
  const count = (predicate) => people.filter(predicate).length;
  const rated = count((row) => String(row.first_answer_useful) !== "not-rated");
  const activated = count((row) => asBool(row.meaningful_activation));
  const organicAttributed = count(
    (row) => String(row.return_source) === "organic"
  );
  const updatedAt = people[0]?.updated_at ? String(people[0].updated_at) : null;
  const aggregate = (numerator, denominator, definition) => ({
    numerator,
    denominator,
    definition,
    source: "Launch Control manual cohort ledger"
  });
  return {
    updatedAt,
    source: {
      name: "Launch Control manual cohort ledger",
      status: people.length ? "available" : "empty",
      description: "Pseudonymous, manually verified cohort evidence. It is not live product telemetry."
    },
    cohorts: [
      { id: "all", label: "All users", available: people.length > 0 },
      { id: "phase-0", label: "Phase 0", available: true },
      { id: "phase-1a", label: "Phase 1A", available: false },
      { id: "phase-1b", label: "Phase 1B", available: false }
    ],
    users: {
      registered: people.length || null,
      active: null,
      series: null,
      reason: "Active-user events are not connected to this control plane yet."
    },
    funnel: [
      { key: "invited", label: "Invited", value: people.length || null, definition: "Participants recorded in the manual cohort ledger." },
      { key: "accepted", label: "Accepted", value: people.length ? count((row) => String(row.status) !== "dropped") : null, definition: "Ledger participants not marked dropped. Acceptance is not separately instrumented." },
      { key: "installed", label: "Play access / installed", value: null, definition: "No canonical install event is connected." },
      { key: "onboarding", label: "Onboarding completed", value: people.length ? count((row) => asBool(row.onboarding_completed)) : null, definition: "Manual cohort-evidence field." },
      { key: "situation", label: "Genuine situation", value: null, definition: "No separate canonical situation event is connected." },
      { key: "wingman", label: "First Wingman complete", value: null, definition: "No response-complete event is connected." },
      { key: "meaningful", label: "Meaningful activation", value: people.length ? activated : null, definition: "Manual cohort-evidence field; genuine situation plus a complete useful Wingman response." },
      { key: "useful", label: "Useful answer", value: rated ? count((row) => String(row.first_answer_useful) === "yes") : null, definition: "Manual first-answer usefulness rating. \u2018A bit\u2019 is not captured by the current ledger." },
      { key: "independent", label: "Independent activation", value: people.length ? count((row) => asBool(row.independently_activated)) : null, definition: "Manual cohort-evidence field." },
      { key: "organic-second", label: "Organic second situation", value: null, definition: "Return attribution alone cannot prove a distinct second genuine situation." }
    ],
    activation: {
      onboarding: aggregate(people.length ? count((row) => asBool(row.onboarding_completed)) : null, people.length || null, "Onboarding completion among ledger participants."),
      meaningful: aggregate(people.length ? activated : null, people.length || null, "Meaningful activations among ledger participants."),
      usefulness: aggregate(rated ? count((row) => String(row.first_answer_useful) === "yes") : null, rated || null, "Yes ratings among manually rated first answers. \u2018A bit\u2019 is not recorded in the current ledger."),
      independent: aggregate(activated ? count((row) => asBool(row.independently_activated)) : null, activated || null, "Independent activations among meaningful activations."),
      organicSecond: aggregate(null, null, "A distinct, unprompted second genuine situation requires a canonical event source."),
      organicYield: aggregate(null, people.length || null, "Organic second-situation users divided by eligible invited users.")
    },
    retention: {
      app: null,
      wingman: null,
      meaningfulWingman: null,
      organicSituation: null,
      organicAttributed: aggregate(organicAttributed || null, activated || null, "Organic return attribution. This is not counted as a second situation without separate evidence."),
      reason: "D1/D7/D30 retention cohorts require timestamped product events, which are not connected."
    },
    quality: {
      usefulness: { yes: count((row) => String(row.first_answer_useful) === "yes"), abit: null, no: count((row) => String(row.first_answer_useful) === "no"), unrated: count((row) => String(row.first_answer_useful) === "not-rated") },
      responseSuccess: null,
      failures: null,
      retries: null,
      fallbacks: null,
      incomplete: null
    },
    reliability: null,
    aiCost: null
  };
}
var PHASE0_CACHE_KEY = "phase0-analytics-v1";
var PHASE0_CACHE_TTL_MS = 45e3;
async function loadPhase0Analytics() {
  await ensureDatabase();
  await ensurePhase0PostHogSchema();
  const database3 = db();
  const cached2 = await database3.prepare("SELECT payload, computed_at FROM posthog_metric_cache WHERE key = ?").bind(PHASE0_CACHE_KEY).first();
  if (cached2 && Date.now() - Date.parse(cached2.computed_at) < PHASE0_CACHE_TTL_MS) {
    return JSON.parse(cached2.payload);
  }
  const interviewRows = await database3.prepare(
    "SELECT founder_suggested_situation FROM cohort_evidence WHERE phase_id='phase-0' AND status != 'dropped'"
  ).all();
  const interviewed = interviewRows.results.length;
  const opportunityRepeat = interviewed ? {
    count: interviewRows.results.filter((row) => row.founder_suggested_situation === 1).length,
    denominator: interviewed,
    status: "available",
    source: "manual"
  } : { count: null, status: "pending", source: "manual" };
  const backend = await phase0SnapshotFromBackend();
  const snapshot = {
    ...backend,
    updatedAt: backend.updatedAt ?? now(),
    metrics: { ...backend.metrics, opportunity_repeat: opportunityRepeat }
  };
  await database3.prepare(
    "INSERT INTO posthog_metric_cache (key,payload,computed_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,computed_at=excluded.computed_at"
  ).bind(PHASE0_CACHE_KEY, JSON.stringify(snapshot), now()).run();
  return snapshot;
}
function phase0Unmet(phase, releaseGates = []) {
  const unmet = phase.metrics.filter((metric) => !metricPassed(metric)).map((metric) => `${metric.name} has not passed`);
  unmet.push(
    ...phase.checks.filter((check) => !check.completed).map((check) => check.label)
  );
  unmet.push(
    ...releaseGates.filter((gate) => gate.actual !== 0).map((gate) => `${gate.name} must be zero`)
  );
  return unmet;
}
var isReplicationDecision = (decision) => decision === "advance" || decision === "narrow";
var phase1SubsetUnmet = (phase, prefix) => [
  ...phase.metrics.filter((metric) => metric.id.startsWith(prefix) && !metricPassed(metric)).map((metric) => `${metric.name} has not passed`),
  ...phase.checks.filter((check) => check.id.startsWith(prefix) && !check.completed).map((check) => check.label)
];
async function loadPhase1State(phase) {
  if (!phase)
    return {
      decision1A: null,
      finalDecision: null,
      phase1AReady: false,
      phase1BUnlocked: false,
      phase1Unmet: ["Phase 1 is unavailable."]
    };
  const row = await db().prepare("SELECT decision_1a,final_decision FROM phase1_state WHERE phase_id='phase-1'").first();
  const decision1A = row?.decision_1a ?? null;
  const finalDecision = row?.final_decision ?? null;
  const phase1AUnmet = phase1SubsetUnmet(phase, "phase-1a-");
  const phase1AReady = phase1AUnmet.length === 0 && isReplicationDecision(decision1A);
  const phase1BUnlocked = phase1AReady;
  const phase1BUnmet = phase1BUnlocked ? phase1SubsetUnmet(phase, "phase-1b-") : ["Phase 1B is locked until Phase 1A passes and a replication decision is recorded."];
  const phase1Unmet = [
    ...phase1AUnmet,
    ...isReplicationDecision(decision1A) ? [] : ["Phase 1A decision must be Advance or Narrow to unlock cold replication"],
    ...phase1BUnmet,
    ...isReplicationDecision(finalDecision) ? [] : ["Final Phase 1 decision must be Advance or Narrow"]
  ];
  return {
    decision1A,
    finalDecision,
    phase1AReady,
    phase1BUnlocked,
    phase1Unmet
  };
}
async function safeLoadPhase0Analytics() {
  try {
    return await loadPhase0Analytics();
  } catch {
    return {
      version: 1,
      cohort: "phase-0",
      updatedAt: null,
      metrics: {},
      activeUsers: {
        today: unavailable(),
        week: unavailable(),
        month: unavailable(),
        all: unavailable()
      }
    };
  }
}
async function trackerResponse(request) {
  const [tracker, access, analytics, phase0] = await Promise.all([
    loadTracker(),
    trackerAccess(request),
    loadAnalyticsSnapshot(),
    safeLoadPhase0Analytics()
  ]);
  const phase = tracker.phases.find((item) => item.id === "phase-0");
  const phase1 = tracker.phases.find((item) => item.id === "phase-1");
  const phase1State = await loadPhase1State(phase1);
  const wedgeRows = await db().prepare("SELECT wedge,field,numeric_value,text_value FROM phase1_wedge_signals ORDER BY wedge,field").all();
  return {
    ...tracker,
    ...access,
    analytics: { ...analytics, phase0 },
    phase0Unmet: access.canEdit && phase ? phase0Unmet(phase, tracker.releaseGates) : [],
    phase1: {
      ...phase1State,
      wedgeSignals: wedgeRows.results.map((row) => ({
        wedge: row.wedge,
        field: row.field,
        numericValue: row.numeric_value,
        textValue: row.text_value
      }))
    }
  };
}
function validateParticipant(patch, existing) {
  const participantId = String(
    patch.participantId ?? existing?.participantId ?? ""
  ).trim().toUpperCase();
  if (!/^P0-\d{3}$/.test(participantId))
    throw new Error("Participant ID must use the P0-001 format.");
  const note = String(
    patch.evidenceNote ?? existing?.evidenceNote ?? ""
  ).trim();
  if (note.length > 280)
    throw new Error("Sanitized evidence notes are limited to 280 characters.");
  const get = (key) => patch[key] ?? existing?.[key];
  return {
    participantId,
    status: allowed(
      get("status"),
      ["invited", "onboarded", "activated", "completed", "dropped"],
      "invited"
    ),
    ageBand: allowed(
      get("ageBand"),
      ["18\u201320", "21\u201324", "25\u201328", "other"],
      "other"
    ),
    relationshipState: allowed(
      get("relationshipState"),
      [
        "relationship",
        "talking-stage",
        "dating",
        "conflict",
        "breakup",
        "other"
      ],
      "other"
    ),
    recruitmentSource: String(get("recruitmentSource") || "").slice(0, 80),
    closeFriendOrTeammate: asBool(get("closeFriendOrTeammate")),
    situationCategory: allowed(
      get("situationCategory"),
      ["reply-help", "repair", "planning", "other"],
      "other"
    ),
    onboardingCompleted: asBool(get("onboardingCompleted")),
    meaningfulActivation: asBool(get("meaningfulActivation")),
    independentlyActivated: asBool(get("independentlyActivated")),
    firstAnswerUseful: allowed(
      get("firstAnswerUseful"),
      ["yes", "no", "not-rated"],
      "not-rated"
    ),
    genuineRequestCount: Math.max(
      0,
      Math.min(999, asNumber(get("genuineRequestCount")))
    ),
    usefulnessResponseCount: Math.max(
      0,
      Math.min(999, asNumber(get("usefulnessResponseCount")))
    ),
    reminderTestCount: Math.max(
      0,
      Math.min(999, asNumber(get("reminderTestCount")))
    ),
    reminderTested: asBool(get("reminderTested")),
    reminderDeliveryResult: allowed(
      get("reminderDeliveryResult"),
      ["not-tested", "delivered", "failed"],
      "not-tested"
    ),
    reminderDestinationResult: allowed(
      get("reminderDestinationResult"),
      ["not-tested", "correct", "incorrect"],
      "not-tested"
    ),
    returnSource: allowed(
      get("returnSource"),
      [
        "organic",
        "reminder-assisted",
        "founder-prompted",
        "referral",
        "internal-test",
        "unknown"
      ],
      "unknown"
    ),
    founderExplainedProduct: asBool(get("founderExplainedProduct")),
    founderHelpedOnboarding: asBool(get("founderHelpedOnboarding")),
    founderSuggestedSituation: asBool(get("founderSuggestedSituation")),
    founderHelpedRequest: asBool(get("founderHelpedRequest")),
    founderSolvedProblem: asBool(get("founderSolvedProblem")),
    founderPromptedReturn: asBool(get("founderPromptedReturn")),
    trustConcern: asBool(get("trustConcern")),
    productIssue: asBool(get("productIssue")),
    evidenceNote: note,
    notionReferenceUrl: safeUrl(get("notionReferenceUrl"))
  };
}
var bindParticipant = (statement, id2, person, timestamp) => statement.bind(
  id2,
  person.participantId,
  person.status,
  person.ageBand,
  person.relationshipState,
  person.recruitmentSource,
  person.closeFriendOrTeammate ? 1 : 0,
  person.situationCategory,
  person.onboardingCompleted ? 1 : 0,
  person.meaningfulActivation ? 1 : 0,
  person.independentlyActivated ? 1 : 0,
  person.firstAnswerUseful,
  person.genuineRequestCount,
  person.usefulnessResponseCount,
  person.reminderTestCount,
  person.reminderTested ? 1 : 0,
  person.reminderDeliveryResult,
  person.reminderDestinationResult,
  person.returnSource,
  person.founderExplainedProduct ? 1 : 0,
  person.founderHelpedOnboarding ? 1 : 0,
  person.founderSuggestedSituation ? 1 : 0,
  person.founderHelpedRequest ? 1 : 0,
  person.founderSolvedProblem ? 1 : 0,
  person.founderPromptedReturn ? 1 : 0,
  person.trustConcern ? 1 : 0,
  person.productIssue ? 1 : 0,
  person.evidenceNote,
  person.notionReferenceUrl,
  timestamp,
  timestamp
);
async function GET(request) {
  try {
    const access = await trackerAccess(request);
    if (!access.authenticated && env.SPARKEEFY_PUBLIC_READONLY !== "true")
      return Response.json(
        { authenticated: false },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    if (new URL(request.url).searchParams.get("private") === "cohort" && !access.canEdit)
      return Response.json(
        { error: "Private cohort evidence is restricted to the editor." },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    return Response.json(await trackerResponse(request), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Unable to load tracker."
      },
      { status: 500 }
    );
  }
}
async function PATCH(request) {
  try {
    const access = await trackerAccess(request);
    if (!access.canEdit)
      return Response.json(
        { error: "This account has view-only access." },
        { status: 403 }
      );
    await ensureDatabase();
    const body = await request.json();
    const database3 = db();
    const timestamp = now();
    if (body.action === "metric" && body.id && body.patch) {
      for (const field of ["actual", "actualDenominator"]) {
        const value = body.patch[field];
        if (value != null && value !== "" && (typeof value !== "number" && typeof value !== "string" || !Number.isFinite(Number(value)) || Number(value) < 0 || field === "actualDenominator" && !Number.isSafeInteger(Number(value))))
          return Response.json({ error: "Use valid non-negative metric evidence." }, { status: 400 });
      }
      const currentMetric = await database3.prepare("SELECT phase_id,target FROM metrics WHERE id=?").bind(body.id).first();
      if (!currentMetric)
        return Response.json({ error: "Metric not found." }, { status: 404 });
      const actual = body.patch.actual === null || body.patch.actual === "" ? null : Math.max(0, asNumber(body.patch.actual));
      const denominator = body.patch.actualDenominator === null || body.patch.actualDenominator === "" ? null : Math.max(0, asNumber(body.patch.actualDenominator));
      await database3.prepare(
        "UPDATE metrics SET target=?, actual=?, actual_denominator=? WHERE id=?"
      ).bind(
        currentMetric.phase_id === "phase-1" ? Math.max(0, asNumber(currentMetric.target)) : Math.max(0, asNumber(body.patch.target)),
        actual,
        denominator,
        body.id
      ).run();
    } else if (body.action === "check" && body.id && body.patch)
      await database3.prepare("UPDATE checks SET completed=? WHERE id=?").bind(asBool(body.patch.completed) ? 1 : 0, body.id).run();
    else if (body.action === "phase1_decision" && body.patch) {
      const stage = safeString(body.patch.stage);
      const decision = safeString(body.patch.decision);
      if (!["1a", "final"].includes(stage) || !["advance", "narrow", "repair", "reconsider"].includes(decision))
        return Response.json({ error: "Use a valid Phase 1 decision." }, { status: 400 });
      await database3.prepare(
        stage === "1a" ? "UPDATE phase1_state SET decision_1a=?,updated_at=? WHERE phase_id='phase-1'" : "UPDATE phase1_state SET final_decision=?,updated_at=? WHERE phase_id='phase-1'"
      ).bind(decision, timestamp).run();
    } else if (body.action === "phase1_wedge" && body.patch) {
      const wedge = safeString(body.patch.wedge);
      const field = safeString(body.patch.field);
      const allowedWedges = ["talking-stage", "committed"];
      const allowedFields = [
        "eligible_users",
        "meaningful_activation",
        "independent_activation",
        "first_answer_usefulness",
        "organic_second_situation_rate",
        "typical_days_to_second_situation",
        "founder_rescue_minutes",
        "memory_benefit",
        "privacy_comfort",
        "primary_recurring_job",
        "alternative_used",
        "trust_safety_incidents"
      ];
      if (!allowedWedges.includes(wedge) || !allowedFields.includes(field))
        return Response.json({ error: "Use a valid wedge comparison field." }, { status: 400 });
      const numericValue = body.patch.numericValue === null || body.patch.numericValue === "" ? null : Math.max(0, Math.min(1e5, asNumber(body.patch.numericValue)));
      const textValue = safeString(body.patch.textValue).trim().slice(0, 120);
      await database3.prepare(
        "INSERT INTO phase1_wedge_signals (wedge,field,numeric_value,text_value,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(wedge,field) DO UPDATE SET numeric_value=excluded.numeric_value,text_value=excluded.text_value,updated_at=excluded.updated_at"
      ).bind(wedge, field, numericValue, textValue, timestamp).run();
    } else if (body.action === "start" && body.phaseId) {
      const phase = await database3.prepare("SELECT status,started_at FROM phases WHERE id=?").bind(body.phaseId).first();
      if (!phase)
        return Response.json({ error: "Phase not found." }, { status: 404 });
      if (phase.status === "locked")
        return Response.json({ error: "This phase is locked." }, { status: 409 });
      if (phase.status !== "complete")
        await database3.prepare("UPDATE phases SET status='active',started_at=COALESCE(started_at,?),updated_at=? WHERE id=?").bind(timestamp, timestamp, body.phaseId).run();
    } else if (body.action === "release_gate" && body.id && body.patch) {
      const value = body.patch.actual;
      if (typeof value !== "number" && typeof value !== "string" || value === "" || !Number.isSafeInteger(Number(value)) || Number(value) < 0)
        return Response.json({ error: "Incident evidence must be a non-negative whole number." }, { status: 400 });
      await database3.prepare("UPDATE release_gates SET actual=?,updated_at=? WHERE id=?").bind(Math.max(0, asNumber(body.patch.actual)), timestamp, body.id).run();
    } else if (body.action === "cohort_create" && body.patch) {
      const person = validateParticipant(body.patch);
      const sql = `INSERT INTO cohort_evidence (id,phase_id,participant_id,status,age_band,relationship_state,recruitment_source,close_friend_or_teammate,situation_category,onboarding_completed,meaningful_activation,independently_activated,first_answer_useful,genuine_request_count,usefulness_response_count,reminder_test_count,reminder_tested,reminder_delivery_result,reminder_destination_result,return_source,founder_explained_product,founder_helped_onboarding,founder_suggested_situation,founder_helped_request,founder_solved_problem,founder_prompted_return,trust_concern,product_issue,evidence_note,notion_reference_url,created_at,updated_at) VALUES (?, 'phase-0', ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
      await bindParticipant(
        database3.prepare(sql),
        crypto.randomUUID(),
        person,
        timestamp
      ).run();
    } else if (body.action === "cohort_update" && body.id && body.patch) {
      const row = await database3.prepare(
        "SELECT * FROM cohort_evidence WHERE id=? AND phase_id='phase-0'"
      ).bind(body.id).first();
      if (!row)
        return Response.json(
          { error: "Participant not found." },
          { status: 404 }
        );
      const person = validateParticipant(body.patch, participantFromRow(row));
      const sql = `UPDATE cohort_evidence SET participant_id=?,status=?,age_band=?,relationship_state=?,recruitment_source=?,close_friend_or_teammate=?,situation_category=?,onboarding_completed=?,meaningful_activation=?,independently_activated=?,first_answer_useful=?,genuine_request_count=?,usefulness_response_count=?,reminder_test_count=?,reminder_tested=?,reminder_delivery_result=?,reminder_destination_result=?,return_source=?,founder_explained_product=?,founder_helped_onboarding=?,founder_suggested_situation=?,founder_helped_request=?,founder_solved_problem=?,founder_prompted_return=?,trust_concern=?,product_issue=?,evidence_note=?,notion_reference_url=?,updated_at=? WHERE id=?`;
      await database3.prepare(sql).bind(
        person.participantId,
        person.status,
        person.ageBand,
        person.relationshipState,
        person.recruitmentSource,
        person.closeFriendOrTeammate ? 1 : 0,
        person.situationCategory,
        person.onboardingCompleted ? 1 : 0,
        person.meaningfulActivation ? 1 : 0,
        person.independentlyActivated ? 1 : 0,
        person.firstAnswerUseful,
        person.genuineRequestCount,
        person.usefulnessResponseCount,
        person.reminderTestCount,
        person.reminderTested ? 1 : 0,
        person.reminderDeliveryResult,
        person.reminderDestinationResult,
        person.returnSource,
        person.founderExplainedProduct ? 1 : 0,
        person.founderHelpedOnboarding ? 1 : 0,
        person.founderSuggestedSituation ? 1 : 0,
        person.founderHelpedRequest ? 1 : 0,
        person.founderSolvedProblem ? 1 : 0,
        person.founderPromptedReturn ? 1 : 0,
        person.trustConcern ? 1 : 0,
        person.productIssue ? 1 : 0,
        person.evidenceNote,
        person.notionReferenceUrl,
        timestamp,
        body.id
      ).run();
    } else if (body.action === "cohort_delete" && body.id)
      await database3.prepare(
        "DELETE FROM cohort_evidence WHERE id=? AND phase_id='phase-0'"
      ).bind(body.id).run();
    else if (body.action === "cohort_link_posthog" && body.id) {
      const distinctId = safeString(body.patch?.posthogDistinctId).trim().slice(0, 256);
      if (distinctId.length === 0)
        return Response.json({ error: "Provide a PostHog distinct_id." }, { status: 400 });
      const row = await database3.prepare("SELECT id FROM cohort_evidence WHERE id=? AND phase_id='phase-0'").bind(body.id).first();
      if (!row) return Response.json({ error: "Participant not found." }, { status: 404 });
      await database3.prepare(
        "UPDATE cohort_evidence SET posthog_distinct_id=?, updated_at=? WHERE id=?"
      ).bind(distinctId, timestamp, body.id).run();
    } else if (body.action === "advance" && body.phaseId && body.patch?.confirmed === true) {
      const tracker = await loadTracker();
      const phase = tracker.phases.find((item) => item.id === body.phaseId);
      if (!phase)
        return Response.json({ error: "Phase not found." }, { status: 404 });
      if (phase.status !== "active")
        return Response.json(
          { error: "Only an active phase can advance." },
          { status: 409 }
        );
      const unmet = phase.id === "phase-0" ? phase0Unmet(phase, tracker.releaseGates) : phase.id === "phase-1" ? (await loadPhase1State(phase)).phase1Unmet : [
        ...phase.metrics.filter((metric) => !metricPassed(metric)).map((metric) => metric.name),
        ...phase.checks.filter((check) => !check.completed).map((check) => check.label)
      ];
      if (unmet.length)
        return Response.json(
          { error: "Phase cannot advance yet.", unmet },
          { status: 409 }
        );
      const next = tracker.phases.find(
        (item) => item.position === phase.position + 1
      );
      const statements = [
        database3.prepare(
          "UPDATE phases SET status='complete',updated_at=? WHERE id=?"
        ).bind(timestamp, phase.id)
      ];
      if (next)
        statements.push(
          database3.prepare(
            "UPDATE phases SET status='ready',updated_at=? WHERE id=?"
          ).bind(timestamp, next.id)
        );
      await database3.batch(statements);
    } else
      return Response.json({ error: "Unsupported update." }, { status: 400 });
    return Response.json(await trackerResponse(request), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Unable to save changes."
      },
      {
        status: error instanceof Error && /Participant ID|Sanitized evidence/.test(error.message) ? 400 : 500
      }
    );
  }
}

// app/api/workspace/route.ts
var InputError = class extends Error {
};
var now2 = () => (/* @__PURE__ */ new Date()).toISOString();
var id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
var TASK_PRIORITIES = /* @__PURE__ */ new Set(["low", "medium", "high"]);
var MEETING_CATEGORIES = /* @__PURE__ */ new Set(["Investor", "Team", "User interview", "Advisor", "Partner", "Personal", "Other"]);
function cleanTitle(value) {
  const title = String(value ?? "").trim();
  if (!title || title.length > 160) throw new InputError("Use a task title between 1 and 160 characters.");
  return title;
}
function cleanDate(value) {
  if (value === null || value === void 0 || value === "") return null;
  const date = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new InputError("Use a valid date.");
  return date;
}
function cleanTime(value) {
  if (value === null || value === void 0 || value === "") return null;
  const time = String(value);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new InputError("Use a valid 24-hour time.");
  return time;
}
function cleanUrl(value) {
  if (value === null || value === void 0 || value === "") return "";
  try {
    const url = new URL(String(value));
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Unsafe URL");
    return url.toString();
  } catch {
    throw new InputError("Links must use http or https.");
  }
}
function inferredType(title) {
  const value = title.toLowerCase();
  if (/\breddit\b/.test(value)) return "reddit";
  if (/\binstagram\b/.test(value)) return "instagram";
  if (/\blinkedin\b/.test(value)) return "linkedin";
  if (/\byoutube\b|\bvideo\b/.test(value)) return "youtube";
  if (/\bwhatsapp\b|\bmessage\b/.test(value)) return "whatsapp";
  if (/\bemail\b|\boutreach\b/.test(value)) return "mail";
  if (/\bcall\b|\bmeeting\b/.test(value)) return "calendar";
  if (/\binvestor\b|\bfundraising\b/.test(value)) return "briefcase";
  if (/\buser interview\b|\bfeedback\b/.test(value)) return "users";
  if (/\bfigma\b|\bdesign\b/.test(value)) return "design";
  if (/\bdevelopment\b|\bbug\b|\bcode\b/.test(value)) return "code";
  if (/\banalytics\b|\bmetrics\b/.test(value)) return "chart";
  return "task";
}
function database2() {
  if (!env.DB) throw new Error("Database binding is unavailable.");
  return env.DB;
}
function indiaDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(/* @__PURE__ */ new Date());
}
async function initializeWorkspace() {
  const db2 = database2();
  await db2.batch([
    db2.prepare(`CREATE TABLE IF NOT EXISTS routines (
      id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, title TEXT NOT NULL, time TEXT NOT NULL,
      position INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    db2.prepare(`CREATE TABLE IF NOT EXISTS routine_occurrences (
      id TEXT PRIMARY KEY, routine_id TEXT NOT NULL, owner_email TEXT NOT NULL, date TEXT NOT NULL,
      title TEXT NOT NULL, time TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', note TEXT NOT NULL DEFAULT '',
      completed_at TEXT, updated_at TEXT NOT NULL
    )`),
    db2.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_routine_occurrence_unique ON routine_occurrences(routine_id, date)`),
    db2.prepare(`CREATE INDEX IF NOT EXISTS idx_routine_occurrence_owner_date ON routine_occurrences(owner_email, date)`),
    db2.prepare(`CREATE TABLE IF NOT EXISTS founder_tasks (
      id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      due_date TEXT, due_time TEXT, priority TEXT NOT NULL DEFAULT 'medium', category TEXT NOT NULL DEFAULT 'General',
      status TEXT NOT NULL DEFAULT 'open', link TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, completed_at TEXT, updated_at TEXT NOT NULL
    )`),
    db2.prepare(`CREATE INDEX IF NOT EXISTS idx_founder_tasks_owner_status_due ON founder_tasks(owner_email, status, due_date)`),
    db2.prepare(`CREATE TABLE IF NOT EXISTS diary_entries (
      id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, entry_date TEXT NOT NULL, completed TEXT NOT NULL DEFAULT '',
      moved_forward TEXT NOT NULL DEFAULT '', learned TEXT NOT NULL DEFAULT '', blocker TEXT NOT NULL DEFAULT '',
      insight TEXT NOT NULL DEFAULT '', tomorrow TEXT NOT NULL DEFAULT '', mood TEXT NOT NULL DEFAULT 'Focused',
      notes TEXT NOT NULL DEFAULT '', finished_at TEXT, updated_at TEXT NOT NULL
    )`),
    db2.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_diary_owner_date ON diary_entries(owner_email, entry_date)`),
    db2.prepare(`CREATE TABLE IF NOT EXISTS suggestions (
      id TEXT PRIMARY KEY, author_email TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Other', priority TEXT NOT NULL DEFAULT 'medium', phase_id TEXT,
      status TEXT NOT NULL DEFAULT 'new', pinned INTEGER NOT NULL DEFAULT 0, founder_priority INTEGER NOT NULL DEFAULT 0,
      founder_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    db2.prepare(`CREATE INDEX IF NOT EXISTS idx_suggestions_status_created ON suggestions(status, created_at DESC)`),
    db2.prepare(`CREATE TABLE IF NOT EXISTS suggestion_replies (
      id TEXT PRIMARY KEY, suggestion_id TEXT NOT NULL, author_email TEXT NOT NULL, body TEXT NOT NULL,
      parent_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    db2.prepare(`CREATE INDEX IF NOT EXISTS idx_suggestion_replies_suggestion ON suggestion_replies(suggestion_id, created_at)`),
    db2.prepare(`CREATE TABLE IF NOT EXISTS suggestion_votes (
      suggestion_id TEXT NOT NULL, author_email TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (suggestion_id, author_email)
    )`),
    db2.prepare(`CREATE TABLE IF NOT EXISTS founder_settings (
      owner_email TEXT PRIMARY KEY, launch_date TEXT, updated_at TEXT NOT NULL
    )`),
    db2.prepare(`CREATE TABLE IF NOT EXISTS founder_meetings (
      id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, title TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Other',
      contact TEXT NOT NULL DEFAULT '', scheduled_date TEXT NOT NULL, scheduled_time TEXT NOT NULL,
      meeting_link TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'scheduled',
      preparation_goal TEXT NOT NULL DEFAULT '', talking_points TEXT NOT NULL DEFAULT '', questions TEXT NOT NULL DEFAULT '',
      desired_next_step TEXT NOT NULL DEFAULT '', outcome TEXT NOT NULL DEFAULT '', next_step TEXT NOT NULL DEFAULT '',
      follow_up_date TEXT, private_notes TEXT NOT NULL DEFAULT '', deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    db2.prepare("CREATE INDEX IF NOT EXISTS idx_founder_meetings_owner_date ON founder_meetings(owner_email, scheduled_date, scheduled_time)")
  ]);
  const taskColumns = await db2.prepare("PRAGMA table_info(founder_tasks)").all();
  if (!taskColumns.results.some((column) => column.name === "deleted_at")) {
    await db2.prepare("ALTER TABLE founder_tasks ADD COLUMN deleted_at TEXT").run();
  }
  const routineColumns = await db2.prepare("PRAGMA table_info(routines)").all();
  const taskAdditions = ["icon_type TEXT", "icon_source TEXT NOT NULL DEFAULT 'inferred'"];
  const routineAdditions = ["icon_type TEXT", "icon_source TEXT NOT NULL DEFAULT 'inferred'", "link TEXT NOT NULL DEFAULT ''"];
  for (const addition of taskAdditions) {
    const name = addition.split(" ")[0];
    if (!taskColumns.results.some((column) => column.name === name)) await db2.prepare(`ALTER TABLE founder_tasks ADD COLUMN ${addition}`).run();
  }
  for (const addition of routineAdditions) {
    const name = addition.split(" ")[0];
    if (!routineColumns.results.some((column) => column.name === name)) await db2.prepare(`ALTER TABLE routines ADD COLUMN ${addition}`).run();
  }
  const untitledTaskIcons = await db2.prepare(`SELECT id, title FROM founder_tasks WHERE owner_email=? AND (icon_type IS NULL OR icon_type='') AND (icon_source IS NULL OR icon_source='inferred')`).bind(EDITOR_EMAIL).all();
  const untitledRoutineIcons = await db2.prepare(`SELECT id, title FROM routines WHERE owner_email=? AND (icon_type IS NULL OR icon_type='') AND (icon_source IS NULL OR icon_source='inferred')`).bind(EDITOR_EMAIL).all();
  if (untitledTaskIcons.results.length || untitledRoutineIcons.results.length) {
    await db2.batch([
      ...untitledTaskIcons.results.map((item) => db2.prepare("UPDATE founder_tasks SET icon_type=?, icon_source='inferred' WHERE id=?").bind(inferredType(item.title), item.id)),
      ...untitledRoutineIcons.results.map((item) => db2.prepare("UPDATE routines SET icon_type=?, icon_source='inferred' WHERE id=?").bind(inferredType(item.title), item.id))
    ]);
  }
  const count = await db2.prepare("SELECT COUNT(*) AS count FROM routines WHERE owner_email = ?").bind(EDITOR_EMAIL).first();
  if ((count?.count ?? 0) === 0) {
    const timestamp = now2();
    await db2.batch([
      db2.prepare("INSERT INTO routines (id, owner_email, title, time, position, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)").bind("reddit-morning", EDITOR_EMAIL, "Morning Reddit post", "10:00", 0, timestamp, timestamp),
      db2.prepare("INSERT INTO routines (id, owner_email, title, time, position, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)").bind("reddit-evening", EDITOR_EMAIL, "Evening Reddit post", "19:00", 1, timestamp, timestamp),
      db2.prepare("INSERT INTO routines (id, owner_email, title, time, position, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)").bind("reddit-night", EDITOR_EMAIL, "Night Reddit post", "22:00", 2, timestamp, timestamp)
    ]);
  }
  const misplaced = await db2.prepare("SELECT * FROM routines WHERE owner_email = ? AND lower(trim(title)) = 'plan all'").bind(EDITOR_EMAIL).all();
  if (misplaced.results.length) {
    const timestamp = now2();
    const date = indiaDate();
    await db2.batch(misplaced.results.flatMap((routine) => [
      db2.prepare(`INSERT OR IGNORE INTO founder_tasks
        (id, owner_email, title, description, due_date, due_time, priority, category, status, link, position, created_at, updated_at)
        VALUES (?, ?, ?, '', ?, ?, 'medium', 'Founder', 'open', '', 0, ?, ?)`).bind(`migrated-${String(routine.id)}`, EDITOR_EMAIL, String(routine.title), date, String(routine.time), timestamp, timestamp),
      db2.prepare("DELETE FROM routine_occurrences WHERE routine_id = ? AND owner_email = ? AND date = ?").bind(String(routine.id), EDITOR_EMAIL, date),
      db2.prepare("UPDATE routines SET active = 0, updated_at = ? WHERE id = ?").bind(timestamp, String(routine.id))
    ]));
  }
}
var workspaceSetup = null;
function ensureWorkspace() {
  if (!workspaceSetup) {
    workspaceSetup = initializeWorkspace().catch((error) => {
      workspaceSetup = null;
      throw error;
    });
  }
  return workspaceSetup;
}
async function ensureToday(ownerEmail) {
  const db2 = database2();
  const date = indiaDate();
  const routines = await db2.prepare("SELECT * FROM routines WHERE owner_email = ? AND active = 1 ORDER BY position").bind(ownerEmail).all();
  const timestamp = now2();
  await db2.batch(routines.results.map((routine) => db2.prepare(`INSERT OR IGNORE INTO routine_occurrences
    (id, routine_id, owner_email, date, title, time, status, note, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', '', ?)`).bind(`${String(routine.id)}-${date}`, String(routine.id), ownerEmail, date, String(routine.title), String(routine.time), timestamp)));
  return date;
}
function requireEditor(access) {
  if (!access.canEdit) throw new Response(JSON.stringify({ error: "Only Sarthak can access this workspace." }), { status: 403, headers: { "Content-Type": "application/json" } });
}
async function founderData(access) {
  requireEditor(access);
  await ensureWorkspace();
  const date = await ensureToday(EDITOR_EMAIL);
  const db2 = database2();
  const [routines, tasks, diary, diaryHistory, meetings, settings] = await Promise.all([
    db2.prepare(`SELECT routine_occurrences.*, routines.icon_type, routines.icon_source, routines.link
      FROM routine_occurrences LEFT JOIN routines ON routines.id = routine_occurrences.routine_id
      WHERE routine_occurrences.owner_email = ? AND routine_occurrences.date = ? ORDER BY routine_occurrences.time`).bind(EDITOR_EMAIL, date).all(),
    db2.prepare(`SELECT * FROM founder_tasks WHERE owner_email = ? AND deleted_at IS NULL
      ORDER BY CASE status WHEN 'complete' THEN 1 ELSE 0 END, due_date IS NULL, due_date, due_time IS NULL, due_time, position, created_at DESC`).bind(EDITOR_EMAIL).all(),
    db2.prepare("SELECT * FROM diary_entries WHERE owner_email = ? AND entry_date = ?").bind(EDITOR_EMAIL, date).first(),
    db2.prepare("SELECT entry_date, mood, finished_at FROM diary_entries WHERE owner_email = ? ORDER BY entry_date DESC LIMIT 14").bind(EDITOR_EMAIL).all(),
    db2.prepare("SELECT * FROM founder_meetings WHERE owner_email = ? AND deleted_at IS NULL ORDER BY scheduled_date, scheduled_time").bind(EDITOR_EMAIL).all(),
    db2.prepare("SELECT launch_date FROM founder_settings WHERE owner_email = ?").bind(EDITOR_EMAIL).first()
  ]);
  return { date, routines: routines.results, tasks: tasks.results, diary: diary ?? null, diaryHistory: diaryHistory.results, meetings: meetings.results, launchDate: settings?.launch_date ?? null, integrations: { googleCalendar: false, zohoEmail: false } };
}
async function suggestionData(access) {
  await ensureWorkspace();
  const db2 = database2();
  const [suggestions, replies, votes] = await Promise.all([
    db2.prepare("SELECT * FROM suggestions ORDER BY pinned DESC, founder_priority DESC, created_at DESC").all(),
    db2.prepare("SELECT * FROM suggestion_replies ORDER BY created_at").all(),
    db2.prepare("SELECT suggestion_id, COUNT(*) AS count FROM suggestion_votes GROUP BY suggestion_id").all()
  ]);
  return { suggestions: suggestions.results, replies: replies.results, votes: votes.results, viewerEmail: access.viewerEmail, canEdit: access.canEdit };
}
async function GET2(request) {
  try {
    const access = await trackerAccess(request);
    if (!access.authenticated) return Response.json({ authenticated: false }, { status: 401 });
    const view = new URL(request.url).searchParams.get("view");
    if (view === "sarthak") return Response.json(await founderData(access));
    if (view === "suggestions") return Response.json(await suggestionData(access));
    return Response.json({ error: "Unknown workspace view." }, { status: 400 });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof InputError) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load workspace." }, { status: 500 });
  }
}
async function POST(request) {
  try {
    const access = await trackerAccess(request);
    if (!access.authenticated) return Response.json({ error: "Sign in required." }, { status: 401 });
    await ensureWorkspace();
    const body = await request.json();
    const db2 = database2();
    const timestamp = now2();
    if (body.action.startsWith("task_") || body.action.startsWith("routine_") || body.action.startsWith("diary_") || body.action.startsWith("meeting_") || body.action === "settings_update") requireEditor(access);
    if (body.action === "task_create") {
      const p = body.patch ?? {};
      const title = cleanTitle(p.title);
      const priority = String(p.priority ?? "medium");
      if (!TASK_PRIORITIES.has(priority)) throw new Error("Use a valid priority.");
      const iconSource = p.iconSource === "manual" ? "manual" : "inferred";
      const iconType = iconSource === "manual" && p.iconType ? String(p.iconType) : inferredType(title);
      await db2.prepare(`INSERT INTO founder_tasks (id, owner_email, title, description, due_date, due_time, priority, category, status, link, icon_type, icon_source, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, 0, ?, ?)`).bind(id("task"), EDITOR_EMAIL, title, String(p.description ?? ""), cleanDate(p.dueDate), cleanTime(p.dueTime), priority, String(p.category ?? "General"), cleanUrl(p.link), iconType, iconSource, timestamp, timestamp).run();
    } else if (body.action === "task_reorder") {
      const order = Array.isArray(body.patch?.order) ? body.patch.order.map(String) : [];
      if (order.length) {
        await db2.batch(order.map((taskId, position) => db2.prepare(`UPDATE founder_tasks
          SET position = ?, updated_at = ?
          WHERE id = ? AND owner_email = ? AND deleted_at IS NULL`).bind(position, timestamp, taskId, EDITOR_EMAIL)));
      }
    } else if (body.action === "task_update" && body.id) {
      const p = body.patch ?? {};
      const status = String(p.status ?? "open");
      const title = cleanTitle(p.title);
      const priority = String(p.priority ?? "medium");
      if (!TASK_PRIORITIES.has(priority) || !["open", "complete"].includes(status)) throw new Error("Use valid task details.");
      const iconSource = p.iconSource === "manual" ? "manual" : "inferred";
      const iconType = iconSource === "manual" && p.iconType ? String(p.iconType) : inferredType(title);
      await db2.prepare(`UPDATE founder_tasks SET title=?, description=?, due_date=?, due_time=?, priority=?, category=?, status=?, link=?, icon_type=?, icon_source=?, completed_at=?, updated_at=? WHERE id=? AND owner_email=?`).bind(title, String(p.description ?? ""), cleanDate(p.dueDate), cleanTime(p.dueTime), priority, String(p.category ?? "General"), status, cleanUrl(p.link), iconType, iconSource, status === "complete" ? timestamp : null, timestamp, body.id, EDITOR_EMAIL).run();
    } else if (body.action === "task_delete" && body.id) {
      await db2.prepare("UPDATE founder_tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND owner_email = ?").bind(timestamp, timestamp, body.id, EDITOR_EMAIL).run();
    } else if (body.action === "task_restore" && body.id) {
      await db2.prepare("UPDATE founder_tasks SET deleted_at = NULL, updated_at = ? WHERE id = ? AND owner_email = ?").bind(timestamp, body.id, EDITOR_EMAIL).run();
    } else if (body.action === "routine_create") {
      const p = body.patch ?? {};
      const next = await db2.prepare("SELECT COALESCE(MAX(position), -1) AS position FROM routines WHERE owner_email = ?").bind(EDITOR_EMAIL).first();
      const title = cleanTitle(p.title);
      const iconSource = p.iconSource === "manual" ? "manual" : "inferred";
      await db2.prepare("INSERT INTO routines (id, owner_email, title, time, icon_type, icon_source, link, position, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)").bind(id("routine"), EDITOR_EMAIL, title, cleanTime(p.time) ?? "09:00", iconSource === "manual" && p.iconType ? String(p.iconType) : inferredType(title), iconSource, cleanUrl(p.link), Number(next?.position ?? -1) + 1, timestamp, timestamp).run();
    } else if (body.action === "routine_update" && body.id) {
      const p = body.patch ?? {};
      await db2.prepare("UPDATE routine_occurrences SET status=?, note=?, updated_at=?, completed_at=? WHERE id=? AND owner_email=?").bind(String(p.status ?? "pending"), String(p.note ?? ""), timestamp, p.status === "completed" || p.status === "skipped" ? timestamp : null, body.id, EDITOR_EMAIL).run();
    } else if (body.action === "routine_edit" && body.id) {
      const p = body.patch ?? {};
      const date = indiaDate();
      const title = cleanTitle(p.title);
      const iconSource = p.iconSource === "manual" ? "manual" : "inferred";
      const time = cleanTime(p.time) ?? "09:00";
      await db2.batch([
        db2.prepare("UPDATE routines SET title=?, time=?, icon_type=?, icon_source=?, link=?, updated_at=? WHERE id=? AND owner_email=?").bind(title, time, iconSource === "manual" && p.iconType ? String(p.iconType) : inferredType(title), iconSource, cleanUrl(p.link), timestamp, body.id, EDITOR_EMAIL),
        db2.prepare("UPDATE routine_occurrences SET title=?, time=?, updated_at=? WHERE routine_id=? AND owner_email=? AND date=?").bind(title, time, timestamp, body.id, EDITOR_EMAIL, date)
      ]);
    } else if (body.action === "routine_delete" && body.id) {
      const date = indiaDate();
      await db2.batch([
        db2.prepare("UPDATE routines SET active=0, updated_at=? WHERE id=? AND owner_email=?").bind(timestamp, body.id, EDITOR_EMAIL),
        db2.prepare("DELETE FROM routine_occurrences WHERE routine_id=? AND owner_email=? AND date=?").bind(body.id, EDITOR_EMAIL, date)
      ]);
    } else if (body.action === "routine_restore" && body.id) {
      await db2.prepare("UPDATE routines SET active=1, updated_at=? WHERE id=? AND owner_email=?").bind(timestamp, body.id, EDITOR_EMAIL).run();
    } else if (body.action === "meeting_create") {
      const p = body.patch ?? {};
      const category = String(p.category ?? "Other");
      if (!MEETING_CATEGORIES.has(category)) throw new Error("Use a valid meeting category.");
      await db2.prepare(`INSERT INTO founder_meetings
        (id, owner_email, title, category, contact, scheduled_date, scheduled_time, meeting_link, description, status, preparation_goal, talking_points, questions, desired_next_step, outcome, next_step, follow_up_date, private_notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', '', '', '', '', '', '', NULL, '', ?, ?)`).bind(id("meeting"), EDITOR_EMAIL, cleanTitle(p.title), category, String(p.contact ?? ""), cleanDate(p.date) ?? indiaDate(), cleanTime(p.time) ?? "09:00", cleanUrl(p.meetingLink), String(p.description ?? ""), timestamp, timestamp).run();
    } else if (body.action === "meeting_update" && body.id) {
      const p = body.patch ?? {};
      const category = String(p.category ?? "Other");
      const status = String(p.status ?? "scheduled");
      if (!MEETING_CATEGORIES.has(category) || !["scheduled", "follow-up", "followed-up", "cancelled"].includes(status)) throw new Error("Use valid meeting details.");
      await db2.prepare(`UPDATE founder_meetings SET title=?, category=?, contact=?, scheduled_date=?, scheduled_time=?, meeting_link=?, description=?, status=?, preparation_goal=?, talking_points=?, questions=?, desired_next_step=?, outcome=?, next_step=?, follow_up_date=?, private_notes=?, updated_at=? WHERE id=? AND owner_email=?`).bind(cleanTitle(p.title), category, String(p.contact ?? ""), cleanDate(p.date) ?? indiaDate(), cleanTime(p.time) ?? "09:00", cleanUrl(p.meetingLink), String(p.description ?? ""), status, String(p.preparationGoal ?? ""), String(p.talkingPoints ?? ""), String(p.questions ?? ""), String(p.desiredNextStep ?? ""), String(p.outcome ?? ""), String(p.nextStep ?? ""), cleanDate(p.followUpDate), String(p.privateNotes ?? ""), timestamp, body.id, EDITOR_EMAIL).run();
    } else if (body.action === "meeting_delete" && body.id) {
      await db2.prepare("UPDATE founder_meetings SET deleted_at=?, updated_at=? WHERE id=? AND owner_email=?").bind(timestamp, timestamp, body.id, EDITOR_EMAIL).run();
    } else if (body.action === "meeting_restore" && body.id) {
      await db2.prepare("UPDATE founder_meetings SET deleted_at=NULL, updated_at=? WHERE id=? AND owner_email=?").bind(timestamp, body.id, EDITOR_EMAIL).run();
    } else if (body.action === "settings_update") {
      const p = body.patch ?? {};
      await db2.prepare(`INSERT INTO founder_settings (owner_email, launch_date, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(owner_email) DO UPDATE SET launch_date=excluded.launch_date, updated_at=excluded.updated_at`).bind(EDITOR_EMAIL, cleanDate(p.launchDate), timestamp).run();
    } else if (body.action === "diary_save") {
      const p = body.patch ?? {};
      const entryDate = String(p.entryDate ?? indiaDate());
      let completed = String(p.completed ?? "");
      if (p.finished && !completed) {
        const [finishedTasks, finishedRoutines] = await Promise.all([
          db2.prepare(`SELECT title FROM founder_tasks WHERE owner_email=? AND status='complete' AND deleted_at IS NULL AND (due_date IS NULL OR due_date <= ?) ORDER BY completed_at`).bind(EDITOR_EMAIL, entryDate).all(),
          db2.prepare(`SELECT title, status FROM routine_occurrences WHERE owner_email=? AND date=? AND status IN ('completed', 'skipped') ORDER BY time`).bind(EDITOR_EMAIL, entryDate).all()
        ]);
        completed = [...finishedTasks.results.map((item) => item.title), ...finishedRoutines.results.map((item) => `${item.title}${item.status === "skipped" ? " (Skipped)" : ""}`)].join(" \xB7 ");
      }
      await db2.prepare(`INSERT INTO diary_entries (id, owner_email, entry_date, completed, moved_forward, learned, blocker, insight, tomorrow, mood, notes, finished_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_email, entry_date) DO UPDATE SET completed=excluded.completed, moved_forward=excluded.moved_forward, learned=excluded.learned, blocker=excluded.blocker, insight=excluded.insight, tomorrow=excluded.tomorrow, mood=excluded.mood, notes=excluded.notes, finished_at=excluded.finished_at, updated_at=excluded.updated_at`).bind(`diary-${entryDate}`, EDITOR_EMAIL, entryDate, completed, String(p.movedForward ?? ""), String(p.learned ?? ""), String(p.blocker ?? ""), String(p.insight ?? ""), String(p.tomorrow ?? ""), String(p.mood ?? "Focused"), String(p.notes ?? ""), p.finished ? timestamp : null, timestamp).run();
    } else if (body.action === "suggestion_create") {
      const p = body.patch ?? {};
      await db2.prepare(`INSERT INTO suggestions (id, author_email, title, body, category, priority, phase_id, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`).bind(id("suggestion"), access.viewerEmail, String(p.title ?? "").trim(), String(p.body ?? "").trim(), String(p.category ?? "Other"), String(p.priority ?? "medium"), p.phaseId ? String(p.phaseId) : null, timestamp, timestamp).run();
    } else if (body.action === "suggestion_reply" && body.suggestionId) {
      const p = body.patch ?? {};
      await db2.prepare("INSERT INTO suggestion_replies (id, suggestion_id, author_email, body, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id("reply"), body.suggestionId, access.viewerEmail, String(p.body ?? "").trim(), p.parentId ? String(p.parentId) : null, timestamp, timestamp).run();
    } else if (body.action === "suggestion_vote" && body.suggestionId) {
      const existing = await db2.prepare("SELECT suggestion_id FROM suggestion_votes WHERE suggestion_id=? AND author_email=?").bind(body.suggestionId, access.viewerEmail).first();
      if (existing) await db2.prepare("DELETE FROM suggestion_votes WHERE suggestion_id=? AND author_email=?").bind(body.suggestionId, access.viewerEmail).run();
      else await db2.prepare("INSERT INTO suggestion_votes (suggestion_id, author_email, created_at) VALUES (?, ?, ?)").bind(body.suggestionId, access.viewerEmail, timestamp).run();
    } else if (body.action === "suggestion_manage" && body.suggestionId) {
      requireEditor(access);
      const p = body.patch ?? {};
      await db2.prepare("UPDATE suggestions SET status=?, pinned=?, founder_priority=?, founder_note=?, phase_id=?, updated_at=? WHERE id=?").bind(String(p.status ?? "new"), p.pinned ? 1 : 0, p.founderPriority ? 1 : 0, String(p.founderNote ?? ""), p.phaseId ? String(p.phaseId) : null, timestamp, body.suggestionId).run();
    } else {
      return Response.json({ error: "Unsupported action." }, { status: 400 });
    }
    const view = body.action.startsWith("suggestion") ? "suggestions" : "sarthak";
    return Response.json(view === "suggestions" ? await suggestionData(access) : await founderData(access));
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof InputError) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save workspace." }, { status: 500 });
  }
}

// app/api/auth/login/route.ts
async function POST2(request) {
  if (!process.env.SPARKEEFY_LOGIN_PASSWORD) return Response.json({ error: "Password login is disabled. This deployment is view-only." }, { status: 403 });
  try {
    const body = await request.json();
    const email = typeof body.email === "string" ? normaliseEmail(body.email) : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!emailIsAllowed(email) || !await passwordMatches(password)) {
      return Response.json({ error: "That email or password is not recognised." }, { status: 401 });
    }
    return Response.json(
      { email, canEdit: email === EDITOR_EMAIL },
      { headers: { "Set-Cookie": await sessionCookie(email), "Cache-Control": "no-store" } }
    );
  } catch {
    return Response.json({ error: "Unable to sign in. Please try again." }, { status: 400 });
  }
}

// app/api/auth/logout/route.ts
async function POST3() {
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie(), "Cache-Control": "no-store" } });
}

// lib/analytics-v2/model.ts
var COHORTS = [
  "all",
  "phase-0",
  "phase-1a",
  "phase-1b",
  "phase-2"
];
var DAYS = [1, 3, 7, 15, 30];
var missing = (detail, source = "PostHog", state = "not-connected") => ({ value: null, state, source, detail });
var measured = (value, detail, source = "PostHog") => ({ value, state: "available", source, detail });
function ratio(numerator, denominator, detail, pending2 = 0) {
  return {
    value: denominator ? numerator / denominator * 100 : null,
    numerator,
    denominator,
    pending: pending2,
    state: denominator ? "available" : pending2 ? "not-eligible" : "no-data",
    source: "PostHog",
    detail,
    unit: "%"
  };
}
var DAY2 = 864e5;
function periodStart(period, now3) {
  return period === "all" ? -Infinity : period === "today" ? Math.floor((now3 + 198e5) / DAY2) * DAY2 - 198e5 : now3 - (period === "7d" ? 7 : 30) * DAY2;
}
function calculate(data, cohort, period) {
  const now3 = Date.parse(data.asOf), since = periodStart(period, now3);
  const selectedMembers = data.members.filter(
    (m) => !m.internal && !m.test && (cohort === "all" || m.cohort === cohort) && Date.parse(m.from) <= now3
  );
  const grouped = /* @__PURE__ */ new Map();
  for (const m of selectedMembers.sort(
    (a, b) => a.from.localeCompare(b.from)
  )) {
    const previous = grouped.get(m.id);
    if (!previous)
      grouped.set(m.id, {
        ...m,
        intervals: [{ from: m.from, to: m.to }],
        cohorts: [m.cohort]
      });
    else {
      previous.intervals.push({ from: m.from, to: m.to });
      if (!previous.cohorts.includes(m.cohort))
        previous.cohorts.push(m.cohort);
      if (m.firstOpen && (!previous.firstOpen || m.firstOpen < previous.firstOpen))
        previous.firstOpen = m.firstOpen;
    }
  }
  const members = [...grouped.values()];
  const observed = members.filter(
    (m) => m.firstOpen && Date.parse(m.firstOpen) <= now3
  );
  const has = (cap) => data.capabilities.includes(cap);
  const unavailable2 = (cap) => missing(
    data.state !== "available" ? data.detail : `Awaiting verified ${cap} instrumentation.`,
    "PostHog",
    data.state !== "available" ? data.state : "not-connected"
  );
  const facts = /* @__PURE__ */ new Map();
  for (const m of members) {
    const dedup = /* @__PURE__ */ new Map();
    for (const f of data.facts)
      if (!f.internal && !f.test && f.user === m.id && Date.parse(f.at) <= now3 && m.intervals.some(
        (interval) => Date.parse(f.at) >= Date.parse(interval.from) && (!interval.to || Date.parse(f.at) < Date.parse(interval.to))
      )) {
        const key = ["message", "complete", "failed"].includes(f.kind) && f.request ? `${f.kind}:${f.request}` : f.id;
        const previous = dedup.get(key);
        if (!previous || f.at < previous.at) dedup.set(key, f);
      }
    facts.set(m.id, [...dedup.values()]);
  }
  const selected = (m, start = since) => (facts.get(m.id) ?? []).filter((f) => Date.parse(f.at) >= start);
  const all = members.flatMap((m) => selected(m));
  const count = (cap, value, detail) => data.state !== "available" || !has(cap) ? unavailable2(cap) : members.length ? measured(value, detail) : missing("No members in this cohort.", "Reconciled", "no-data");
  const usersWith2 = (cap, pred, detail) => count(cap, members.filter((m) => selected(m).some(pred)).length, detail);
  const firstMilestone = (cap, kind) => count(
    cap,
    members.filter((m) => {
      const first = (facts.get(m.id) ?? []).filter((f) => f.kind === kind).map((f) => Date.parse(f.at)).sort((a, b) => a - b)[0];
      return first !== void 0 && first >= since && m.firstOpen !== null && Date.parse(m.firstOpen) >= Date.parse(data.coverageFrom);
    }).length,
    `Users whose first observed ${kind} in this cohort occurred in the selected period. Requires coverage from first open.`
  );
  const milestone = (kind, field, n) => usersWith2(
    field === "people" ? "people" : "memory",
    (f) => f.kind === kind && (f[field] ?? -1) >= n,
    `Unique users with a recorded ${field} count of at least ${n} in the selected period. Not a conversion funnel.`
  );
  const activeKinds = /* @__PURE__ */ new Set([
    "app",
    "first_open",
    "onboarding",
    "person",
    "memory",
    "wingman",
    "message",
    "calendar",
    "situation"
  ]);
  const active = members.filter(
    (m) => selected(m).some((f) => activeKinds.has(f.kind))
  );
  const retained = (type, day, population = observed) => {
    const cap = type === "app" ? "app-return" : type === "wingman" ? "wingman" : "situations";
    if (data.state !== "available" || !has(cap)) return unavailable2(cap);
    let eligible = 0, returned = 0, pending2 = 0, open = 0;
    for (const m of population) {
      if (!m.firstOpen) continue;
      const start = Date.parse(m.firstOpen) + day * DAY2, end = start + DAY2;
      if (!m.intervals.some(
        (interval) => start >= Date.parse(interval.from) && (!interval.to || end <= Date.parse(interval.to))
      ))
        continue;
      if (start > now3) {
        pending2++;
        continue;
      }
      if (end <= now3 && end < since) continue;
      if (Date.parse(m.firstOpen) < Date.parse(data.coverageFrom)) continue;
      eligible++;
      if (end > now3) open++;
      if ((facts.get(m.id) ?? []).some(
        (f) => Date.parse(f.at) >= start && Date.parse(f.at) < end && (type === "app" ? activeKinds.has(f.kind) : type === "wingman" ? f.kind === "message" : f.kind === "situation")
      ))
        returned++;
    }
    return ratio(
      returned,
      eligible,
      `D${day}: [${day * 24}, ${(day + 1) * 24}) hours after each user's first open. Live progress: ${open} of ${eligible} windows are still open and may still convert; ${pending2} users have not reached this window yet.`,
      pending2
    );
  };
  const retentionFor = (population = observed) => Object.fromEntries(
    ["app", "wingman", "situation"].map((type) => [
      type,
      Object.fromEntries(
        DAYS.map((day) => [`d${day}`, retained(type, day, population)])
      )
    ])
  );
  const average = (cap, values, detail) => data.state !== "available" || !has(cap) ? unavailable2(cap) : !values.length ? missing("No observed users.", "PostHog", "no-data") : count(cap, values.reduce((a, b) => a + b, 0) / values.length, detail);
  const volume = (cap, kind, start, population = members.filter(
    (m) => selected(m, Math.max(since, start)).some((f) => activeKinds.has(f.kind))
  )) => average(
    cap,
    population.map(
      (m) => selected(m, Math.max(since, start)).filter((f) => f.kind === kind).length
    ),
    "Average number of Wingman messages sent per active user in this window (only users active in the window count). The named window is intersected with the global time filter \u2014 e.g. with Time = 7D, the 30D tile also covers 7 days."
  );
  const second = (m, organic = false) => {
    const situations = (facts.get(m.id) ?? []).filter((f) => f.kind === "situation" && f.situation).sort((a, b) => a.at.localeCompare(b.at));
    const seen = /* @__PURE__ */ new Set();
    for (const f of situations) {
      if (seen.has(f.situation)) continue;
      seen.add(f.situation);
      if (seen.size === 2)
        return Date.parse(f.at) >= since && (!organic || f.attribution === "organic" && f.assisted === false);
    }
    return false;
  };
  const metrics = {
    active: count(
      "activity",
      active.length,
      "Unique users with a foreground/product activity event; background response events are excluded."
    ),
    activated: has("activation") && data.state === "available" ? ratio(
      members.filter(
        (m) => selected(m).some((f) => f.kind === "onboarding") && selected(m).some((f) => f.kind === "activated")
      ).length,
      members.filter(
        (m) => selected(m).some((f) => f.kind === "onboarding")
      ).length,
      "Verified meaningful activation among users who onboarded in this period; requires reconciled qualification, not just five messages."
    ) : unavailable2("activation"),
    downloads: missing(
      "Play Console store-level downloads are not individual first opens. No store connector configured.",
      "Play Console"
    ),
    first_opens: usersWith2(
      "activity",
      (f) => f.kind === "first_open",
      "Unique first app opens in the selected period."
    ),
    onboarded: usersWith2(
      "onboarding",
      (f) => f.kind === "onboarding",
      "Unique users completing onboarding in the selected period."
    ),
    wingman_opened: usersWith2(
      "wingman",
      (f) => f.kind === "wingman",
      "Unique users opening Wingman in the selected period."
    ),
    first_message: firstMilestone("wingman", "message"),
    first_answer: firstMilestone("responses", "complete"),
    five_messages: count(
      "wingman",
      members.filter(
        (m) => selected(m).filter((f) => f.kind === "message").length >= 5
      ).length,
      "Users sending at least five distinct requests in the selected period."
    ),
    second_situation: count(
      "situations",
      members.filter((m) => second(m)).length,
      "Users whose second distinct, verified genuine situation occurred in the selected period. A message is not a situation."
    ),
    organic_second: has("situations") && has("attribution") ? count(
      "situations",
      members.filter((m) => second(m, true)).length,
      "Second verified situation, independently initiated and positively attributed organic. Unknown attribution is excluded, not assumed organic."
    ) : unavailable2("attribution"),
    messages_day: volume("wingman", "message", periodStart("today", now3)),
    messages_7d: volume("wingman", "message", now3 - 7 * DAY2),
    messages_30d: volume("wingman", "message", now3 - 30 * DAY2),
    sessions: average(
      "sessions",
      active.map(
        (m) => new Set(
          selected(m).filter((f) => f.kind === "message" || f.kind === "wingman").map((f) => f.session).filter(Boolean)
        ).size
      ),
      "Distinct Wingman session IDs per active user. Never approximated as calendar days."
    ),
    people_used: count(
      "people-use",
      new Set(
        all.filter((f) => f.kind === "message" && f.person).map((f) => `${f.user}:${f.person}`)
      ).size,
      "Distinct user/person pairs actually used with Wingman in this period."
    ),
    people_used_2: count(
      "people-use",
      members.filter(
        (m) => new Set(
          selected(m).filter((f) => f.kind === "message").map((f) => f.person).filter(Boolean)
        ).size >= 2
      ).length,
      "Users who used Wingman with two or more distinct saved people in this period."
    ),
    memory_reused: usersWith2(
      "memory-reuse",
      (f) => f.kind === "memory_reused",
      "Users with a verified later request using previously saved memory context; memory creation is not reuse."
    )
  };
  for (const n of [1, 2, 3, 5])
    metrics[`people_${n}`] = milestone("person", "people", n);
  for (const n of [1, 3, 5, 20])
    metrics[`memory_${n}`] = milestone("memory", "memories", n);
  const peak = (m, field) => Math.max(0, ...(facts.get(m.id) ?? []).map((f) => f[field] ?? 0));
  metrics.people_average = average(
    "people",
    active.map((m) => peak(m, "people")),
    "Average observed peak people count per active user in the selected period; not current inventory after deletion."
  );
  metrics.memory_average = average(
    "memory",
    active.map((m) => peak(m, "memories")),
    "Average observed peak memory count per active user in the selected period; not current inventory after deletion."
  );
  const mem = active.map((m) => peak(m, "memories")).sort((a, b) => a - b);
  metrics.memory_median = data.state !== "available" || !has("memory") ? unavailable2("memory") : mem.length ? count(
    "memory",
    (mem[Math.floor((mem.length - 1) / 2)] + mem[Math.floor(mem.length / 2)]) / 2,
    "Median observed peak memory count among active users in the selected period."
  ) : missing("No observed users.", "PostHog", "no-data");
  const requests = all.filter((f) => f.kind === "message");
  const completed = all.filter((f) => f.kind === "complete");
  const completedIds = new Set(
    completed.map((f) => `${f.user}:${f.request ?? f.id}`)
  );
  const failed = all.filter(
    (f) => f.kind === "failed" && !completedIds.has(`${f.user}:${f.request ?? f.id}`)
  );
  metrics.complete = count(
    "responses",
    completed.length,
    "Completed unique requests; retries deduplicated by request ID."
  );
  metrics.failed = count(
    "responses",
    failed.length,
    "Failed requests without a completion in this period. Pending requests are not failures."
  );
  metrics.success = has("responses") && data.state === "available" ? ratio(
    completed.length,
    completed.length + failed.length,
    "Completed / resolved requests. In-flight requests excluded; late successes reconcile failures."
  ) : unavailable2("responses");
  for (const [key, cap, kind] of [
    ["retries", "retries", "retry"],
    ["fallbacks", "fallbacks", "fallback"]
  ])
    metrics[key] = count(
      cap,
      all.filter((f) => f.kind === kind).length,
      `Recorded ${key} events in the selected period.`
    );
  const latencies = completed.map((f) => f.latency).filter((n) => n !== void 0).sort((a, b) => a - b);
  for (const [key, q] of [
    ["latency_median", 0.5],
    ["latency_p95", 0.95]
  ])
    metrics[key] = !has("latency") ? unavailable2("latency") : latencies.length ? {
      ...count(
        "latency",
        latencies[Math.max(0, Math.ceil(q * latencies.length) - 1)],
        "Nearest-rank latency over complete responses in milliseconds."
      ),
      unit: "ms"
    } : missing("No latency observations.", "Backend", "no-data");
  metrics.requests = count(
    "wingman",
    requests.length,
    "Unique user requests in the selected period, excluding automatic retries."
  );
  const usage = all.filter((f) => f.kind === "usage");
  for (const [key, field] of [
    ["input_tokens", "input"],
    ["output_tokens", "output"],
    ["cost", "cost"]
  ]) {
    const cap = field === "cost" ? "cost" : "tokens";
    metrics[key] = !has(cap) || data.state !== "available" ? unavailable2(cap) : !usage.length || usage.some((f) => f[field] === void 0) ? missing(
      "No complete billing coverage; totals withheld.",
      "Backend",
      "no-data"
    ) : {
      ...count(
        cap,
        usage.reduce((sum, f) => sum + (f[field] ?? 0), 0),
        "Sum over all billable usage records, including retries/failures; verified complete coverage required."
      ),
      source: "Backend",
      ...field === "cost" ? { unit: "USD" } : {}
    };
  }
  metrics.total_tokens = metrics.input_tokens.state === "available" && metrics.output_tokens.state === "available" ? measured(
    metrics.input_tokens.value + metrics.output_tokens.value,
    "Input plus output tokens.",
    "Backend"
  ) : missing(
    "Awaiting complete token telemetry.",
    "Backend",
    metrics.input_tokens.state !== "available" ? metrics.input_tokens.state : metrics.output_tokens.state
  );
  for (const [key, denom] of [
    ["cost_request", "requests"],
    ["cost_active", "active"],
    ["cost_activation", "activated"],
    ["cost_repeater", "organic_second"]
  ]) {
    const d = denom === "activated" ? metrics[denom].numerator : metrics[denom].value;
    metrics[key] = metrics.cost.state === "available" && metrics[denom].state === "available" && d ? {
      ...measured(
        metrics.cost.value / d,
        `Measured AI cost / ${denom.replaceAll("_", " ")} in the same selected period.`,
        "Backend"
      ),
      unit: "USD"
    } : missing(
      "Awaiting measured cost and a non-zero, verified denominator.",
      "Backend",
      metrics.cost.state !== "available" ? metrics.cost.state : metrics[denom].state !== "available" ? metrics[denom].state : "no-data"
    );
  }
  const users = observed.map((m) => {
    const uf = selected(m);
    const um = {
      onboarding: count(
        "onboarding",
        (facts.get(m.id) ?? []).some((f) => f.kind === "onboarding") ? 1 : 0,
        "Onboarding status as of the latest source snapshot, within cohort boundaries."
      ),
      people: count(
        "people",
        peak(m, "people"),
        "Observed peak people count in selected period."
      ),
      memories: count(
        "memory",
        peak(m, "memories"),
        "Observed peak memory count in selected period."
      ),
      people_used: count(
        "people-use",
        new Set(
          uf.filter((f) => f.kind === "message").map((f) => f.person).filter(Boolean)
        ).size,
        "Distinct people used with Wingman."
      ),
      second_situation: count(
        "situations",
        second(m) ? 1 : 0,
        "Second verified situation in selected period."
      ),
      independent: count(
        "attribution",
        uf.filter((f) => f.kind === "message" && f.assisted === false).length,
        "Messages explicitly marked independent. Unknowns are not independent."
      ),
      assisted: count(
        "attribution",
        uf.filter((f) => f.kind === "message" && f.assisted === true).length,
        "Messages explicitly marked assisted."
      )
    };
    for (const p of ["today", "7d", "30d"]) {
      const fs = selected(m, Math.max(since, periodStart(p, now3)));
      um[`messages_${p}`] = count(
        "wingman",
        fs.filter((f) => f.kind === "message").length,
        `${p} intersected with global time filter.`
      );
      um[`sessions_${p}`] = count(
        "sessions",
        new Set(
          fs.filter((f) => f.kind === "message" || f.kind === "wingman").map((f) => f.session).filter(Boolean)
        ).size,
        "Distinct Wingman session IDs."
      );
      um[`time_${p}`] = {
        ...count(
          "foreground",
          fs.filter((f) => f.kind === "foreground").reduce((sum, f) => sum + (f.seconds ?? 0), 0),
          "Sum of deduplicated foreground duration events; background time excluded."
        ),
        unit: "seconds"
      };
      um[`days_${p}`] = count(
        "activity",
        new Set(
          fs.filter((f) => activeKinds.has(f.kind)).map((f) => Math.floor((Date.parse(f.at) + 198e5) / DAY2))
        ).size,
        "Distinct active calendar days in Asia/Kolkata."
      );
    }
    for (const a of ["organic", "reminder", "founder", "unknown"])
      um[`return_${a}`] = count(
        "attribution",
        uf.filter(
          (f) => f.kind === "message" && Date.parse(f.at) >= Date.parse(m.firstOpen) + DAY2 && (f.attribution ?? "unknown") === a
        ).length,
        `Return requests after the first 24 hours, attributed ${a}. This is attribution, not causal proof.`
      );
    return {
      id: m.id,
      cohort: m.cohort,
      cohorts: m.cohorts,
      acquisition: m.acquisition,
      firstOpen: m.firstOpen,
      lastActive: (facts.get(m.id) ?? []).filter((f) => activeKinds.has(f.kind)).map((f) => f.at).sort().at(-1) ?? null,
      metrics: um,
      retention: retentionFor([m])
    };
  });
  const restamp = (record) => {
    if (!data.source) return record;
    for (const key of Object.keys(record))
      if (record[key].source === "PostHog") record[key] = { ...record[key], source: data.source };
    return record;
  };
  const restampRetention = (r) => {
    for (const type of Object.keys(r)) restamp(r[type]);
    return r;
  };
  for (const u of users) {
    restamp(u.metrics);
    restampRetention(u.retention);
  }
  return {
    version: 2,
    mode: data.mode,
    asOf: data.asOf,
    coverageFrom: data.coverageFrom,
    cohort,
    period,
    state: data.state,
    detail: data.detail,
    metrics: restamp(metrics),
    retention: restampRetention(retentionFor()),
    users,
    excluded: data.members.filter((m) => m.internal || m.test).length
  };
}

// lib/analytics-v2/fixture.ts
function fixture(now3 = Date.now()) {
  const iso = (n) => new Date(n).toISOString();
  const data = {
    mode: "test",
    state: "available",
    detail: "Synthetic preview data \xB7 not Phase 0 results",
    asOf: iso(now3),
    coverageFrom: iso(now3 - 90 * DAY2),
    members: [],
    facts: [],
    capabilities: [
      "activity",
      "app-return",
      "onboarding",
      "people",
      "memory",
      "wingman",
      "responses",
      "sessions",
      "foreground",
      "situations",
      "activation",
      "memory-reuse",
      "people-use",
      "retries",
      "fallbacks",
      "latency",
      "tokens",
      "cost",
      "attribution"
    ]
  };
  const ages = [45, 34, 20, 10, 5, 2.5, 0.5];
  for (let i = 0; i < ages.length; i++) {
    const id2 = `participant-${String(i + 1).padStart(3, "0")}`, first = now3 - ages[i] * DAY2;
    data.members.push({
      id: id2,
      cohort: i < 4 ? "phase-0" : i < 6 ? "phase-1a" : "phase-1b",
      from: iso(first),
      firstOpen: iso(first),
      internal: false,
      test: false,
      acquisition: i % 2 ? "referral" : "organic"
    });
    let sequence = 0;
    const add = (offset, kind, extra = {}) => {
      if (first + offset * DAY2 <= now3)
        data.facts.push({
          id: `${id2}-${sequence++}`,
          user: id2,
          at: iso(first + offset * DAY2),
          kind,
          ...extra
        });
    };
    add(0, "first_open");
    add(0.01, "onboarding");
    add(0.03, "person", { people: [5, 3, 2, 1, 5, 2, 1][i] });
    add(0.04, "memory", { memories: [20, 5, 3, 1, 5, 1, 0][i] });
    if (i % 2 === 0) add(0.05, "activated");
    for (const day of [0, 1, 3, 7, 15, 30]) {
      if (day && i % 3 === 1) continue;
      add(day + 0.1, "app");
      add(day + 0.1, "wingman", { session: `s-${i}-${day}` });
      add(day + 0.2, "foreground", { seconds: 180 + i * 17 });
      for (let msg = 0; msg < (i % 2 ? 2 : 6); msg++) {
        const request = `r-${i}-${day}-${msg}`;
        add(day + 0.11 + msg * 1e-3, "message", {
          request,
          session: `s-${i}-${day}`,
          person: `person-${msg % 2}`,
          assisted: i === 2,
          attribution: i === 2 ? "founder" : "organic"
        });
        add(
          day + 0.112 + msg * 1e-3,
          msg === 1 && i === 3 ? "failed" : "complete",
          {
            request,
            latency: 600 + msg * 100,
            input: 100,
            output: 50,
            cost: 2e-3
          }
        );
        add(day + 0.112 + msg * 1e-3, "usage", {
          request,
          input: 100,
          output: 50,
          cost: 2e-3
        });
      }
      add(day + 0.12, "situation", {
        situation: `situation-${i}-${day}`,
        assisted: false,
        attribution: i === 2 ? "founder" : "organic"
      });
      if (day > 0) add(day + 0.13, "memory_reused");
    }
    add(ages[i] - 0.1, "app");
    add(ages[i] - 0.09, "wingman", { session: `recent-${i}` });
    add(ages[i] - 0.08, "message", {
      request: `recent-r-${i}`,
      session: `recent-${i}`,
      person: "person-0",
      attribution: "organic",
      assisted: false
    });
    add(ages[i] - 0.079, "complete", {
      request: `recent-r-${i}`,
      latency: 1200,
      input: 200,
      output: 80,
      cost: 4e-3
    });
    add(ages[i] - 0.079, "usage", {
      request: `recent-r-${i}`,
      input: 200,
      output: 80,
      cost: 4e-3
    });
  }
  data.members.push(
    { ...data.members[0], id: "excluded-internal", internal: true },
    { ...data.members[0], id: "excluded-test", test: true }
  );
  data.facts.push({
    id: "excluded-message",
    user: "excluded-internal",
    at: iso(now3 - 1e3),
    kind: "message",
    request: "excluded"
  });
  return data;
}

// app/api/analytics/v2/route.ts
async function GET3(request) {
  const url = new URL(request.url);
  const cohort = url.searchParams.get("cohort") || "all", period = url.searchParams.get("period") || "all";
  const users = url.searchParams.get("view") === "users";
  if (!COHORTS.includes(cohort) || !["today", "7d", "30d", "all"].includes(period))
    return Response.json({ error: "Invalid filter" }, { status: 400 });
  const synthetic = url.searchParams.get("dataset") === "test";
  if (synthetic && !(process.env.VERCEL_ENV === "preview" || process.env.CONTROL_V2_LOCAL_TEST === "true"))
    return Response.json({ error: "Test data disabled" }, { status: 403 });
  if (users && !synthetic && !(await trackerAccess(request)).canEdit)
    return Response.json({ error: "Admin sign-in required" }, { status: 403 });
  const result2 = calculate(
    synthetic ? fixture() : await liveDatasetFromBackend(),
    cohort,
    period
  );
  const names2 = users && !synthetic ? backendDisplayNames() : void 0;
  return Response.json(
    {
      ...result2,
      users: users ? result2.users.map((u) => {
        const label = names2?.get(u.id);
        return label ? { ...u, label } : u;
      }) : []
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

// server/vercel-handler.ts
async function handle(request) {
  const url = new URL(request.url);
  const path = url.searchParams.get("path") || url.pathname;
  const method = request.method;
  const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (path === "/api/health") return json({ host: "vercel", database: process.env.TURSO_DATABASE_URL ? "configured" : "missing", sitesDependency: false });
  if (path === "/api/analytics/v2/access" && method === "GET") return json({ ...await trackerAccess(request), phases: [], releaseGates: [] });
  const handlers = {
    "/api/analytics/v2": { GET: GET3 },
    "/api/tracker": { GET, PATCH },
    "/api/workspace": { GET: GET2, POST },
    "/api/auth/login": { POST: POST2 },
    "/api/auth/logout": { POST: POST3 }
  };
  const route = handlers[path];
  if (!route) return json({ error: "Not found" }, 404);
  const fn = route[method];
  if (!fn) return json({ error: "Method not allowed" }, 405);
  if (method !== "GET" && request.headers.get("origin") && request.headers.get("origin") !== url.origin) return json({ error: "Origin not allowed" }, 403);
  if (method === "PATCH" || path === "/api/workspace" && method === "POST") {
    const access = await trackerAccess(request);
    if (path === "/api/tracker" ? !access.canEdit : !access.authenticated) return json({ error: "This deployment is view-only for this visitor." }, 403);
  }
  try {
    const response = method === "PATCH" || path === "/api/workspace" && method === "POST" ? await withWriteTransaction(() => fn(request)) : await fn(request);
    return response.status >= 500 ? json({ error: "The application database is temporarily unavailable." }, 503) : response;
  } catch {
    return json({ error: "The application database is temporarily unavailable." }, 503);
  }
}
async function handler(req, res) {
  const origin = `https://${req.headers.host}`;
  const url = new URL(req.url, origin);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
  const body = ["GET", "HEAD"].includes(req.method) ? void 0 : typeof req.body === "string" ? req.body : Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body ?? {});
  const response = await handle(new Request(url, { method: req.method, headers, body }));
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.setHeader("Cache-Control", "private, no-store");
  res.end(Buffer.from(await response.arrayBuffer()));
}
export {
  handler as default,
  handle
};
