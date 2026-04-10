import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { db } from '../../db/index.js';
import { workflows } from '../../db/schema.js';
import { toWorkflow } from '../../api/routes/workflows.js';
import { importN8nWorkflow, ImportError } from '../../import/index.js';
import { getBroadcaster } from '../../api/ws/broadcaster.js';

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}

function mcpError(message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

export function registerImportTools(server: McpServer) {
  server.tool(
    'flowaibuilder.import_n8n',
    {
      n8n_workflow_json: z.unknown().describe('Raw n8n workflow JSON export'),
      name: z.string().optional().describe('Override the imported workflow name'),
      description: z.string().optional().describe('Override the description'),
    },
    async ({ n8n_workflow_json, name, description }) => {
      try {
        const result = importN8nWorkflow(n8n_workflow_json, { name, description });
        const [row] = await db.insert(workflows).values({
          name: result.workflow.name,
          description: result.workflow.description,
          nodes: result.workflow.nodes,
          connections: result.workflow.connections,
          createdBy: 'mcp:import',
          updatedBy: 'mcp:import',
        }).returning();
        const wf = toWorkflow(row);
        getBroadcaster()?.broadcast('workflow_created', wf.id, wf);
        return text(JSON.stringify({ workflow: wf, warnings: result.warnings }, null, 2));
      } catch (err) {
        if (err instanceof ImportError) return mcpError(err.message);
        return mcpError(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
