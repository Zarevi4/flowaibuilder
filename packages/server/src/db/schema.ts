import { pgTable, text, integer, boolean, jsonb, timestamp, uuid } from 'drizzle-orm/pg-core';

// ─── WORKFLOWS ──────────────────────────────────────────────
export const workflows = pgTable('workflows', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description').default(''),
  active: boolean('active').default(false),
  version: integer('version').default(1),
  environment: text('environment').default('dev'),

  // The graph
  nodes: jsonb('nodes').notNull().default([]),
  connections: jsonb('connections').notNull().default([]),

  // Visual state
  canvas: jsonb('canvas').default({}),

  // Settings
  settings: jsonb('settings').default({}),

  // Metadata
  tags: jsonb('tags').default([]),
  createdBy: text('created_by').notNull(),
  updatedBy: text('updated_by').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ─── EXECUTIONS ─────────────────────────────────────────────
export const executions = pgTable('executions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id').references(() => workflows.id),
  workflowVersion: integer('workflow_version'),

  status: text('status').notNull(), // running|success|error|cancelled
  mode: text('mode').notNull(),     // manual|trigger|webhook|retry|mcp

  // Full data
  triggerData: jsonb('trigger_data'),
  resultData: jsonb('result_data'),
  nodeExecutions: jsonb('node_executions').default([]),

  error: jsonb('error'),

  triggeredBy: text('triggered_by').notNull(),
  startedAt: timestamp('started_at').defaultNow(),
  finishedAt: timestamp('finished_at'),
  durationMs: integer('duration_ms'),
});

// ─── AUDIT LOG ──────────────────────────────────────────────
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  timestamp: timestamp('timestamp').defaultNow(),

  actor: text('actor').notNull(),
  action: text('action').notNull(),
  resourceType: text('resource_type'),
  resourceId: text('resource_id'),

  changes: jsonb('changes'),
  metadata: jsonb('metadata'),
});

// ─── WORKFLOW VERSIONS ──────────────────────────────────────
export const workflowVersions = pgTable('workflow_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id').references(() => workflows.id),
  version: integer('version').notNull(),

  snapshot: jsonb('snapshot').notNull(),
  gitSha: text('git_sha'),
  message: text('message'),

  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// ─── USERS ──────────────────────────────────────────────────
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  passwordHash: text('password_hash'),
  role: text('role').default('editor'),
  ssoProvider: text('sso_provider'),
  ssoId: text('sso_id'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ─── CREDENTIALS ────────────────────────────────────────────
export const credentials = pgTable('credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  dataEncrypted: text('data_encrypted').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ─── ANNOTATIONS ────────────────────────────────────────────
export const annotations = pgTable('annotations', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id').references(() => workflows.id),
  nodeId: text('node_id').notNull(),

  severity: text('severity').notNull(), // error|warning|suggestion
  title: text('title').notNull(),
  description: text('description').notNull(),

  fix: jsonb('fix'),
  relatedNodes: jsonb('related_nodes'),
  knowledgeSource: text('knowledge_source'),

  status: text('status').default('active'), // active|applied|dismissed
  dismissedReason: text('dismissed_reason'),

  createdAt: timestamp('created_at').defaultNow(),
  appliedAt: timestamp('applied_at'),
});

// ─── WORKFLOW REVIEWS ───────────────────────────────────────
export const workflowReviews = pgTable('workflow_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id').references(() => workflows.id),
  executionId: uuid('execution_id'),

  reviewType: text('review_type').notNull(),
  healthScore: integer('health_score'),
  scores: jsonb('scores'),
  summary: text('summary'),
  annotationCount: integer('annotation_count'),

  createdAt: timestamp('created_at').defaultNow(),
});

// ─── PROTECTED ZONES ────────────────────────────────────────
export const protectedZones = pgTable('protected_zones', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id').references(() => workflows.id),

  name: text('name').notNull(),
  nodeIds: jsonb('node_ids').notNull(),
  color: text('color').default('#378ADD'),

  pinnedBy: text('pinned_by').notNull(),
  pinnedAt: timestamp('pinned_at').defaultNow(),
  reason: text('reason'),

  canUnpin: jsonb('can_unpin').default([]),
});
