import type { Workflow, ExportFormat, ExportResult } from '@flowaibuilder/shared';
import { EXPORT_FORMATS } from '@flowaibuilder/shared';
import { compilePrompt } from './compilers/prompt.js';
import { compileTypeScript } from './compilers/typescript.js';
import { compilePython } from './compilers/python.js';
import { compileMermaid } from './compilers/mermaid.js';
import { compileJson } from './compilers/json.js';

export { EXPORT_FORMATS };
export type { ExportFormat, ExportResult };

export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportError';
  }
}

const META: Record<ExportFormat, { ext: string; mimeType: string }> = {
  prompt: { ext: 'md', mimeType: 'text/markdown' },
  typescript: { ext: 'ts', mimeType: 'text/typescript' },
  python: { ext: 'py', mimeType: 'text/x-python' },
  mermaid: { ext: 'mmd', mimeType: 'text/vnd.mermaid' },
  json: { ext: 'json', mimeType: 'application/json' },
};

function slug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function compileWorkflow(workflow: Workflow, format: ExportFormat): ExportResult {
  if (!EXPORT_FORMATS.includes(format)) {
    throw new ExportError(
      `Unknown export format "${format}". Valid: ${EXPORT_FORMATS.join(', ')}`,
    );
  }
  let content: string;
  switch (format) {
    case 'prompt':
      content = compilePrompt(workflow);
      break;
    case 'typescript':
      content = compileTypeScript(workflow);
      break;
    case 'python':
      content = compilePython(workflow);
      break;
    case 'mermaid':
      content = compileMermaid(workflow);
      break;
    case 'json':
      content = compileJson(workflow);
      break;
    default: {
      const _exhaustive: never = format;
      throw new ExportError(
        `Unknown export format "${_exhaustive}". Valid: ${EXPORT_FORMATS.join(', ')}`,
      );
    }
  }
  const meta = META[format];
  const base = slug(workflow.name) || workflow.id;
  return {
    format,
    content,
    mimeType: meta.mimeType,
    filename: `${base}.${meta.ext}`,
  };
}
