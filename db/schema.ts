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
