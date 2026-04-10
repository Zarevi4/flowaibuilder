import type { NodeType } from '@flowaibuilder/shared';

export const REQUIRED_FIELDS: Partial<Record<NodeType, string[]>> = {
  webhook: ['path'],
  'http-request': ['url'],
  'code-js': ['code'],
  'code-python': ['code'],
  if: ['condition'],
  switch: ['expression'],
  schedule: ['cron'],
  set: ['values'],
  'respond-webhook': [],
  'ai-agent': ['prompt'],
};

export function isMissing(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    if (Object.keys(value as Record<string, unknown>).length === 0) return true;
  }
  return false;
}
