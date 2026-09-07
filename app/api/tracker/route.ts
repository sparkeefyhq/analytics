import { env } from "cloudflare:workers";
import { trackerAccess } from "@/lib/auth";
import type {
  CohortParticipant,
  ReleaseGate,
  TrackerCheck,
  TrackerData,
  TrackerMetric,
  TrackerPhase,
} from "@/lib/tracker-types";
import { metricPassed } from "@/lib/tracker-types";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type SeedMetric = {
  name: string;
  target: number;
  category: string;
  valueType: "number" | "fraction" | "percent";
  targetDenominator?: number;
  minimumDenominator?: number;
  definition: string;
};

const phase0Metrics: SeedMetric[] = [
  {
    name: "Onboarding completion",
    target: 80,
    category: "Activation",
    valueType: "percent",
    definition:
      "Eligible participants who complete onboarding and reach Wingman.",
  },
  {
    name: "Meaningful activation",
    target: 67,
    category: "Activation",
    valueType: "percent",
    definition:
      "Participants who submit a genuine personal situation and receive a usable Wingman response.",
  },
  {
    name: "Independent activation",
    target: 50,
    category: "Activation",
    valueType: "percent",
    definition: "Participants who activate without live founder navigation.",
  },
  {
    name: "First-answer usefulness",
    target: 75,
    category: "Value",
    valueType: "percent",
    definition: "First responses rated useful or very useful.",
  },
  {
    name: "Wingman response success",
    target: 95,
    category: "Reliability",
    valueType: "percent",
    definition:
      "Genuine requests returning a complete, renderable response without an error.",
  },
  {
    name: "Reminder delivery reliability",
    target: 95,
    category: "Reliability",
    valueType: "percent",
    definition:
      "Controlled reminders delivered within the accepted delivery window.",
  },
  {
    name: "Reminder destination accuracy",
    target: 100,
    category: "Reliability",
    valueType: "percent",
    definition: "Reminder opens reaching the correct screen or context.",
  },
  {
    name: "Analytics coverage",
    target: 100,
    category: "Measurement",
    valueType: "percent",
    definition:
      "Required events verified with the correct participant, timestamp, source and properties.",
  },
];
const phase0Checks = [
  "Release build frozen",
  "Android onboarding and Wingman journey tested",
  "Minimum users reached",
  "50 Wingman requests logged",
  "30 usefulness ratings logged",
  "20 reminder tests completed",
  "Analytics verified",
  "Internal activity excluded",
  "Founder assistance recorded",
  "No context leakage",
  "No privacy or safety incident",
  "No sensitive notification exposure",
  "No blocking bugs",
];
const phase0Gates = [
  "Cross-person context leakage",
  "Cross-user data leakage",
  "Sensitive notification exposure",
  "Critical privacy incidents",
  "Critical safety incidents",
  "Open P0 bugs",
  "Open release-blocking P1 bugs",
  "Reproducible core-journey crashes",
  "Missing critical analytics events",
];

function db() {
  if (!env.DB) throw new Error("Database binding is unavailable.");
  return env.DB;
}
const now = () => new Date().toISOString();
const asNumber = (value: unknown, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;
const asBool = (value: unknown) =>
  value === true || value === 1 || value === "1";
const allowed = <T extends readonly string[]>(
  value: unknown,
  values: T,
  fallback: T[number],
) =>
  typeof value === "string" && (values as readonly string[]).includes(value)
    ? (value as T[number])
    : fallback;
const safeUrl = (value: unknown) => {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
};

async function addMetricColumn(
  database: D1Database,
  name: string,
  definition: string,
) {
  const result = await database
    .prepare("PRAGMA table_info(metrics)")
    .all<{ name: string }>();
  if (!result.results.some((column) => column.name === name))
    await database
      .prepare(`ALTER TABLE metrics ADD COLUMN ${definition}`)
      .run();
}

async function ensureDatabase() {
  const database = db();
  await database.batch([
    database.prepare(
      `CREATE TABLE IF NOT EXISTS phases (id TEXT PRIMARY KEY, position INTEGER NOT NULL, name TEXT NOT NULL, objective TEXT NOT NULL, user_min INTEGER NOT NULL, user_max INTEGER NOT NULL, duration_min INTEGER NOT NULL, duration_max INTEGER NOT NULL, duration_unit TEXT NOT NULL DEFAULT 'days', actual_users INTEGER NOT NULL DEFAULT 0, elapsed_days INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'locked', features TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)`,
    ),
    database.prepare(
      `CREATE TABLE IF NOT EXISTS metrics (id TEXT PRIMARY KEY, phase_id TEXT NOT NULL, position INTEGER NOT NULL, category TEXT NOT NULL, name TEXT NOT NULL, target REAL NOT NULL, actual REAL, unit TEXT NOT NULL DEFAULT '%', comparator TEXT NOT NULL DEFAULT 'gte')`,
    ),
    database.prepare(
      `CREATE TABLE IF NOT EXISTS checks (id TEXT PRIMARY KEY, phase_id TEXT NOT NULL, position INTEGER NOT NULL, label TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0)`,
    ),
    database.prepare(
      `CREATE TABLE IF NOT EXISTS release_gates (id TEXT PRIMARY KEY, phase_id TEXT NOT NULL, position INTEGER NOT NULL, name TEXT NOT NULL, actual INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)`,
    ),
    database.prepare(
      `CREATE TABLE IF NOT EXISTS cohort_evidence (id TEXT PRIMARY KEY, phase_id TEXT NOT NULL, participant_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'invited', age_band TEXT NOT NULL DEFAULT 'other', relationship_state TEXT NOT NULL DEFAULT 'other', recruitment_source TEXT NOT NULL DEFAULT '', close_friend_or_teammate INTEGER NOT NULL DEFAULT 0, situation_category TEXT NOT NULL DEFAULT 'other', onboarding_completed INTEGER NOT NULL DEFAULT 0, meaningful_activation INTEGER NOT NULL DEFAULT 0, independently_activated INTEGER NOT NULL DEFAULT 0, first_answer_useful TEXT NOT NULL DEFAULT 'not-rated', genuine_request_count INTEGER NOT NULL DEFAULT 0, usefulness_response_count INTEGER NOT NULL DEFAULT 0, reminder_test_count INTEGER NOT NULL DEFAULT 0, reminder_tested INTEGER NOT NULL DEFAULT 0, reminder_delivery_result TEXT NOT NULL DEFAULT 'not-tested', reminder_destination_result TEXT NOT NULL DEFAULT 'not-tested', return_source TEXT NOT NULL DEFAULT 'unknown', founder_explained_product INTEGER NOT NULL DEFAULT 0, founder_helped_onboarding INTEGER NOT NULL DEFAULT 0, founder_suggested_situation INTEGER NOT NULL DEFAULT 0, founder_helped_request INTEGER NOT NULL DEFAULT 0, founder_solved_problem INTEGER NOT NULL DEFAULT 0, founder_prompted_return INTEGER NOT NULL DEFAULT 0, trust_concern INTEGER NOT NULL DEFAULT 0, product_issue INTEGER NOT NULL DEFAULT 0, evidence_note TEXT NOT NULL DEFAULT '', notion_reference_url TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    ),
    database.prepare(
      "CREATE INDEX IF NOT EXISTS idx_metrics_phase_position ON metrics(phase_id, position)",
    ),
    database.prepare(
      "CREATE INDEX IF NOT EXISTS idx_checks_phase_position ON checks(phase_id, position)",
    ),
    database.prepare(
      "CREATE INDEX IF NOT EXISTS idx_release_gates_phase_position ON release_gates(phase_id, position)",
    ),
    database.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_cohort_evidence_phase_participant ON cohort_evidence(phase_id, participant_id)",
    ),
  ]);
  await addMetricColumn(
    database,
    "value_type",
    "value_type TEXT NOT NULL DEFAULT 'number'",
  );
  await addMetricColumn(
    database,
    "target_denominator",
    "target_denominator INTEGER",
  );
  await addMetricColumn(
    database,
    "actual_denominator",
    "actual_denominator INTEGER",
  );
  await addMetricColumn(
    database,
    "minimum_denominator",
    "minimum_denominator INTEGER",
  );
  await addMetricColumn(
    database,
    "definition",
    "definition TEXT NOT NULL DEFAULT ''",
  );
  const phase = await database
    .prepare("SELECT id FROM phases WHERE id = 'phase-0'")
    .first();
  if (!phase)
    throw new Error(
      "Existing launch phases are required before applying Phase 0.",
    );
  const timestamp = now();
  await database
    .prepare(
      `UPDATE phases SET name=?, objective=?, user_min=10, user_max=15, duration_min=3, duration_max=5, duration_unit='days', status=CASE WHEN status='complete' THEN status ELSE 'active' END, features=?, updated_at=? WHERE id='phase-0'`,
    )
    .bind(
      "Phase 0: Power User Release Candidate",
      "Validate Android V3 with real users.",
      JSON.stringify([
        "AI Wingman V3",
        "Person context and memory",
        "User reminders",
        "Usefulness feedback",
        "Required analytics",
      ]),
      timestamp,
    )
    .run();
  const marker = await database
    .prepare(
      "SELECT id FROM metrics WHERE phase_id='phase-0' AND name='Independent activation'",
    )
    .first();
  if (!marker) {
    const statements: D1PreparedStatement[] = [
      database.prepare("DELETE FROM metrics WHERE phase_id='phase-0'"),
      database.prepare("DELETE FROM checks WHERE phase_id='phase-0'"),
    ];
    phase0Metrics.forEach((metric, position) =>
      statements.push(
        database
          .prepare(
            `INSERT INTO metrics (id,phase_id,position,category,name,target,actual,unit,comparator,value_type,target_denominator,actual_denominator,minimum_denominator,definition) VALUES (?, 'phase-0', ?, ?, ?, ?, NULL, ?, 'gte', ?, ?, NULL, ?, ?)`,
          )
          .bind(
            `phase-0-metric-${position}`,
            position,
            metric.category,
            metric.name,
            metric.target,
            metric.valueType === "percent"
              ? "%"
              : metric.valueType === "fraction"
                ? "fraction"
                : "count",
            metric.valueType,
            metric.targetDenominator ?? null,
            metric.minimumDenominator ?? null,
            metric.definition,
          ),
      ),
    );
    phase0Checks.forEach((label, position) =>
      statements.push(
        database
          .prepare(
            "INSERT INTO checks (id,phase_id,position,label,completed) VALUES (?, 'phase-0', ?, ?, 0)",
          )
          .bind(`phase-0-check-${position}`, position, label),
      ),
    );
    await database.batch(statements);
  }
  await database.batch(
    phase0Metrics.map((metric, position) =>
      database
        .prepare(
          `UPDATE metrics SET position=?, category=?, target=?, unit='%', comparator='gte', value_type='percent', target_denominator=NULL, minimum_denominator=NULL, definition=? WHERE phase_id='phase-0' AND name=?`,
        )
        .bind(
          position,
          metric.category,
          metric.target,
          metric.definition,
          metric.name,
        ),
    ),
  );
  await database.batch(
    phase0Checks.map((label, position) =>
      database
        .prepare(
          "UPDATE checks SET position=?, label=? WHERE phase_id='phase-0' AND position=?",
        )
        .bind(position, label, position),
    ),
  );
  const gateCount = await database
    .prepare(
      "SELECT COUNT(*) AS count FROM release_gates WHERE phase_id='phase-0'",
    )
    .first<{ count: number }>();
  if (!gateCount?.count)
    await database.batch(
      phase0Gates.map((name, position) =>
        database
          .prepare(
            "INSERT INTO release_gates (id,phase_id,position,name,actual,updated_at) VALUES (?, ?, ?, ?, 0, ?)",
          )
          .bind(
            `phase-0-gate-${position}`,
            "phase-0",
            position,
            name,
            timestamp,
          ),
      ),
    );
}

function metricFromRow(row: Record<string, unknown>): TrackerMetric {
  return {
    id: String(row.id),
    phaseId: String(row.phase_id),
    position: asNumber(row.position),
    category: String(row.category),
    name: String(row.name),
    target: asNumber(row.target),
    actual: row.actual === null ? null : asNumber(row.actual),
    unit: String(row.unit),
    comparator: String(row.comparator) as TrackerMetric["comparator"],
    valueType: allowed(
      row.value_type,
      ["number", "fraction", "percent"] as const,
      "number",
    ),
    targetDenominator:
      row.target_denominator === null ? null : asNumber(row.target_denominator),
    actualDenominator:
      row.actual_denominator === null ? null : asNumber(row.actual_denominator),
    minimumDenominator:
      row.minimum_denominator === null
        ? null
        : asNumber(row.minimum_denominator),
    definition: String(row.definition || ""),
  };
}
async function loadTracker(): Promise<TrackerData> {
  await ensureDatabase();
  const database = db();
  const [phaseRows, metricRows, checkRows] = await Promise.all([
    database.prepare("SELECT * FROM phases ORDER BY position").all(),
    database.prepare("SELECT * FROM metrics ORDER BY phase_id,position").all(),
    database.prepare("SELECT * FROM checks ORDER BY phase_id,position").all(),
  ]);
  const metrics = metricRows.results.map((row) =>
    metricFromRow(row as Record<string, unknown>),
  );
  const checks = checkRows.results.map((row) => ({
    id: String(row.id),
    phaseId: String(row.phase_id),
    position: asNumber(row.position),
    label: String(row.label),
    completed: asBool(row.completed),
  }));
  return {
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
      status: String(row.status) as TrackerPhase["status"],
      features: JSON.parse(String(row.features)) as string[],
      notes: String(row.notes),
      updatedAt: String(row.updated_at),
      metrics: metrics.filter((metric) => metric.phaseId === row.id),
      checks: checks.filter((check) => check.phaseId === row.id),
    })),
  };
}

function participantFromRow(row: Record<string, unknown>): CohortParticipant {
  const b = (name: string) => asBool(row[name]);
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
      ["yes", "no", "not-rated"] as const,
      "not-rated",
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
    updatedAt: String(row.updated_at),
  };
}
async function loadPrivatePhase0() {
  const database = db();
  const [people, gateRows] = await Promise.all([
    database
      .prepare(
        "SELECT * FROM cohort_evidence WHERE phase_id='phase-0' ORDER BY participant_id",
      )
      .all(),
    database
      .prepare(
        "SELECT * FROM release_gates WHERE phase_id='phase-0' ORDER BY position",
      )
      .all(),
  ]);
  return {
    participants: people.results.map((row) =>
      participantFromRow(row as Record<string, unknown>),
    ),
    gates: gateRows.results.map((row) => ({
      id: String(row.id),
      phaseId: String(row.phase_id),
      position: asNumber(row.position),
      name: String(row.name),
      actual: asNumber(row.actual),
    })) as ReleaseGate[],
  };
}
function phase0Unmet(phase: TrackerPhase) {
  const unmet = phase.metrics
    .filter((metric) => !metricPassed(metric))
    .map((metric) => `${metric.name} has not passed`);
  unmet.push(
    ...phase.checks
      .filter((check) => !check.completed)
      .map((check) => check.label),
  );
  return unmet;
}
async function trackerResponse(request: Request) {
  const [tracker, access] = await Promise.all([
    loadTracker(),
    trackerAccess(request),
  ]);
  const phase = tracker.phases.find((item) => item.id === "phase-0");
  return {
    ...tracker,
    ...access,
    phase0Unmet: access.canEdit && phase ? phase0Unmet(phase) : [],
  };
}

function validateParticipant(
  patch: Record<string, unknown>,
  existing?: CohortParticipant,
) {
  const participantId = String(
    patch.participantId ?? existing?.participantId ?? "",
  )
    .trim()
    .toUpperCase();
  if (!/^P0-\d{3}$/.test(participantId))
    throw new Error("Participant ID must use the P0-001 format.");
  const note = String(
    patch.evidenceNote ?? existing?.evidenceNote ?? "",
  ).trim();
  if (note.length > 280)
    throw new Error("Sanitized evidence notes are limited to 280 characters.");
  const get = (key: keyof CohortParticipant) => patch[key] ?? existing?.[key];
  return {
    participantId,
    status: allowed(
      get("status"),
      ["invited", "onboarded", "activated", "completed", "dropped"] as const,
      "invited",
    ),
    ageBand: allowed(
      get("ageBand"),
      ["18–20", "21–24", "25–28", "other"] as const,
      "other",
    ),
    relationshipState: allowed(
      get("relationshipState"),
      [
        "relationship",
        "talking-stage",
        "dating",
        "conflict",
        "breakup",
        "other",
      ] as const,
      "other",
    ),
    recruitmentSource: String(get("recruitmentSource") || "").slice(0, 80),
    closeFriendOrTeammate: asBool(get("closeFriendOrTeammate")),
    situationCategory: allowed(
      get("situationCategory"),
      ["reply-help", "repair", "planning", "other"] as const,
      "other",
    ),
    onboardingCompleted: asBool(get("onboardingCompleted")),
    meaningfulActivation: asBool(get("meaningfulActivation")),
    independentlyActivated: asBool(get("independentlyActivated")),
    firstAnswerUseful: allowed(
      get("firstAnswerUseful"),
      ["yes", "no", "not-rated"] as const,
      "not-rated",
    ),
    genuineRequestCount: Math.max(
      0,
      Math.min(999, asNumber(get("genuineRequestCount"))),
    ),
    usefulnessResponseCount: Math.max(
      0,
      Math.min(999, asNumber(get("usefulnessResponseCount"))),
    ),
    reminderTestCount: Math.max(
      0,
      Math.min(999, asNumber(get("reminderTestCount"))),
    ),
    reminderTested: asBool(get("reminderTested")),
    reminderDeliveryResult: allowed(
      get("reminderDeliveryResult"),
      ["not-tested", "delivered", "failed"] as const,
      "not-tested",
    ),
    reminderDestinationResult: allowed(
      get("reminderDestinationResult"),
      ["not-tested", "correct", "incorrect"] as const,
      "not-tested",
    ),
    returnSource: allowed(
      get("returnSource"),
      [
        "organic",
        "reminder-assisted",
        "founder-prompted",
        "referral",
        "internal-test",
        "unknown",
      ] as const,
      "unknown",
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
    notionReferenceUrl: safeUrl(get("notionReferenceUrl")),
  };
}

const bindParticipant = (
  statement: D1PreparedStatement,
  id: string,
  person: ReturnType<typeof validateParticipant>,
  timestamp: string,
) =>
  statement.bind(
    id,
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
    timestamp,
  );

export async function GET(request: Request) {
  try {
    const access = await trackerAccess(request);
    if (!access.authenticated)
      return Response.json(
        { authenticated: false },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    if (
      new URL(request.url).searchParams.get("private") === "cohort" &&
      !access.canEdit
    )
      return Response.json(
        { error: "Private cohort evidence is restricted to the editor." },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    return Response.json(await trackerResponse(request), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to load tracker.",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const access = await trackerAccess(request);
    if (!access.canEdit)
      return Response.json(
        { error: "This account has view-only access." },
        { status: 403 },
      );
    await ensureDatabase();
    const body = (await request.json()) as {
      action: string;
      id?: string;
      phaseId?: string;
      patch?: Record<string, unknown>;
    };
    const database = db();
    const timestamp = now();
    if (body.action === "metric" && body.id && body.patch) {
      const actual =
        body.patch.actual === null || body.patch.actual === ""
          ? null
          : Math.max(0, asNumber(body.patch.actual));
      const denominator =
        body.patch.actualDenominator === null ||
        body.patch.actualDenominator === ""
          ? null
          : Math.max(0, asNumber(body.patch.actualDenominator));
      await database
        .prepare(
          "UPDATE metrics SET target=?, actual=?, actual_denominator=? WHERE id=?",
        )
        .bind(
          Math.max(0, asNumber(body.patch.target)),
          actual,
          denominator,
          body.id,
        )
        .run();
    } else if (body.action === "check" && body.id && body.patch)
      await database
        .prepare("UPDATE checks SET completed=? WHERE id=?")
        .bind(asBool(body.patch.completed) ? 1 : 0, body.id)
        .run();
    else if (body.action === "start" && body.phaseId)
      await database
        .prepare("UPDATE phases SET status='active',updated_at=? WHERE id=?")
        .bind(timestamp, body.phaseId)
        .run();
    else if (body.action === "release_gate" && body.id && body.patch)
      await database
        .prepare("UPDATE release_gates SET actual=?,updated_at=? WHERE id=?")
        .bind(Math.max(0, asNumber(body.patch.actual)), timestamp, body.id)
        .run();
    else if (body.action === "cohort_create" && body.patch) {
      const person = validateParticipant(body.patch);
      const sql = `INSERT INTO cohort_evidence (id,phase_id,participant_id,status,age_band,relationship_state,recruitment_source,close_friend_or_teammate,situation_category,onboarding_completed,meaningful_activation,independently_activated,first_answer_useful,genuine_request_count,usefulness_response_count,reminder_test_count,reminder_tested,reminder_delivery_result,reminder_destination_result,return_source,founder_explained_product,founder_helped_onboarding,founder_suggested_situation,founder_helped_request,founder_solved_problem,founder_prompted_return,trust_concern,product_issue,evidence_note,notion_reference_url,created_at,updated_at) VALUES (?, 'phase-0', ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
      await bindParticipant(
        database.prepare(sql),
        crypto.randomUUID(),
        person,
        timestamp,
      ).run();
    } else if (body.action === "cohort_update" && body.id && body.patch) {
      const row = await database
        .prepare(
          "SELECT * FROM cohort_evidence WHERE id=? AND phase_id='phase-0'",
        )
        .bind(body.id)
        .first<Record<string, unknown>>();
      if (!row)
        return Response.json(
          { error: "Participant not found." },
          { status: 404 },
        );
      const person = validateParticipant(body.patch, participantFromRow(row));
      const sql = `UPDATE cohort_evidence SET participant_id=?,status=?,age_band=?,relationship_state=?,recruitment_source=?,close_friend_or_teammate=?,situation_category=?,onboarding_completed=?,meaningful_activation=?,independently_activated=?,first_answer_useful=?,genuine_request_count=?,usefulness_response_count=?,reminder_test_count=?,reminder_tested=?,reminder_delivery_result=?,reminder_destination_result=?,return_source=?,founder_explained_product=?,founder_helped_onboarding=?,founder_suggested_situation=?,founder_helped_request=?,founder_solved_problem=?,founder_prompted_return=?,trust_concern=?,product_issue=?,evidence_note=?,notion_reference_url=?,updated_at=? WHERE id=?`;
      await database
        .prepare(sql)
        .bind(
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
          body.id,
        )
        .run();
    } else if (body.action === "cohort_delete" && body.id)
      await database
        .prepare(
          "DELETE FROM cohort_evidence WHERE id=? AND phase_id='phase-0'",
        )
        .bind(body.id)
        .run();
    else if (
      body.action === "advance" &&
      body.phaseId &&
      body.patch?.confirmed === true
    ) {
      const tracker = await loadTracker();
      const phase = tracker.phases.find((item) => item.id === body.phaseId);
      if (!phase)
        return Response.json({ error: "Phase not found." }, { status: 404 });
      const unmet =
        phase.id === "phase-0"
          ? phase0Unmet(phase)
          : [
              ...phase.metrics
                .filter((metric) => !metricPassed(metric))
                .map((metric) => metric.name),
              ...phase.checks
                .filter((check: TrackerCheck) => !check.completed)
                .map((check) => check.label),
            ];
      if (unmet.length)
        return Response.json(
          { error: "Phase cannot advance yet.", unmet },
          { status: 409 },
        );
      const next = tracker.phases.find(
        (item) => item.position === phase.position + 1,
      );
      const statements = [
        database
          .prepare(
            "UPDATE phases SET status='complete',updated_at=? WHERE id=?",
          )
          .bind(timestamp, phase.id),
      ];
      if (next)
        statements.push(
          database
            .prepare(
              "UPDATE phases SET status='active',updated_at=? WHERE id=?",
            )
            .bind(timestamp, next.id),
        );
      await database.batch(statements);
    } else
      return Response.json({ error: "Unsupported update." }, { status: 400 });
    return Response.json(await trackerResponse(request), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to save changes.",
      },
      {
        status:
          error instanceof Error &&
          /Participant ID|Sanitized evidence/.test(error.message)
            ? 400
            : 500,
      },
    );
  }
}
