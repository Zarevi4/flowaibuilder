import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { db } from '../../db/index.js';
import { workflows } from '../../db/schema.js';
import { toWorkflow } from '../../api/routes/workflows.js';
import { validateWorkflow } from '../../validation/index.js';

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}

function mcpError(message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

export function registerValidateTools(server: McpServer) {
  server.tool(
    'flowaibuilder.validate',
    {
      workflow_id: z.string().describe('Workflow ID to validate'),
    },
    async ({ workflow_id }) => {
      try {
        const [row] = await db.select().from(workflows).where(eq(workflows.id, workflow_id));
        if (!row) return mcpError(`Workflow not found: ${workflow_id}`);
        const result = validateWorkflow(toWorkflow(row));
        return text(JSON.stringify(result, null, 2));
      } catch (err) {
        return mcpError(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
