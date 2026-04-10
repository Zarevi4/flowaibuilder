export type ValidationSeverity = 'error' | 'warning';

export type ValidationCode =
  | 'orphan-node'
  | 'circular-dependency'
  | 'missing-required-config'
  | 'expression-syntax-error'
  | 'dead-end-branch';

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: ValidationCode;
  message: string;
  nodeId?: string;
  connectionId?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}
