import { env } from "@/lib/runtime-env";
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
    target: 70,
    category: "Activation",
    valueType: "percent",
    definition:
      "Participants who submit a genuine personal situation and receive a usable Wingman response.",
  },
  {
    name: "Independent activation",
    target: 60,
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
  {
    name: "Day 1 unprompted return",
    target: 40,
    category: "Retention",
    valueType: "percent",
    definition:
      "Activated users who return the next day without a founder prompt or reminder.",
  },
  {
    name: "Second real situation",
    target: 30,
    category: "Retention",
    valueType: "percent",
    definition:
      "Activated users who bring a second genuine situation within 72 hours.",
  },
];
const phase0Checks = [
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
  "No blocking privacy, safety or journey bugs",
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

type Phase1MetricSeed = {
  id: string;
  category: string;
  name: string;
  target: number;
  comparator: "gte" | "lte" | "eq";
  valueType: "number" | "percent";
  minimumDenominator?: number;
  definition: string;
};

const phase1aMetrics: Phase1MetricSeed[] = [
  { id: "phase-1a-metric-0", category: "Cohort", name: "Eligible cohort completed", target: 50, comparator: "eq", valueType: "number", definition: "Eligible Indian men aged 18–28 who complete the Phase 1A observation protocol." },
  { id: "phase-1a-metric-1", category: "Activation", name: "Meaningful activation", target: 70, comparator: "gte", valueType: "percent", minimumDenominator: 50, definition: "Eligible participants who submit a genuine situation, receive a complete Wingman response and report it clearly or somewhat helped." },
  { id: "phase-1a-metric-2", category: "Independence", name: "Independent share of meaningful activations", target: 80, comparator: "gte", valueType: "percent", minimumDenominator: 35, definition: "Independent meaningful activations divided by all meaningful activations. Founder-guided or rescued sessions never count as independent." },
  { id: "phase-1a-metric-3", category: "Value", name: "First-answer usefulness", target: 75, comparator: "gte", valueType: "percent", minimumDenominator: 35, definition: "First completed genuine answers rated “Yes, clearly” or “Somewhat” divided by all first genuine situations that received a complete answer." },
  { id: "phase-1a-metric-4", category: "Behavior", name: "Organic second-situation rate", target: 40, comparator: "gte", valueType: "percent", minimumDenominator: 35, definition: "Organic second-situation users divided by meaningfully activated users. This is the primary behavioral metric." },
  { id: "phase-1a-metric-5", category: "Reliability", name: "Genuine Wingman response success", target: 95, comparator: "gte", valueType: "percent", minimumDenominator: 35, definition: "Genuine requests returning a complete usable response without error or manual retry." },
  { id: "phase-1a-metric-6", category: "Trust & safety", name: "Critical trust/safety incidents", target: 0, comparator: "eq", valueType: "number", definition: "Privacy leaks, wrong-person memory, cross-account/context leaks, dangerous guidance or critical deletion/privacy failures." },
  { id: "phase-1a-metric-7", category: "Measurement", name: "Analytics / participant-state reconciliation", target: 100, comparator: "gte", valueType: "percent", minimumDenominator: 50, definition: "Every eligible participant has a valid final measurement state and correct denominator, source and version fields." },
];

const phase1bMetrics: Phase1MetricSeed[] = [
  { id: "phase-1b-metric-0", category: "Activation", name: "Meaningful activation", target: 70, comparator: "gte", valueType: "percent", minimumDenominator: 100, definition: "Cold eligible users who meaningfully activate using the same Phase 1 definition." },
  { id: "phase-1b-metric-1", category: "Independence", name: "Independent share of meaningful activations", target: 80, comparator: "gte", valueType: "percent", minimumDenominator: 70, definition: "Independent meaningful activations divided by all meaningful activations in the colder cohort." },
  { id: "phase-1b-metric-2", category: "Behavior", name: "Organic second-situation rate", target: 40, comparator: "gte", valueType: "percent", minimumDenominator: 70, definition: "Organic second-situation users divided by meaningfully activated cold users." },
  { id: "phase-1b-metric-3", category: "Reliability", name: "Genuine Wingman response success", target: 95, comparator: "gte", valueType: "percent", minimumDenominator: 70, definition: "Genuine cold-cohort requests returning a complete usable response without error or manual retry." },
  { id: "phase-1b-metric-4", category: "Trust & safety", name: "Critical trust/safety incidents", target: 0, comparator: "eq", valueType: "number", definition: "Critical privacy, memory, safety or deletion failures. Any unresolved incident blocks advancement." },
  { id: "phase-1b-metric-5", category: "Measurement", name: "Analytics reconciliation", target: 100, comparator: "gte", valueType: "percent", minimumDenominator: 100, definition: "Every eligible colder participant has a reconciled measurement state, denominator, source and version." },
];

const phase1aChecks = [
  "Phase 1 build frozen/version tagged", "Phase 1 analytics verified", "50 eligible users recruited", "~25 dating/talking-stage users recruited", "~25 committed-relationship users recruited", "Team/paid/favour testers excluded", "SRM/non-SRM tagged", "Founder connection tagged", "Acquisition/recruitment source tagged", "Every genuine first situation classified", "Every founder-assisted session marked correctly", "Every activated user received full 14-day window", "No lifecycle return prompting during organic baseline", "Every return attribution classified", "Every non-returner opportunity state classified", "First-answer usefulness denominators reconcile", "Organic second-situation denominators reconcile", "Top three failure mechanisms documented", "Retained-user forensics completed", "Wedge comparison completed", "Leading wedge not explained primarily by SRM/friends", "Zero unresolved critical trust/safety issues", "Phase 1A decision documented",
];

const phase1bChecks = [
  "~100 eligible colder users recruited", "Same eligibility and 14-day observation rules applied", "Minimal founder involvement maintained", "Winning wedge/job defined from Phase 1A", "Every return attribution classified", "Cold-cohort denominators reconcile", "Cold organic repeater yield reviewed", "Zero unresolved critical trust/safety issues", "Phase 1 final decision documented",
];

function db() {
  if (!env.DB) throw new Error("Database binding is unavailable.");
  return env.DB;
}
const now = () => new Date().toISOString();
const safeString = (value: unknown) =>
  typeof value === "string" ? value : "";
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

async function initializeDatabase() {
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
  // New schema is applied by the additive Drizzle migration before deployment.
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
      `UPDATE phases SET name=?, objective=?, user_min=15, user_max=15, duration_min=3, duration_max=5, duration_unit='days', status=CASE WHEN status='locked' THEN 'ready' ELSE status END, features=?, updated_at=? WHERE id='phase-0'`,
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

  const phase1 = await database
    .prepare("SELECT id FROM phases WHERE id = 'phase-1'")
    .first();
  if (phase1) {
    await database
      .prepare(
        `UPDATE phases SET name=?, objective=?, user_min=50, user_max=50, duration_min=14, duration_max=14, duration_unit='days', features=?, updated_at=? WHERE id='phase-1'`,
      )
      .bind(
        "Phase 1: Organic Wingman Pull",
        "Prove that the right user independently gets real value and chooses Wingman again for another genuine relationship situation.",
        JSON.stringify([
          "AI Wingman V3",
          "Person context",
          "User-controlled memory",
          "User-created practical reminders",
          "Usefulness feedback",
          "Required analytics",
        ]),
        timestamp,
      )
      .run();
    await database
      .prepare(
        "INSERT OR IGNORE INTO phase1_state (phase_id,decision_1a,final_decision,updated_at) VALUES ('phase-1',NULL,NULL,?)",
      )
      .bind(timestamp)
      .run();
    // Keep legacy Phase 1 evidence and checklist history in place. The current
    // gates already select the phase-1a-/phase-1b- IDs explicitly.
    const allPhase1Metrics = [...phase1aMetrics, ...phase1bMetrics];
    await database.batch(
      allPhase1Metrics.map((metric, position) =>
        database
          .prepare(
            `INSERT INTO metrics (id,phase_id,position,category,name,target,actual,unit,comparator,value_type,target_denominator,actual_denominator,minimum_denominator,definition) VALUES (?, 'phase-1', ?, ?, ?, ?, NULL, ?, ?, ?, NULL, NULL, ?, ?) ON CONFLICT(id) DO UPDATE SET position=excluded.position,category=excluded.category,name=excluded.name,target=excluded.target,unit=excluded.unit,comparator=excluded.comparator,value_type=excluded.value_type,target_denominator=NULL,minimum_denominator=excluded.minimum_denominator,definition=excluded.definition`,
          )
          .bind(
            metric.id,
            position,
            metric.category,
            metric.name,
            metric.target,
            metric.valueType === "percent" ? "%" : "count",
            metric.comparator,
            metric.valueType,
            metric.minimumDenominator ?? null,
            metric.definition,
          ),
      ),
    );
    const allPhase1Checks = [
      ...phase1aChecks.map((label) => ({ id: `phase-1a-check-${phase1aChecks.indexOf(label)}`, label })),
      ...phase1bChecks.map((label) => ({ id: `phase-1b-check-${phase1bChecks.indexOf(label)}`, label })),
    ];
    await database.batch(
      allPhase1Checks.map((check, position) =>
        database
          .prepare(
            "INSERT INTO checks (id,phase_id,position,label,completed) VALUES (?, 'phase-1', ?, ?, 0) ON CONFLICT(id) DO UPDATE SET position=excluded.position,label=excluded.label",
          )
          .bind(check.id, position, check.label),
      ),
    );
  }
  const marker = await database
    .prepare(
      "SELECT id FROM metrics WHERE phase_id='phase-0' AND name='Independent activation'",
    )
    .first();
  if (!marker) {
    const legacy = await database.prepare("SELECT COUNT(*) AS count FROM metrics WHERE phase_id='phase-0'").first<{ count: number }>();
    if (legacy?.count) throw new Error("Legacy Phase 0 evidence requires an explicit non-destructive migration.");
    const statements: D1PreparedStatement[] = [];
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
            "INSERT OR IGNORE INTO checks (id,phase_id,position,label,completed) VALUES (?, 'phase-0', ?, ?, 0)",
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
          `INSERT OR IGNORE INTO metrics (id,phase_id,position,category,name,target,actual,unit,comparator,value_type,target_denominator,actual_denominator,minimum_denominator,definition) VALUES (?, 'phase-0', ?, ?, ?, ?, NULL, '%', 'gte', 'percent', NULL, NULL, NULL, ?)`,
        )
        .bind(
          `phase-0-metric-${position}`,
          position,
          metric.category,
          metric.name,
          metric.target,
          metric.definition,
        ),
    ),
  );
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
          "INSERT INTO checks (id,phase_id,position,label,completed) VALUES (?, 'phase-0', ?, ?, 0) ON CONFLICT(id) DO UPDATE SET position=excluded.position,label=excluded.label",
        )
        .bind(`phase-0-check-${position}`, position, label),
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

// D1 schema checks and seed migrations are expensive on every request. Keep
// one initialization promise per warm Worker isolate, while clearing it on a
// failure so a transient D1 error can recover on the next request.
let databaseSetup: Promise<void> | null = null;
function ensureDatabase() {
  // Imported databases already have their original records and current schema.
  // Never replay legacy seed/update logic over a migrated launch.
  if (env.SPARKEEFY_DATABASE_IMPORTED === 'true') return Promise.resolve();
  if (!databaseSetup) {
    databaseSetup = initializeDatabase().catch((error) => {
      databaseSetup = null;
      throw error;
    });
  }
  return databaseSetup;
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
  const [phaseRows, metricRows, checkRows, releaseGateRows] = await Promise.all([
    database.prepare("SELECT * FROM phases ORDER BY position").all(),
    database.prepare("SELECT * FROM metrics ORDER BY phase_id,position").all(),
    database.prepare("SELECT * FROM checks ORDER BY phase_id,position").all(),
    database
      .prepare("SELECT * FROM release_gates WHERE phase_id='phase-0' ORDER BY position")
      .all(),
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
    releaseGates: releaseGateRows.results.map((row) => ({
      id: String(row.id),
      phaseId: String(row.phase_id),
      position: asNumber(row.position),
      name: String(row.name),
      actual: asNumber(row.actual),
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
      status: String(row.status) as TrackerPhase["status"],
      features: JSON.parse(String(row.features)) as string[],
      notes: String(row.notes),
      startedAt: row.started_at === null ? null : String(row.started_at),
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

/**
 * The launch tracker is intentionally not a shadow copy of product telemetry.
 * It only exposes aggregates that can be proven from its pseudonymous cohort
 * ledger. Product events, Sentry and AI billing are represented as unavailable
 * until a canonical, privacy-reviewed connector is configured.
 */
async function loadAnalyticsSnapshot() {
  await ensureDatabase();
  const rows = await db()
    .prepare(
      "SELECT phase_id,status,onboarding_completed,meaningful_activation,independently_activated,first_answer_useful,return_source,updated_at FROM cohort_evidence ORDER BY updated_at DESC",
    )
    .all<Record<string, unknown>>();
  const people = rows.results;
  const count = (predicate: (row: Record<string, unknown>) => boolean) =>
    people.filter(predicate).length;
  const rated = count((row) => String(row.first_answer_useful) !== "not-rated");
  const activated = count((row) => asBool(row.meaningful_activation));
  const organicAttributed = count(
    (row) => String(row.return_source) === "organic",
  );
  const updatedAt = people[0]?.updated_at ? String(people[0].updated_at) : null;
  const aggregate = (numerator: number | null, denominator: number | null, definition: string) => ({
    numerator,
    denominator,
    definition,
    source: "Launch Control manual cohort ledger",
  });
  return {
    updatedAt,
    source: {
      name: "Launch Control manual cohort ledger",
      status: people.length ? "available" : "empty",
      description: "Pseudonymous, manually verified cohort evidence. It is not live product telemetry.",
    },
    cohorts: [
      { id: "all", label: "All users", available: people.length > 0 },
      { id: "phase-0", label: "Phase 0", available: true },
      { id: "phase-1a", label: "Phase 1A", available: false },
      { id: "phase-1b", label: "Phase 1B", available: false },
    ],
    users: {
      registered: people.length || null,
      active: null,
      series: null,
      reason: "Active-user events are not connected to this control plane yet.",
    },
    funnel: [
      { key: "invited", label: "Invited", value: people.length || null, definition: "Participants recorded in the manual cohort ledger." },
      { key: "accepted", label: "Accepted", value: people.length ? count((row) => String(row.status) !== "dropped") : null, definition: "Ledger participants not marked dropped. Acceptance is not separately instrumented." },
      { key: "installed", label: "Play access / installed", value: null, definition: "No canonical install event is connected." },
      { key: "onboarding", label: "Onboarding completed", value: people.length ? count((row) => asBool(row.onboarding_completed)) : null, definition: "Manual cohort-evidence field." },
      { key: "situation", label: "Genuine situation", value: null, definition: "No separate canonical situation event is connected." },
      { key: "wingman", label: "First Wingman complete", value: null, definition: "No response-complete event is connected." },
      { key: "meaningful", label: "Meaningful activation", value: people.length ? activated : null, definition: "Manual cohort-evidence field; genuine situation plus a complete useful Wingman response." },
      { key: "useful", label: "Useful answer", value: rated ? count((row) => String(row.first_answer_useful) === "yes") : null, definition: "Manual first-answer usefulness rating. ‘A bit’ is not captured by the current ledger." },
      { key: "independent", label: "Independent activation", value: people.length ? count((row) => asBool(row.independently_activated)) : null, definition: "Manual cohort-evidence field." },
      { key: "organic-second", label: "Organic second situation", value: null, definition: "Return attribution alone cannot prove a distinct second genuine situation." },
    ],
    activation: {
      onboarding: aggregate(people.length ? count((row) => asBool(row.onboarding_completed)) : null, people.length || null, "Onboarding completion among ledger participants."),
      meaningful: aggregate(people.length ? activated : null, people.length || null, "Meaningful activations among ledger participants."),
      usefulness: aggregate(rated ? count((row) => String(row.first_answer_useful) === "yes") : null, rated || null, "Yes ratings among manually rated first answers. ‘A bit’ is not recorded in the current ledger."),
      independent: aggregate(activated ? count((row) => asBool(row.independently_activated)) : null, activated || null, "Independent activations among meaningful activations."),
      organicSecond: aggregate(null, null, "A distinct, unprompted second genuine situation requires a canonical event source."),
      organicYield: aggregate(null, people.length || null, "Organic second-situation users divided by eligible invited users."),
    },
    retention: {
      app: null,
      wingman: null,
      meaningfulWingman: null,
      organicSituation: null,
      organicAttributed: aggregate(organicAttributed || null, activated || null, "Organic return attribution. This is not counted as a second situation without separate evidence."),
      reason: "D1/D7/D30 retention cohorts require timestamped product events, which are not connected.",
    },
    quality: {
      usefulness: { yes: count((row) => String(row.first_answer_useful) === "yes"), abit: null, no: count((row) => String(row.first_answer_useful) === "no"), unrated: count((row) => String(row.first_answer_useful) === "not-rated") },
      responseSuccess: null,
      failures: null,
      retries: null,
      fallbacks: null,
      incomplete: null,
    },
    reliability: null,
    aiCost: null,
  };
}
function phase0Unmet(phase: TrackerPhase, releaseGates: ReleaseGate[] = []) {
  const unmet = phase.metrics
    .filter((metric) => !metricPassed(metric))
    .map((metric) => `${metric.name} has not passed`);
  unmet.push(
    ...phase.checks
      .filter((check) => !check.completed)
      .map((check) => check.label),
  );
  unmet.push(
    ...releaseGates
      .filter((gate) => gate.actual !== 0)
      .map((gate) => `${gate.name} must be zero`),
  );
  return unmet;
}

type Phase1State = {
  decision1A: string | null;
  finalDecision: string | null;
  phase1AReady: boolean;
  phase1BUnlocked: boolean;
  phase1Unmet: string[];
};

const isReplicationDecision = (decision: string | null) =>
  decision === "advance" || decision === "narrow";
const phase1SubsetUnmet = (phase: TrackerPhase, prefix: string) => [
  ...phase.metrics
    .filter((metric) => metric.id.startsWith(prefix) && !metricPassed(metric))
    .map((metric) => `${metric.name} has not passed`),
  ...phase.checks
    .filter((check) => check.id.startsWith(prefix) && !check.completed)
    .map((check) => check.label),
];
async function loadPhase1State(phase: TrackerPhase | undefined): Promise<Phase1State> {
  if (!phase)
    return {
      decision1A: null,
      finalDecision: null,
      phase1AReady: false,
      phase1BUnlocked: false,
      phase1Unmet: ["Phase 1 is unavailable."],
    };
  const row = await db()
    .prepare("SELECT decision_1a,final_decision FROM phase1_state WHERE phase_id='phase-1'")
    .first<{ decision_1a: string | null; final_decision: string | null }>();
  const decision1A = row?.decision_1a ?? null;
  const finalDecision = row?.final_decision ?? null;
  const phase1AUnmet = phase1SubsetUnmet(phase, "phase-1a-");
  const phase1AReady =
    phase1AUnmet.length === 0 && isReplicationDecision(decision1A);
  const phase1BUnlocked = phase1AReady;
  const phase1BUnmet = phase1BUnlocked
    ? phase1SubsetUnmet(phase, "phase-1b-")
    : ["Phase 1B is locked until Phase 1A passes and a replication decision is recorded."];
  const phase1Unmet = [
    ...phase1AUnmet,
    ...(isReplicationDecision(decision1A)
      ? []
      : ["Phase 1A decision must be Advance or Narrow to unlock cold replication"]),
    ...phase1BUnmet,
    ...(isReplicationDecision(finalDecision)
      ? []
      : ["Final Phase 1 decision must be Advance or Narrow"]),
  ];
  return {
    decision1A,
    finalDecision,
    phase1AReady,
    phase1BUnlocked,
    phase1Unmet,
  };
}
async function trackerResponse(request: Request) {
  const [tracker, access, analytics] = await Promise.all([
    loadTracker(),
    trackerAccess(request),
    loadAnalyticsSnapshot(),
  ]);
  const phase = tracker.phases.find((item) => item.id === "phase-0");
  const phase1 = tracker.phases.find((item) => item.id === "phase-1");
  const phase1State = await loadPhase1State(phase1);
  const wedgeRows = await db()
    .prepare("SELECT wedge,field,numeric_value,text_value FROM phase1_wedge_signals ORDER BY wedge,field")
    .all<{ wedge: string; field: string; numeric_value: number | null; text_value: string }>();
  return {
    ...tracker,
    ...access,
    analytics,
    phase0Unmet: access.canEdit && phase ? phase0Unmet(phase, tracker.releaseGates) : [],
    phase1: {
      ...phase1State,
      wedgeSignals: wedgeRows.results.map((row) => ({
        wedge: row.wedge,
        field: row.field,
        numericValue: row.numeric_value,
        textValue: row.text_value,
      })),
    },
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
    if (!access.authenticated && env.SPARKEEFY_PUBLIC_READONLY !== 'true')
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
      for (const field of ["actual", "actualDenominator"]) {
        const value = body.patch[field];
        if (value != null && value !== "" &&
          ((typeof value !== "number" && typeof value !== "string") || !Number.isFinite(Number(value)) || Number(value) < 0 || (field === "actualDenominator" && !Number.isSafeInteger(Number(value)))))
          return Response.json({ error: "Use valid non-negative metric evidence." }, { status: 400 });
      }
      const currentMetric = await database
        .prepare("SELECT phase_id,target FROM metrics WHERE id=?")
        .bind(body.id)
        .first<{ phase_id: string; target: number }>();
      if (!currentMetric)
        return Response.json({ error: "Metric not found." }, { status: 404 });
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
          currentMetric.phase_id === "phase-1"
            ? Math.max(0, asNumber(currentMetric.target))
            : Math.max(0, asNumber(body.patch.target)),
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
    else if (body.action === "phase1_decision" && body.patch) {
      const stage = safeString(body.patch.stage);
      const decision = safeString(body.patch.decision);
      if (!['1a', 'final'].includes(stage) || !['advance', 'narrow', 'repair', 'reconsider'].includes(decision))
        return Response.json({ error: "Use a valid Phase 1 decision." }, { status: 400 });
      await database
        .prepare(
          stage === "1a"
            ? "UPDATE phase1_state SET decision_1a=?,updated_at=? WHERE phase_id='phase-1'"
            : "UPDATE phase1_state SET final_decision=?,updated_at=? WHERE phase_id='phase-1'",
        )
        .bind(decision, timestamp)
        .run();
    } else if (body.action === "phase1_wedge" && body.patch) {
      const wedge = safeString(body.patch.wedge);
      const field = safeString(body.patch.field);
      const allowedWedges = ["talking-stage", "committed"];
      const allowedFields = [
        "eligible_users", "meaningful_activation", "independent_activation",
        "first_answer_usefulness", "organic_second_situation_rate",
        "typical_days_to_second_situation", "founder_rescue_minutes",
        "memory_benefit", "privacy_comfort", "primary_recurring_job",
        "alternative_used", "trust_safety_incidents",
      ];
      if (!allowedWedges.includes(wedge) || !allowedFields.includes(field))
        return Response.json({ error: "Use a valid wedge comparison field." }, { status: 400 });
      const numericValue =
        body.patch.numericValue === null || body.patch.numericValue === ""
          ? null
          : Math.max(0, Math.min(100000, asNumber(body.patch.numericValue)));
      const textValue = safeString(body.patch.textValue).trim().slice(0, 120);
      await database
        .prepare(
          "INSERT INTO phase1_wedge_signals (wedge,field,numeric_value,text_value,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(wedge,field) DO UPDATE SET numeric_value=excluded.numeric_value,text_value=excluded.text_value,updated_at=excluded.updated_at",
        )
        .bind(wedge, field, numericValue, textValue, timestamp)
        .run();
    }
    else if (body.action === "start" && body.phaseId) {
      const phase = await database
        .prepare("SELECT status,started_at FROM phases WHERE id=?")
        .bind(body.phaseId)
        .first<{ status: string; started_at: string | null }>();
      if (!phase)
        return Response.json({ error: "Phase not found." }, { status: 404 });
      if (phase.status === "locked")
        return Response.json({ error: "This phase is locked." }, { status: 409 });
      if (phase.status !== "complete")
        await database
          .prepare("UPDATE phases SET status='active',started_at=COALESCE(started_at,?),updated_at=? WHERE id=?")
          .bind(timestamp, timestamp, body.phaseId)
          .run();
    }
    else if (body.action === "release_gate" && body.id && body.patch) {
      const value = body.patch.actual;
      if ((typeof value !== "number" && typeof value !== "string") || value === "" || !Number.isSafeInteger(Number(value)) || Number(value) < 0)
        return Response.json({ error: "Incident evidence must be a non-negative whole number." }, { status: 400 });
      await database
        .prepare("UPDATE release_gates SET actual=?,updated_at=? WHERE id=?")
        .bind(Math.max(0, asNumber(body.patch.actual)), timestamp, body.id)
        .run();
    }
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
      if (phase.status !== "active")
        return Response.json(
          { error: "Only an active phase can advance." },
          { status: 409 },
        );
      const unmet =
        phase.id === "phase-0"
          ? phase0Unmet(phase, tracker.releaseGates)
          : phase.id === "phase-1"
            ? (await loadPhase1State(phase)).phase1Unmet
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
              "UPDATE phases SET status='ready',updated_at=? WHERE id=?",
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
