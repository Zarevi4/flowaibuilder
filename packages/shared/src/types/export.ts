export const EXPORT_FORMATS = ['prompt', 'typescript', 'python', 'mermaid', 'json'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface ExportResult {
  format: ExportFormat;
  content: string;
  mimeType: string;
  filename: string;
}
