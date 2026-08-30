export const validationIssueSeverities = ['error', 'warning'] as const
export const validationIssueSources = [
    'schema',
    'schema_policy',
    'field_binding',
    'capability',
    'domain',
    'module',
] as const

export type ValidationIssueSeverity = (typeof validationIssueSeverities)[number]
export type ValidationIssueSource = (typeof validationIssueSources)[number]

export interface ValidationIssue {
    readonly path: string
    readonly code: string
    readonly message: string
    readonly severity: ValidationIssueSeverity
    readonly source: ValidationIssueSource
}

export type ValidationResult<Value> =
    | {
          readonly ok: true
          readonly value: Value
          readonly issues: readonly ValidationIssue[]
      }
    | {
          readonly ok: false
          readonly issues: readonly ValidationIssue[]
      }

export type ContentValidationRule = (
    content: Readonly<Record<string, unknown>>
) => readonly ValidationIssue[] | Promise<readonly ValidationIssue[]>

export function hasValidationErrors(issues: readonly ValidationIssue[]): boolean {
    return issues.some(issue => issue.severity === 'error')
}

export function validationSuccess<Value>(
    value: Value,
    issues: readonly ValidationIssue[] = []
): ValidationResult<Value> {
    return { ok: true, value, issues }
}

export function validationFailure(issues: readonly ValidationIssue[]): ValidationResult<never> {
    return { ok: false, issues }
}
