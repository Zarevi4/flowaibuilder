import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { db } from '../../db/index.js';
import { workflows } from '../../db/schema.js';
import { toWorkflow } from '../../api/routes/workflows.js';
import { compileWorkflow, ExportError, EXPORT_FORMATS } from '../../export/index.js';

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}

function mcpError(message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

export function registerExportTools(server: McpServer) {
  server.tool(
    'flowaibuilder.export',
    {
      workflow_id: z.string().describe('Workflow ID to export'),
      format: z
        .enum(EXPORT_FORMATS as unknown as [string, ...string[]])
        .describe('Output format: prompt | typescript | python | mermaid | json'),
    },
    async ({ workflow_id, format }) => {
      try {
        const [row] = await db.select().from(workflows).where(eq(workflows.id, workflow_id));
        if (!row) return mcpError(`Workflow not found: ${workflow_id}`);
        const result = compileWorkflow(toWorkflow(row), format as never);
        return text(result.content);
      } catch (err) {
        if (err instanceof ExportError) return mcpError(err.message);
        return mcpError(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
