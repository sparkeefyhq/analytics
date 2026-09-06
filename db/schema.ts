import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const phases = sqliteTable('phases', {
  id: text('id').primaryKey(),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  objective: text('objective').notNull(),
  userMin: integer('user_min').notNull(),
  userMax: integer('user_max').notNull(),
  durationMin: integer('duration_min').notNull(),
  durationMax: integer('duration_max').notNull(),
  durationUnit: text('duration_unit').notNull().default('days'),
  actualUsers: integer('actual_users').notNull().default(0),
  elapsedDays: integer('elapsed_days').notNull().default(0),
  status: text('status').notNull().default('locked'),
  features: text('features').notNull(),
  notes: text('notes').notNull().default(''),
  updatedAt: text('updated_at').notNull(),
});

export const metrics = sqliteTable(
  'metrics',
  {
    id: text('id').primaryKey(),
    phaseId: text('phase_id').notNull(),
    position: integer('position').notNull(),
    category: text('category').notNull(),
    name: text('name').notNull(),
    target: real('target').notNull(),
    actual: real('actual'),
    unit: text('unit').notNull().default('%'),
    comparator: text('comparator').notNull().default('gte'),
  },
  (table) => [index('idx_metrics_phase_position').on(table.phaseId, table.position)],
);

export const checks = sqliteTable(
  'checks',
  {
    id: text('id').primaryKey(),
    phaseId: text('phase_id').notNull(),
    position: integer('position').notNull(),
    label: text('label').notNull(),
    completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [index('idx_checks_phase_position').on(table.phaseId, table.position)],
);

export const routines = sqliteTable('routines', {
  id: text('id').primaryKey(), ownerEmail: text('owner_email').notNull(), title: text('title').notNull(),
  time: text('time').notNull(), position: integer('position').notNull(), active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
});

export const routineOccurrences = sqliteTable('routine_occurrences', {
  id: text('id').primaryKey(), routineId: text('routine_id').notNull(), ownerEmail: text('owner_email').notNull(), date: text('date').notNull(),
  title: text('title').notNull(), time: text('time').notNull(), status: text('status').notNull().default('pending'), note: text('note').notNull().default(''),
  completedAt: text('completed_at'), updatedAt: text('updated_at').notNull(),
}, (table) => [index('idx_routine_occurrence_owner_date').on(table.ownerEmail, table.date), index('idx_routine_occurrence_unique').on(table.routineId, table.date)]);

export const founderTasks = sqliteTable('founder_tasks', {
  id: text('id').primaryKey(), ownerEmail: text('owner_email').notNull(), title: text('title').notNull(), description: text('description').notNull().default(''),
  dueDate: text('due_date'), dueTime: text('due_time'), priority: text('priority').notNull().default('medium'), category: text('category').notNull().default('General'),
  status: text('status').notNull().default('open'), link: text('link').notNull().default(''), position: integer('position').notNull().default(0),
  createdAt: text('created_at').notNull(), completedAt: text('completed_at'), updatedAt: text('updated_at').notNull(),
}, (table) => [index('idx_founder_tasks_owner_status_due').on(table.ownerEmail, table.status, table.dueDate)]);

export const diaryEntries = sqliteTable('diary_entries', {
  id: text('id').primaryKey(), ownerEmail: text('owner_email').notNull(), entryDate: text('entry_date').notNull(), completed: text('completed').notNull().default(''),
  movedForward: text('moved_forward').notNull().default(''), learned: text('learned').notNull().default(''), blocker: text('blocker').notNull().default(''),
  insight: text('insight').notNull().default(''), tomorrow: text('tomorrow').notNull().default(''), mood: text('mood').notNull().default('Focused'),
  notes: text('notes').notNull().default(''), finishedAt: text('finished_at'), updatedAt: text('updated_at').notNull(),
}, (table) => [index('idx_diary_owner_date').on(table.ownerEmail, table.entryDate)]);

export const suggestions = sqliteTable('suggestions', {
  id: text('id').primaryKey(), authorEmail: text('author_email').notNull(), title: text('title').notNull(), body: text('body').notNull(),
  category: text('category').notNull().default('Other'), priority: text('priority').notNull().default('medium'), phaseId: text('phase_id'),
  status: text('status').notNull().default('new'), pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  founderPriority: integer('founder_priority', { mode: 'boolean' }).notNull().default(false), founderNote: text('founder_note').notNull().default(''),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [index('idx_suggestions_status_created').on(table.status, table.createdAt)]);

export const suggestionReplies = sqliteTable('suggestion_replies', {
  id: text('id').primaryKey(), suggestionId: text('suggestion_id').notNull(), authorEmail: text('author_email').notNull(), body: text('body').notNull(),
  parentId: text('parent_id'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [index('idx_suggestion_replies_suggestion').on(table.suggestionId, table.createdAt)]);

export const suggestionVotes = sqliteTable('suggestion_votes', {
  suggestionId: text('suggestion_id').notNull(), authorEmail: text('author_email').notNull(), createdAt: text('created_at').notNull(),
});
