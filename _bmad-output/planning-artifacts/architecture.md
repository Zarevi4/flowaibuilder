# flowAIbuilder v3 - Architecture Document (BMAD Format)

## System Overview

flowAIbuilder is a standalone workflow automation engine. Not a wrapper.

```
flowaibuilder/
  packages/
    server/                    # Fastify + workflow engine + MCP
      src/
        index.ts               # Server entry
        
        engine/                # CORE: Workflow execution engine
          executor.ts          # Runs workflow graph (topological sort)
          node-runner.ts       # Executes individual nodes
          context.ts           # $input, $json, $env, $secrets, $helpers
          sandbox.ts           # VM sandbox for Code nodes
          retry.ts             # Retry logic on failure
          
        nodes/                 # Built-in node implementations
          base-node.ts         # Abstract base class
          triggers/
            webhook.ts         # HTTP endpoint trigger
            schedule.ts        # Cron trigger
            manual.ts          # Manual/test trigger
          logic/
            code-js.ts         # JavaScript execution
            code-python.ts     # Python execution (child process)
            if.ts              # Boolean condition
            switch.ts          # Multi-branch
            merge.ts           # Combine data
            loop.ts            # Iterate items
            set.ts             # Set/transform fields
          integration/
            http-request.ts    # Generic HTTP client
            ai-agent.ts        # LLM with tool calling
          output/
            respond-webhook.ts # Return HTTP response
            
        api/                   # REST + WebSocket
          routes/
            workflows.ts       # CRUD /api/workflows
            executions.ts      # /api/executions
            nodes.ts           # /api/nodes (registry)
            auth.ts            # /api/auth
            audit.ts           # /api/audit-log
            secrets.ts         # /api/secrets
            git.ts             # /api/git
          middleware/
            auth.ts            # JWT validation
            audit.ts           # Auto-log every request
            rbac.ts            # Role-based access check
          ws/
            broadcaster.ts     # WebSocket server
            
        mcp/                   # MCP server (built-in)
          index.ts             # MCP server setup
          tools/               # One file per MCP tool
            workflow-tools.ts  # create, get, list, delete, duplicate
            node-tools.ts      # add, update, remove, connect
            execution-tools.ts # execute, get, list, stop, retry
            export-tools.ts    # export, import, validate
            enterprise-tools.ts # audit, git, env, secrets
            review-tools.ts    # review_workflow, apply_fix, get_annotations
            zone-tools.ts      # create_zone, delete_zone, get_zones
            agent-team-tools.ts # watch_team, get_team_state, send_message
            
        review/                # AI Review engine
          reviewer.ts          # Core: serializes workflow -> sends to Claude -> parses annotations
          context-builder.ts   # Builds full context from workflow graph for Claude
          annotation-store.ts  # CRUD for annotations in DB
          rules/
            security.ts        # Auth headers, exposed secrets, CORS issues
            reliability.ts     # Error handling, retries, dead ends, timeouts
            data-integrity.ts  # Expression validity, field mapping, type mismatches
            best-practices.ts  # Pattern matching, n8n-skills knowledge application
          scoring.ts           # Calculate health score 0-100
          execution-analyst.ts # Post-execution analysis (root cause, bottlenecks)
          watcher.ts           # Continuous mode: watch edits via WS, debounced re-review
          
        zones/                 # Protected Zones
          enforcer.ts          # Middleware: blocks writes to pinned nodes
          manager.ts           # CRUD for zones + canvas broadcast
          
        agent-teams/           # Claude Code Agent Teams visual dashboard
          watcher.ts           # fs.watch on ~/.claude/teams/ files
          state.ts             # Parse team state from inbox/task files
            
        enterprise/            # ALL FREE
          audit/
            logger.ts          # Writes audit entries to DB
            types.ts           # Audit event types
          auth/
            local.ts           # Email/password
            sso.ts             # SAML/LDAP adapter (Lucia)
            rbac.ts            # Role definitions + permission checks
          git/
            sync.ts            # Push/pull workflows to git
            diff.ts            # Visual diff between versions
          environments/
            manager.ts         # Dev/staging/prod promotion
          logging/
            streamer.ts        # Stream logs to stdout/webhook/S3
          queue/
            worker.ts          # BullMQ worker process
            manager.ts         # Queue management
          secrets/
            manager.ts         # Encrypted secrets store
            
        db/
          schema.ts            # Drizzle schema (all tables)
          migrations/          # SQL migrations
          
      package.json
      tsconfig.json
      Dockerfile
      
    ui/                        # React visual editor
      src/
        App.tsx
        pages/
          Dashboard.tsx        # Workflow list + stats
          Editor.tsx           # Canvas + sidebar + toolbar
          Executions.tsx       # Execution history list
          ExecutionDetail.tsx   # Single execution trace view
          AuditLog.tsx         # Audit log viewer
          Settings.tsx         # Instance settings
        components/
          canvas/
            Canvas.tsx         # React Flow wrapper
            nodes/
              TriggerNode.tsx  # Purple - webhook, schedule, manual
              CodeNode.tsx     # Teal - JS/Python with code preview
              HttpNode.tsx     # Coral - method badge + URL preview
              LogicNode.tsx    # Amber - IF/Switch/Merge/Loop
              AiNode.tsx       # Pink - model name + prompt preview
              OutputNode.tsx   # Gray - respond/set
              GenericNode.tsx  # Fallback for plugins
            edges/
              DataEdge.tsx     # Shows data type on hover
            ExecutionOverlay.tsx # Green/red/blue overlays during run
            review/
              AnnotationCard.tsx   # Amber/red/blue card attached to node
              AnnotationConnector.tsx # SVG line from card to node
              HealthBadge.tsx      # Score 0-100 pill in canvas header
              ReviewPanel.tsx      # Sidebar panel listing all annotations
              ApplyFixButton.tsx   # Button that calls MCP to fix
              ScoreBreakdown.tsx   # Expandable: security/reliability/data/practices
            zones/
              ZoneBoundary.tsx     # Blue dashed rect around pinned nodes
              ZoneLabel.tsx        # Zone name + pinned by + date
              LockIcon.tsx         # Lock overlay on pinned nodes
              ZoneContextMenu.tsx  # Right-click: create/expand/shrink/unpin zone
            agent-teams/
              TeamDashboard.tsx    # Agent cards + task board + messages
              AgentCard.tsx        # Single agent: name, status, tasks, messages
              TaskBoard.tsx        # Task list with drag-reassign
              MessageFeed.tsx      # Inter-agent message stream
          sidebar/
            NodeConfig.tsx     # Dynamic form for selected node
            CodeEditor.tsx     # Monaco-lite for code nodes
            ExecutionPane.tsx  # Node input/output during execution
            AnnotationDetail.tsx # Selected annotation: full description + fix preview
          toolbar/
            AddNode.tsx        # Dropdown with node categories
            Actions.tsx        # Run, activate, export, settings
            ReviewButton.tsx   # "AI Review" toggle with counter badge
            Breadcrumb.tsx     # Workflow name + environment badge + health score
          export/
            ExportDialog.tsx   # Format selection + preview
        store/
          workflow.ts          # Zustand: current workflow
          execution.ts         # Zustand: current execution trace
          ui.ts                # Zustand: sidebar open, selected node etc
          ws.ts                # WebSocket connection
        lib/
          layout.ts            # Auto-layout algorithm
          node-registry.ts     # Node types, colors, icons
          compiler/            # Client-side export (mirrors server)
            prompt.ts
            typescript.ts
            mermaid.ts
        types.ts
      index.html
      vite.config.ts
      tailwind.config.ts
      
    shared/                    # Shared between server and UI
      src/
        types/
          workflow.ts          # Workflow, Node, Connection types
          execution.ts         # Execution, NodeExecution types
          audit.ts             # AuditEntry type
          mcp.ts               # MCP tool schemas
        constants/
          node-types.ts        # Node type enum + metadata
          
  docker-compose.yml           # postgres + redis + flowaibuilder
  README.md
  LICENSE                      # MIT
```

## Database Schema (Drizzle)

```typescript
// db/schema.ts

import { pgTable, text, integer, boolean, jsonb, timestamp, uuid } from 'drizzle-orm/pg-core';

// WORKFLOWS
export const workflows = pgTable('workflows', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description').default(''),
  active: boolean('active').default(false),
  version: integer('version').default(1),
  environment: text('environment').default('dev'),  // FREE enterprise feature
  
  // The graph
  nodes: jsonb('nodes').notNull().default([]),
  connections: jsonb('connections').notNull().default([]),
  
  // Visual state
  canvas: jsonb('canvas').default({}),
  
  // Settings
  settings: jsonb('settings').default({}),
  
  // Metadata
  tags: jsonb('tags').default([]),
  created_by: text('created_by').notNull(),
  updated_by: text('updated_by').notNull(),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
});

// EXECUTIONS (full traces - n8n charges for this)
export const executions = pgTable('executions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflow_id: uuid('workflow_id').references(() => workflows.id),
  workflow_version: integer('workflow_version'),
  
  status: text('status').notNull(),  // running|success|error|cancelled
  mode: text('mode').notNull(),      // manual|trigger|webhook|retry|mcp
  
  // Full data (enterprise feature in n8n - FREE here)
  trigger_data: jsonb('trigger_data'),
  result_data: jsonb('result_data'),
  node_executions: jsonb('node_executions').default([]),
  
  error: jsonb('error'),
  
  triggered_by: text('triggered_by').notNull(),  // user or "mcp:claude"
  started_at: timestamp('started_at').defaultNow(),
  finished_at: timestamp('finished_at'),
  duration_ms: integer('duration_ms'),
});

// AUDIT LOG (enterprise in n8n - FREE here)
export const audit_log = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  timestamp: timestamp('timestamp').defaultNow(),
  
  actor: text('actor').notNull(),          // "user:alex@..." or "mcp:claude-code"
  action: text('action').notNull(),        // "workflow.created" etc
  resource_type: text('resource_type'),    // "workflow"|"execution"|"credential"
  resource_id: text('resource_id'),
  
  changes: jsonb('changes'),               // { before, after }
  metadata: jsonb('metadata'),             // { ip, user_agent, mcp_tool }
});

// WORKFLOW VERSIONS (enterprise in n8n - FREE here)
export const workflow_versions = pgTable('workflow_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflow_id: uuid('workflow_id').references(() => workflows.id),
  version: integer('version').notNull(),
  
  snapshot: jsonb('snapshot').notNull(),    // full workflow state
  git_sha: text('git_sha'),
  message: text('message'),
  
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow(),
});

// USERS & RBAC (enterprise in n8n - FREE here)
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  password_hash: text('password_hash'),    // null for SSO users
  role: text('role').default('editor'),    // admin|editor|viewer
  sso_provider: text('sso_provider'),      // null|saml|ldap
  sso_id: text('sso_id'),
  created_at: timestamp('created_at').defaultNow(),
});

// CREDENTIALS / SECRETS (enterprise in n8n - FREE here)
export const credentials = pgTable('credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: text('type').notNull(),            // "api_key"|"oauth2"|"basic"
  data_encrypted: text('data_encrypted').notNull(),  // AES-256 encrypted
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
});

// AI REVIEW ANNOTATIONS (unique to flowAIbuilder - no equivalent in n8n)
export const annotations = pgTable('annotations', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflow_id: uuid('workflow_id').references(() => workflows.id),
  node_id: text('node_id').notNull(),
  
  severity: text('severity').notNull(),    // error|warning|suggestion
  title: text('title').notNull(),
  description: text('description').notNull(),
  
  fix: jsonb('fix'),                       // { tool, params, description }
  related_nodes: jsonb('related_nodes'),   // string[]
  knowledge_source: text('knowledge_source'), // which n8n-skill
  
  status: text('status').default('active'), // active|applied|dismissed
  dismissed_reason: text('dismissed_reason'),
  
  created_at: timestamp('created_at').defaultNow(),
  applied_at: timestamp('applied_at'),
});

// WORKFLOW REVIEWS (review history)
export const workflow_reviews = pgTable('workflow_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflow_id: uuid('workflow_id').references(() => workflows.id),
  execution_id: uuid('execution_id'),      // null for manual review, set for post-execution
  
  review_type: text('review_type').notNull(), // full|quick|security|performance
  health_score: integer('health_score'),
  scores: jsonb('scores'),                 // { security, reliability, data_integrity, best_practices }
  summary: text('summary'),
  annotation_count: integer('annotation_count'),
  
  created_at: timestamp('created_at').defaultNow(),
});

// PROTECTED ZONES (unique to flowAIbuilder - canvas regions AI cannot modify)
export const protected_zones = pgTable('protected_zones', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflow_id: uuid('workflow_id').references(() => workflows.id),
  
  name: text('name').notNull(),              // "CRM Integration"
  node_ids: jsonb('node_ids').notNull(),     // string[] - nodes in this zone
  color: text('color').default('#378ADD'),   // boundary color on canvas
  
  pinned_by: text('pinned_by').notNull(),    // "user:alex@..." or "agent:reviewer"
  pinned_at: timestamp('pinned_at').defaultNow(),
  reason: text('reason'),                    // "Production-tested, do not modify"
  
  // Permissions
  can_unpin: jsonb('can_unpin').default([]), // who can unpin (default: creator + admins)
});
```

## Workflow Execution Engine

The heart of flowAIbuilder. This is what makes it a real workflow engine, not a visual toy.

```typescript
// engine/executor.ts

export class WorkflowExecutor {
  
  async execute(workflow: Workflow, triggerData?: unknown): Promise<Execution> {
    // 1. Create execution record
    const execution = await this.createExecution(workflow, triggerData);
    
    // 2. Topological sort nodes
    const sortedNodes = this.topologicalSort(workflow.nodes, workflow.connections);
    
    // 3. Execute nodes in order, passing data through connections
    const nodeOutputs = new Map<string, unknown>();
    
    for (const node of sortedNodes) {
      const nodeExec = await this.executeNode(node, {
        workflow,
        execution,
        nodeOutputs,       // outputs from previous nodes
        connections: workflow.connections,
        triggerData,
      });
      
      nodeOutputs.set(node.id, nodeExec.output);
      
      // Broadcast to WebSocket (canvas shows live progress)
      this.broadcaster.send({
        type: 'node_executed',
        execution_id: execution.id,
        node_id: node.id,
        status: nodeExec.status,
        duration_ms: nodeExec.duration_ms,
      });
      
      // Handle IF/Switch branching
      if (node.type === 'if' || node.type === 'switch') {
        // Skip nodes on untaken branches
        this.markSkippedBranches(node, nodeExec.output, sortedNodes);
      }
      
      // Stop on error (unless retry configured)
      if (nodeExec.status === 'error' && !workflow.settings.retry_on_fail) {
        break;
      }
    }
    
    // 4. Finalize execution
    return this.finalizeExecution(execution, nodeOutputs);
  }
}
```

### Node Context ($input, $json, $helpers, $secrets)

```typescript
// engine/context.ts
// This is what Code nodes have access to

export function createNodeContext(params: {
  input: unknown;            // data from previous node
  workflow: Workflow;
  secrets: Record<string, string>;
  env: Record<string, string>;
}) {
  return {
    // Data access (n8n compatible naming)
    $input: {
      first: () => params.input?.[0],
      last: () => params.input?.[params.input.length - 1],
      all: () => params.input,
      item: params.input?.[0],
    },
    $json: params.input?.[0]?.json || {},
    
    // Environment
    $env: params.env,
    $secrets: params.secrets,    // decrypted at runtime
    
    // Built-in helpers
    $helpers: {
      httpRequest: async (config) => {
        // Built-in HTTP client with retry, timeout, auth
        return httpRequest(config);
      },
    },
    
    // Utilities
    DateTime: luxon.DateTime,
    JSON,
    console: sandboxedConsole,
  };
}
```

## MCP Server Implementation

```typescript
// mcp/index.ts

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function createMcpServer(app: FastifyInstance) {
  const server = new McpServer({
    name: "flowaibuilder",
    version: "0.1.0",
    description: "AI-native workflow engine. Create, edit, execute workflows via MCP.",
  });

  // Workflow management
  server.tool("flowaibuilder.create_workflow", schemas.createWorkflow, 
    async ({ name, description }) => {
      const wf = await app.services.workflows.create({ name, description });
      await app.services.audit.log('mcp:claude', 'workflow.created', 'workflow', wf.id);
      app.ws.broadcast({ type: 'workflow_created', workflow: wf });
      return { workflow_id: wf.id, canvas_url: `http://localhost:5173/editor/${wf.id}` };
    }
  );

  server.tool("flowaibuilder.add_node", schemas.addNode,
    async ({ workflow_id, type, name, config, connect_after }) => {
      const node = await app.services.nodes.add(workflow_id, { type, name, config });
      if (connect_after) {
        await app.services.nodes.connect(workflow_id, connect_after, node.id);
      }
      // Auto-position
      const position = await app.services.canvas.autoPosition(workflow_id, node.id);
      await app.services.audit.log('mcp:claude', 'node.added', 'node', node.id);
      app.ws.broadcast({ type: 'node_added', workflow_id, node, position });
      return { node_id: node.id, position };
    }
  );

  server.tool("flowaibuilder.execute_workflow", schemas.executeWorkflow,
    async ({ workflow_id, input_data }) => {
      const wf = await app.services.workflows.get(workflow_id);
      const execution = await app.engine.execute(wf, input_data);
      return {
        execution_id: execution.id,
        status: execution.status,
        duration_ms: execution.duration_ms,
        node_results: execution.node_executions.map(ne => ({
          node: ne.node_name,
          status: ne.status,
          output: ne.output_data,
        })),
      };
    }
  );

  // Enterprise tools - ALL FREE
  server.tool("flowaibuilder.get_audit_log", schemas.getAuditLog,
    async ({ workflow_id, since, limit }) => {
      return app.services.audit.query({ workflow_id, since, limit });
    }
  );

  server.tool("flowaibuilder.git_push", schemas.gitPush,
    async ({ workflow_id, message }) => {
      const wf = await app.services.workflows.get(workflow_id);
      const sha = await app.services.git.pushWorkflow(wf, message);
      return { sha, message };
    }
  );

  // AI Review tools (zero-cost: serve data to Claude, Claude thinks on user's subscription)
  server.tool("flowaibuilder.get_review_context", schemas.getReviewContext,
    async ({ workflow_id }) => {
      const wf = await app.services.workflows.get(workflow_id);
      const execs = await app.services.executions.recent(workflow_id, 5);
      return buildReviewContext(wf, execs);
    }
  );

  server.tool("flowaibuilder.save_annotations", schemas.saveAnnotations,
    async ({ workflow_id, annotations, health_score }) => {
      await app.annotationStore.saveAnnotations(workflow_id, annotations);
      await app.services.workflows.updateHealthScore(workflow_id, health_score);
      return { saved: annotations.length, health_score };
    }
  );

  server.tool("flowaibuilder.apply_fix", schemas.applyFix,
    async ({ workflow_id, annotation_id }) => {
      await app.annotationStore.applyFix(workflow_id, annotation_id);
      return { success: true };
    }
  );

  // Protected Zones tools
  server.tool("flowaibuilder.create_zone", schemas.createZone,
    async ({ workflow_id, name, node_ids, color }) => {
      const zone = await app.zoneManager.create(workflow_id, { name, node_ids, color });
      return zone;
    }
  );

  server.tool("flowaibuilder.get_zones", schemas.getZones,
    async ({ workflow_id }) => {
      return app.zoneManager.getZones(workflow_id);
    }
  );

  server.tool("flowaibuilder.delete_zone", schemas.deleteZone,
    async ({ workflow_id, zone_id }) => {
      await app.zoneManager.delete(workflow_id, zone_id);
      return { deleted: true };
    }
  );

  return server;
}
```

## Protected Zones Enforcement

Every MCP tool that modifies nodes checks protected zones first. This is server-side enforcement - Claude cannot bypass it.

```typescript
// zones/enforcer.ts
// Middleware that blocks writes to pinned nodes

export class ZoneEnforcer {
  
  async checkWrite(workflow_id: string, node_id: string, operation: string): Promise<void> {
    const zones = await db.select().from(protected_zones)
      .where(eq(protected_zones.workflow_id, workflow_id));
    
    for (const zone of zones) {
      const nodeIds = zone.node_ids as string[];
      if (nodeIds.includes(node_id)) {
        throw new McpError(
          `PROTECTED ZONE: Cannot ${operation} node "${node_id}". ` +
          `It belongs to zone "${zone.name}" (pinned by ${zone.pinned_by} on ${zone.pinned_at}). ` +
          `You CAN: read this node's config, trace data flow through it, connect new nodes to its outputs. ` +
          `You CANNOT: modify config, remove node, or disconnect its edges. ` +
          `Build around this zone or ask the human to unpin it.`
        );
      }
    }
  }
  
  // Wraps existing node operations with zone checks
  wrapNodeTools(server: McpServer, app: App) {
    const originalUpdateNode = app.services.nodes.update;
    app.services.nodes.update = async (workflow_id, node_id, changes) => {
      await this.checkWrite(workflow_id, node_id, 'update');
      return originalUpdateNode(workflow_id, node_id, changes);
    };
    
    const originalRemoveNode = app.services.nodes.remove;
    app.services.nodes.remove = async (workflow_id, node_id) => {
      await this.checkWrite(workflow_id, node_id, 'remove');
      return originalRemoveNode(workflow_id, node_id);
    };
    
    const originalDisconnect = app.services.nodes.disconnect;
    app.services.nodes.disconnect = async (workflow_id, source, target) => {
      await this.checkWrite(workflow_id, source, 'disconnect from');
      await this.checkWrite(workflow_id, target, 'disconnect to');
      return originalDisconnect(workflow_id, source, target);
    };
  }
}
```

The error message is designed to **guide Claude** - it tells Claude exactly what it CAN do (read, connect to outputs) and what it CANNOT do (modify, remove). Claude adapts its approach based on this feedback.

### Zone Manager

```typescript
// zones/manager.ts

export class ZoneManager {
  
  async create(workflow_id: string, zone: CreateZoneInput): Promise<ProtectedZone> {
    const id = generateId();
    const entry = {
      id,
      workflow_id,
      name: zone.name,
      node_ids: zone.node_ids,
      color: zone.color || '#378ADD',
      pinned_by: zone.pinned_by || 'user',
      pinned_at: new Date().toISOString(),
    };
    
    await db.insert(protected_zones).values(entry);
    
    // Broadcast to canvas - nodes get lock icon + zone boundary appears
    this.broadcaster.send({
      type: 'zone_created',
      workflow_id,
      zone: entry,
    });
    
    // Lock positions of all nodes in the zone
    for (const nodeId of zone.node_ids) {
      await this.lockNodePosition(workflow_id, nodeId);
    }
    
    return entry;
  }
  
  async getZones(workflow_id: string): Promise<ProtectedZone[]> {
    return db.select().from(protected_zones)
      .where(eq(protected_zones.workflow_id, workflow_id));
  }
  
  async delete(workflow_id: string, zone_id: string): Promise<void> {
    const zone = await db.select().from(protected_zones)
      .where(eq(protected_zones.id, zone_id))
      .then(r => r[0]);
    
    if (!zone) throw new Error('Zone not found');
    
    await db.delete(protected_zones).where(eq(protected_zones.id, zone_id));
    
    // Unlock positions
    for (const nodeId of (zone.node_ids as string[])) {
      await this.unlockNodePosition(workflow_id, nodeId);
    }
    
    this.broadcaster.send({
      type: 'zone_deleted',
      workflow_id,
      zone_id,
    });
  }
}
```

### Review Context includes zone info

```typescript
// When Claude calls get_review_context, zones are included:
{
  workflow: { ... },
  protected_zones: [
    {
      name: "CRM Integration",
      node_ids: ["webhook_1", "extract_1", "crm_enrich_1"],
      pinned_by: "user:alex",
      reason: "Production-tested"
    }
  ],
  // Claude knows: don't suggest changes to these nodes, only to nodes around them
}
```

The review engine is what makes flowAIbuilder fundamentally different from every other workflow tool. It serializes the workflow into a structured context, sends it to Claude for analysis, and parses the response into actionable annotations that appear on the canvas.

### Context Builder

```typescript
// review/context-builder.ts
// Builds a structured context that Claude can analyze

export function buildReviewContext(workflow: Workflow, execution?: Execution): string {
  const nodes = workflow.nodes.map(n => ({
    id: n.id,
    type: n.type,
    name: n.name,
    config: n.parameters,
    incoming_connections: getIncoming(n.id, workflow.connections),
    outgoing_connections: getOutgoing(n.id, workflow.connections),
    // What data fields are available at this node
    available_fields: traceDataFlow(n.id, workflow),
  }));
  
  const context = {
    workflow_name: workflow.name,
    workflow_description: workflow.description,
    node_count: nodes.length,
    nodes,
    connections: workflow.connections,
    detected_pattern: detectPattern(workflow),
    credentials_used: extractCredentialTypes(workflow),
    
    // If execution data available (post-run review)
    execution: execution ? {
      status: execution.status,
      error: execution.error,
      node_results: execution.node_executions,
      duration_ms: execution.duration_ms,
    } : undefined,
  };
  
  return JSON.stringify(context, null, 2);
}
```

### Review Data Store (server-side, no AI)

flowAIbuilder server stores and serves review data. It does NOT call Claude API.

```typescript
// review/store.ts
// Pure data operations - no AI, no Anthropic SDK

export class AnnotationStore {
  
  // Claude (user's subscription) calls save_annotations via MCP
  async saveAnnotations(workflow_id: string, annotations: Annotation[]): Promise<void> {
    // Generate IDs, set timestamps
    const entries = annotations.map(a => ({
      id: generateId(),
      workflow_id,
      node_id: a.node_id,
      severity: a.severity,
      title: a.title,
      description: a.description,
      fix: a.fix || null,
      status: 'active',
      created_at: new Date().toISOString(),
    }));
    
    // Insert into DB
    await db.insert(annotationsTable).values(entries);
    
    // Broadcast to canvas via WebSocket
    this.broadcaster.send({
      type: 'review_completed',
      workflow_id,
      annotations: entries,
    });
  }
  
  // Apply a fix that Claude defined in the annotation
  async applyFix(workflow_id: string, annotation_id: string): Promise<void> {
    const annotation = await this.getAnnotation(annotation_id);
    if (!annotation?.fix) throw new Error('No fix available');
    
    // Execute the fix (e.g. update_node with new config)
    await this.toolExecutor.execute(annotation.fix.tool, annotation.fix.params);
    
    // Mark as applied
    await db.update(annotationsTable)
      .set({ status: 'applied', applied_at: new Date().toISOString() })
      .where(eq(annotationsTable.id, annotation_id));
    
    this.broadcaster.send({ type: 'annotation_applied', workflow_id, annotation_id });
  }
  
  async getAnnotations(workflow_id: string, filter?: { severity?: string }) {
    return db.select().from(annotationsTable)
      .where(eq(annotationsTable.workflow_id, workflow_id));
  }
}
```

### Context Builder (server-side, rule-based, no AI)

```typescript
// review/context-builder.ts
// Builds structured context for Claude to analyze
// This is what get_review_context returns - pure data computation

export function buildReviewContext(workflow: Workflow, executions?: Execution[]): ReviewContext {
  return {
    workflow: {
      id: workflow.id,
      name: workflow.name,
      nodes: workflow.nodes.map(n => ({
        id: n.id,
        type: n.type,
        name: n.name,
        config: n.parameters,
        // Server computes data flow (no AI needed)
        incoming_data_fields: traceIncomingFields(n.id, workflow),
        outgoing_data_fields: traceOutgoingFields(n.id, workflow),
      })),
      connections: workflow.connections,
      // Simple rule-based pattern detection
      detected_pattern: detectPattern(workflow),
      credentials_used: extractCredentialTypes(workflow),
    },
    recent_executions: executions?.map(e => ({
      status: e.status,
      error: e.error?.message,
      node_errors: e.node_executions
        .filter(ne => ne.status === 'error')
        .map(ne => ({ node_id: ne.node_id, error: ne.error?.message })),
      duration_ms: e.duration_ms,
    })),
    current_annotations: await store.getAnnotations(workflow.id),
  };
}

// Rule-based, no AI
function detectPattern(wf: Workflow): string {
  const types = wf.nodes.map(n => n.type);
  if (types.some(t => t.includes('langchain'))) return 'ai_agent';
  if (types.some(t => t.includes('webhook')) && types.filter(t => t.includes('http')).length <= 1) return 'webhook_processing';
  if (types.filter(t => t.includes('http')).length >= 2) return 'http_api_chain';
  if (types.some(t => t.includes('schedule'))) return 'scheduled_batch';
  return 'general';
}

// Rule-based data flow tracing
function traceIncomingFields(nodeId: string, wf: Workflow): string[] {
  // Walk backwards through connections to find what fields arrive at this node
  // Based on previous nodes' output shapes
  // No AI needed - just graph traversal + known node output schemas
}
```

### Agent Teams File Watcher (reads Claude Code's team files)

```typescript
// agent-teams/watcher.ts
// Watches ~/.claude/teams/<teamName>/ for changes
// Translates file changes to WebSocket broadcasts for canvas

import { watch } from 'fs';
import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { homedir } from 'os';

export class AgentTeamWatcher {
  private teamDir: string;
  private watchers = new Map<string, ReturnType<typeof watch>>();
  
  constructor(private broadcaster: WebSocketBroadcaster) {
    this.teamDir = join(homedir(), '.claude', 'teams');
  }
  
  async watchTeam(teamName: string): Promise<void> {
    const teamPath = join(this.teamDir, teamName);
    const inboxDir = join(teamPath, 'inboxes');
    const tasksPath = join(teamPath, 'tasks.json');
    
    // Watch inbox directory for new/changed message files
    const inboxWatcher = watch(inboxDir, { recursive: true }, async (event, filename) => {
      if (!filename?.endsWith('.json')) return;
      const agentName = filename.replace('.json', '');
      const messages = await this.readInbox(join(inboxDir, filename));
      this.broadcaster.send({
        type: 'agent_messages_updated',
        team_name: teamName,
        agent_name: agentName,
        messages: messages.slice(-5),  // last 5 messages
      });
    });
    
    // Watch tasks.json for task status changes
    const taskWatcher = watch(tasksPath, async () => {
      const tasks = await this.readTasks(tasksPath);
      const progress = tasks.filter(t => t.status === 'done').length / tasks.length;
      this.broadcaster.send({
        type: 'team_tasks_updated',
        team_name: teamName,
        tasks,
        progress: Math.round(progress * 100),
      });
    });
    
    this.watchers.set(teamName, inboxWatcher);
  }
  
  async getTeamState(teamName: string): Promise<TeamState> {
    const teamPath = join(this.teamDir, teamName);
    const tasks = await this.readTasks(join(teamPath, 'tasks.json'));
    const agents = await this.discoverAgents(join(teamPath, 'inboxes'));
    
    return {
      team_name: teamName,
      agents: agents.map(a => ({
        name: a.name,
        status: this.inferAgentStatus(a, tasks),
        current_task: tasks.find(t => t.assignee === a.name && t.status === 'in_progress'),
        completed_tasks: tasks.filter(t => t.assignee === a.name && t.status === 'done').length,
        recent_messages: a.messages.slice(-3),
      })),
      tasks,
      progress: Math.round(tasks.filter(t => t.status === 'done').length / tasks.length * 100),
    };
  }
  
  // Human intervention: write to agent inbox
  async sendMessage(teamName: string, toAgent: string, message: string): Promise<void> {
    const inboxPath = join(this.teamDir, teamName, 'inboxes', `${toAgent}.json`);
    const inbox = await this.readInbox(inboxPath);
    inbox.push({
      id: generateId(),
      from: 'human',
      text: message,
      timestamp: new Date().toISOString(),
      read: false,
    });
    await writeFile(inboxPath, JSON.stringify(inbox, null, 2));
  }
  
  // Human intervention: modify task list
  async updateTask(teamName: string, taskId: string, changes: Partial<Task>): Promise<void> {
    const tasksPath = join(this.teamDir, teamName, 'tasks.json');
    const tasks = await this.readTasks(tasksPath);
    const idx = tasks.findIndex(t => t.id === taskId);
    if (idx >= 0) {
      tasks[idx] = { ...tasks[idx], ...changes };
      await writeFile(tasksPath, JSON.stringify(tasks, null, 2));
    }
  }
  
  private inferAgentStatus(agent: AgentInfo, tasks: Task[]): string {
    const activeTask = tasks.find(t => t.assignee === agent.name && t.status === 'in_progress');
    if (activeTask) return 'working';
    const blockedTask = tasks.find(t => t.assignee === agent.name && t.blockedBy?.length);
    if (blockedTask) return 'blocked';
    return 'idle';
  }
  
  stopWatching(teamName: string): void {
    this.watchers.get(teamName)?.close();
    this.watchers.delete(teamName);
  }
}
```

### Agent Teams MCP Tools

```typescript
// mcp/tools/agent-team-tools.ts
// Pure data: reads/writes same files Claude Code Agent Teams use

server.tool("flowaibuilder.watch_team", schemas.watchTeam,
  async ({ team_name }) => {
    await app.teamWatcher.watchTeam(team_name);
    const state = await app.teamWatcher.getTeamState(team_name);
    return { watching: true, ...state };
  }
);

server.tool("flowaibuilder.get_team_state", schemas.getTeamState,
  async ({ team_name }) => {
    return app.teamWatcher.getTeamState(team_name);
  }
);

server.tool("flowaibuilder.send_team_message", schemas.sendTeamMessage,
  async ({ team_name, to_agent, message }) => {
    await app.teamWatcher.sendMessage(team_name, to_agent, message);
    return { sent: true, to: to_agent };
  }
);

server.tool("flowaibuilder.update_task", schemas.updateTask,
  async ({ team_name, task_id, changes }) => {
    await app.teamWatcher.updateTask(team_name, task_id, changes);
    return { updated: true };
  }
);

server.tool("flowaibuilder.add_task", schemas.addTask,
  async ({ team_name, task }) => {
    const tasksPath = join(homedir(), '.claude', 'teams', team_name, 'tasks.json');
    const tasks = JSON.parse(await readFile(tasksPath, 'utf8'));
    const newTask = { id: generateId(), status: 'unassigned', ...task };
    tasks.push(newTask);
    await writeFile(tasksPath, JSON.stringify(tasks, null, 2));
    return { task_id: newTask.id };
  }
);

server.tool("flowaibuilder.link_task_to_node", schemas.linkTaskToNode,
  async ({ team_name, task_id, workflow_id, node_id }) => {
    // Store the mapping: this task is building this workflow node
    await app.services.taskNodeLinks.create({ team_name, task_id, workflow_id, node_id });
    app.ws.broadcast({
      type: 'task_linked_to_node',
      team_name, task_id, workflow_id, node_id,
    });
    return { linked: true };
  }
);
```
```

## WebSocket Protocol

```typescript
// Server -> UI
type ServerMessage =
  | { type: "workflow_created"; workflow: Workflow }
  | { type: "node_added"; workflow_id: string; node: WorkflowNode; position: Position }
  | { type: "node_updated"; workflow_id: string; node_id: string; changes: Partial<WorkflowNode> }
  | { type: "node_removed"; workflow_id: string; node_id: string }
  | { type: "connection_added"; workflow_id: string; source: string; target: string }
  | { type: "node_executed"; execution_id: string; node_id: string; status: string; duration_ms: number }
  | { type: "execution_completed"; execution_id: string; status: string }
  | { type: "full_sync"; workflow: Workflow; canvas: CanvasState }
  // AI Review (zero-cost - Claude writes via MCP, server broadcasts)
  | { type: "review_completed"; workflow_id: string; annotations: Annotation[] }
  | { type: "annotation_applied"; workflow_id: string; annotation_id: string }
  | { type: "annotation_dismissed"; workflow_id: string; annotation_id: string }
  // Agent Teams (file watcher reads ~/.claude/teams/, broadcasts to canvas)
  | { type: "agent_messages_updated"; team_name: string; agent_name: string; messages: TeamMessage[] }
  | { type: "team_tasks_updated"; team_name: string; tasks: Task[]; progress: number }
  | { type: "task_linked_to_node"; team_name: string; task_id: string; workflow_id: string; node_id: string }
  // Protected Zones
  | { type: "zone_created"; workflow_id: string; zone: ProtectedZone }
  | { type: "zone_deleted"; workflow_id: string; zone_id: string };

// UI -> Server
type ClientMessage =
  | { type: "node_moved"; workflow_id: string; node_id: string; position: Position }
  | { type: "node_config_updated"; workflow_id: string; node_id: string; parameters: object }
  | { type: "node_deleted"; workflow_id: string; node_id: string }
  | { type: "connection_created"; workflow_id: string; source: string; target: string }
  | { type: "execute_workflow"; workflow_id: string; input_data?: unknown };
```

## Docker Compose (One-Command Deploy)

```yaml
# docker-compose.yml
version: '3.8'

services:
  flowaibuilder:
    build: ./packages/server
    ports:
      - "3000:3000"    # API + MCP HTTP
      - "5174:5174"    # WebSocket
    environment:
      DATABASE_URL: postgres://flowaibuilder:flowaibuilder@postgres:5432/flowaibuilder
      REDIS_URL: redis://redis:6379
      JWT_SECRET: change-me-in-production
      ENCRYPTION_KEY: change-me-in-production
    depends_on:
      - postgres
      - redis

  ui:
    build: ./packages/ui
    ports:
      - "5173:5173"
    environment:
      VITE_API_URL: http://localhost:3000
      VITE_WS_URL: ws://localhost:5174

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: flowaibuilder
      POSTGRES_USER: flowaibuilder
      POSTGRES_PASSWORD: flowaibuilder
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    volumes:
      - redisdata:/data

volumes:
  pgdata:
  redisdata:
```

Start command:
```bash
git clone https://github.com/user/flowaibuilder && cd flowaibuilder
docker compose up -d
# flowAIbuilder UI: http://localhost:5173
# flowAIbuilder API: http://localhost:3000
# MCP config: add to Claude Desktop/Code settings
```

## Security Model

### Code Node Sandboxing
```typescript
// engine/sandbox.ts
// Code nodes run in isolated VM to prevent escape

import { Isolate, Context } from 'isolated-vm';

export async function executeInSandbox(code: string, context: NodeContext) {
  const isolate = new Isolate({ memoryLimit: 128 }); // 128MB max
  const ctx = await isolate.createContext();
  
  // Inject allowed globals
  await ctx.global.set('$input', context.$input);
  await ctx.global.set('$json', context.$json);
  await ctx.global.set('$helpers', context.$helpers);
  await ctx.global.set('$secrets', context.$secrets);
  
  // Execute with timeout
  const result = await ctx.eval(code, { timeout: 30000 }); // 30s max
  
  isolate.dispose();
  return result;
}
```

### Secrets Encryption
```typescript
// enterprise/secrets/manager.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

export function encrypt(data: string, key: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, Buffer.from(key, 'hex'), iv);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${encrypted}`;
}
```

## Key Design Decisions

### Why NOT fork n8n?
- n8n license (Sustainable Use) restricts competitive use
- n8n codebase is massive and complex (hard to maintain a fork)
- Building from scratch means clean architecture, AI-native from day one
- MIT license from the start = no legal risk

### Why Fastify over Express?
- 2-3x faster
- Built-in schema validation (important for MCP tools)
- Plugin system matches our architecture
- TypeBox for type-safe route definitions

### Why Drizzle over Prisma?
- Lighter weight, less magic
- Better SQL control (important for execution queries)
- Faster cold starts
- TypeScript-first with inferred types

### Why BullMQ for queue mode?
- Most popular Node.js job queue
- Redis-backed (we already have Redis)
- Built-in retry, concurrency, rate limiting
- Dashboard available (Bull Board)
- Production-proven at scale

### Why zero-cost AI (no server-side Claude API)?
- flowAIbuilder has zero variable costs per user - scales infinitely without billing headaches
- User already pays for Claude Pro/Max - they get full model quality for free (for us)
- No API key management, no token counting, no rate limiting on our side
- MCP is designed exactly for this pattern: server = tools + data, client = brain
- Same model as n8n-mcp, Figma MCP, GitHub MCP - the tool serves data, the AI thinks

### Why Agent Teams as propose-then-confirm?
- Claude is powerful but not infallible - human approval prevents costly mistakes
- Proposed nodes (dashed border) are visually distinct from confirmed (solid) - no ambiguity
- Human can intervene at ANY phase - pause, redirect, skip, override
- The canvas becomes a live dashboard of Claude's decision-making process
- Agent profiles are customizable - teams can encode their own patterns and rules
- Works with any MCP-compatible AI client, not just Claude Code

### Why separate agent phases?
- Each phase has different goals and different MCP tool usage patterns
- Canvas shows which phase is active - human always knows what Claude is doing
- Phases can be skipped ("don't review, just build fast") or repeated ("review again")
- Execution traces per phase enable debugging ("the Architect chose wrong pattern")
- Natural handoff points where human can steer the process
