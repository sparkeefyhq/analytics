import {
  index,
  integer,
  real,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const phases = sqliteTable("phases", {
  id: text("id").primaryKey(),
  position: integer("position").notNull(),
  name: text("name").notNull(),
  objective: text("objective").notNull(),
  userMin: integer("user_min").notNull(),
  userMax: integer("user_max").notNull(),
  durationMin: integer("duration_min").notNull(),
  durationMax: integer("duration_max").notNull(),
  durationUnit: text("duration_unit").notNull().default("days"),
  actualUsers: integer("actual_users").notNull().default(0),
  elapsedDays: integer("elapsed_days").notNull().default(0),
  status: text("status").notNull().default("locked"),
  features: text("features").notNull(),
  notes: text("notes").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
  startedAt: text("started_at"),
});

export const phase1State = sqliteTable("phase1_state", {
  phaseId: text("phase_id").primaryKey(),
  decision1A: text("decision_1a"),
  finalDecision: text("final_decision"),
  updatedAt: text("updated_at").notNull(),
});

export const phase1WedgeSignals = sqliteTable("phase1_wedge_signals", {
  wedge: text("wedge").notNull(),
  field: text("field").notNull(),
  numericValue: real("numeric_value"),
  textValue: text("text_value").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
}, (table) => [primaryKey({ columns: [table.wedge, table.field] })]);

export const metrics = sqliteTable(
  "metrics",
  {
    id: text("id").primaryKey(),
    phaseId: text("phase_id").notNull(),
    position: integer("position").notNull(),
    category: text("category").notNull(),
    name: text("name").notNull(),
    target: real("target").notNull(),
    actual: real("actual"),
    unit: text("unit").notNull().default("%"),
    comparator: text("comparator").notNull().default("gte"),
    valueType: text("value_type").notNull().default("number"),
    targetDenominator: integer("target_denominator"),
    actualDenominator: integer("actual_denominator"),
    minimumDenominator: integer("minimum_denominator"),
    definition: text("definition").notNull().default(""),
  },
  (table) => [
    index("idx_metrics_phase_position").on(table.phaseId, table.position),
  ],
);

export const checks = sqliteTable(
  "checks",
  {
    id: text("id").primaryKey(),
    phaseId: text("phase_id").notNull(),
    position: integer("position").notNull(),
    label: text("label").notNull(),
    completed: integer("completed", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [
    index("idx_checks_phase_position").on(table.phaseId, table.position),
  ],
);

export const releaseGates = sqliteTable(
  "release_gates",
  {
    id: text("id").primaryKey(),
    phaseId: text("phase_id").notNull(),
    position: integer("position").notNull(),
    name: text("name").notNull(),
    actual: integer("actual").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_release_gates_phase_position").on(table.phaseId, table.position),
  ],
);

export const cohortEvidence = sqliteTable(
  "cohort_evidence",
  {
    id: text("id").primaryKey(),
    phaseId: text("phase_id").notNull(),
    participantId: text("participant_id").notNull(),
    status: text("status").notNull().default("invited"),
    ageBand: text("age_band").notNull().default("other"),
    relationshipState: text("relationship_state").notNull().default("other"),
    recruitmentSource: text("recruitment_source").notNull().default(""),
    closeFriendOrTeammate: integer("close_friend_or_teammate", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    situationCategory: text("situation_category").notNull().default("other"),
    onboardingCompleted: integer("onboarding_completed", { mode: "boolean" })
      .notNull()
      .default(false),
    meaningfulActivation: integer("meaningful_activation", { mode: "boolean" })
      .notNull()
      .default(false),
    independentlyActivated: integer("independently_activated", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    firstAnswerUseful: text("first_answer_useful")
      .notNull()
      .default("not-rated"),
    genuineRequestCount: integer("genuine_request_count").notNull().default(0),
    usefulnessResponseCount: integer("usefulness_response_count")
      .notNull()
      .default(0),
    reminderTestCount: integer("reminder_test_count").notNull().default(0),
    reminderTested: integer("reminder_tested", { mode: "boolean" })
      .notNull()
      .default(false),
    reminderDeliveryResult: text("reminder_delivery_result")
      .notNull()
      .default("not-tested"),
    reminderDestinationResult: text("reminder_destination_result")
      .notNull()
      .default("not-tested"),
    returnSource: text("return_source").notNull().default("unknown"),
    founderExplainedProduct: integer("founder_explained_product", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    founderHelpedOnboarding: integer("founder_helped_onboarding", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    founderSuggestedSituation: integer("founder_suggested_situation", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    founderHelpedRequest: integer("founder_helped_request", { mode: "boolean" })
      .notNull()
      .default(false),
    founderSolvedProblem: integer("founder_solved_problem", { mode: "boolean" })
      .notNull()
      .default(false),
    founderPromptedReturn: integer("founder_prompted_return", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    trustConcern: integer("trust_concern", { mode: "boolean" })
      .notNull()
      .default(false),
    productIssue: integer("product_issue", { mode: "boolean" })
      .notNull()
      .default(false),
    evidenceNote: text("evidence_note").notNull().default(""),
    notionReferenceUrl: text("notion_reference_url").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_cohort_evidence_phase_participant").on(
      table.phaseId,
      table.participantId,
    ),
  ],
);

export const routines = sqliteTable("routines", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  title: text("title").notNull(),
  time: text("time").notNull(),
  iconType: text("icon_type"),
  iconSource: text("icon_source").notNull().default("inferred"),
  link: text("link").notNull().default(""),
  position: integer("position").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const routineOccurrences = sqliteTable(
  "routine_occurrences",
  {
    id: text("id").primaryKey(),
    routineId: text("routine_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    date: text("date").notNull(),
    title: text("title").notNull(),
    time: text("time").notNull(),
    status: text("status").notNull().default("pending"),
    note: text("note").notNull().default(""),
    completedAt: text("completed_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_routine_occurrence_owner_date").on(table.ownerEmail, table.date),
    index("idx_routine_occurrence_unique").on(table.routineId, table.date),
  ],
);

export const founderTasks = sqliteTable(
  "founder_tasks",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    dueDate: text("due_date"),
    dueTime: text("due_time"),
    priority: text("priority").notNull().default("medium"),
    category: text("category").notNull().default("General"),
    status: text("status").notNull().default("open"),
    link: text("link").notNull().default(""),
    iconType: text("icon_type"),
    iconSource: text("icon_source").notNull().default("inferred"),
    position: integer("position").notNull().default(0),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
    deletedAt: text("deleted_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_founder_tasks_owner_status_due").on(
      table.ownerEmail,
      table.status,
      table.dueDate,
    ),
  ],
);

export const diaryEntries = sqliteTable(
  "diary_entries",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    entryDate: text("entry_date").notNull(),
    completed: text("completed").notNull().default(""),
    movedForward: text("moved_forward").notNull().default(""),
    learned: text("learned").notNull().default(""),
    blocker: text("blocker").notNull().default(""),
    insight: text("insight").notNull().default(""),
    tomorrow: text("tomorrow").notNull().default(""),
    mood: text("mood").notNull().default("Focused"),
    notes: text("notes").notNull().default(""),
    finishedAt: text("finished_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_diary_owner_date").on(table.ownerEmail, table.entryDate),
  ],
);

export const suggestions = sqliteTable(
  "suggestions",
  {
    id: text("id").primaryKey(),
    authorEmail: text("author_email").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    category: text("category").notNull().default("Other"),
    priority: text("priority").notNull().default("medium"),
    phaseId: text("phase_id"),
    status: text("status").notNull().default("new"),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    founderPriority: integer("founder_priority", { mode: "boolean" })
      .notNull()
      .default(false),
    founderNote: text("founder_note").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_suggestions_status_created").on(table.status, table.createdAt),
  ],
);

export const suggestionReplies = sqliteTable(
  "suggestion_replies",
  {
    id: text("id").primaryKey(),
    suggestionId: text("suggestion_id").notNull(),
    authorEmail: text("author_email").notNull(),
    body: text("body").notNull(),
    parentId: text("parent_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_suggestion_replies_suggestion").on(
      table.suggestionId,
      table.createdAt,
    ),
  ],
);

export const suggestionVotes = sqliteTable("suggestion_votes", {
  suggestionId: text("suggestion_id").notNull(),
  authorEmail: text("author_email").notNull(),
  createdAt: text("created_at").notNull(),
});

export const founderSettings = sqliteTable("founder_settings", {
  ownerEmail: text("owner_email").primaryKey(),
  launchDate: text("launch_date"),
  updatedAt: text("updated_at").notNull(),
});

export const founderMeetings = sqliteTable(
  "founder_meetings",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    title: text("title").notNull(),
    category: text("category").notNull().default("Other"),
    contact: text("contact").notNull().default(""),
    scheduledDate: text("scheduled_date").notNull(),
    scheduledTime: text("scheduled_time").notNull(),
    meetingLink: text("meeting_link").notNull().default(""),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("scheduled"),
    preparationGoal: text("preparation_goal").notNull().default(""),
    talkingPoints: text("talking_points").notNull().default(""),
    questions: text("questions").notNull().default(""),
    desiredNextStep: text("desired_next_step").notNull().default(""),
    outcome: text("outcome").notNull().default(""),
    nextStep: text("next_step").notNull().default(""),
    followUpDate: text("follow_up_date"),
    privateNotes: text("private_notes").notNull().default(""),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_founder_meetings_owner_date").on(
      table.ownerEmail,
      table.scheduledDate,
      table.scheduledTime,
    ),
  ],
);
