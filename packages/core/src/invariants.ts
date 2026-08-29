export const domainInvariantCodes = [
    'blank_value',
    'claim_expired',
    'claim_mismatch',
    'claim_not_expired',
    'invalid_actor_kind',
    'invalid_input',
    'invalid_job_source',
    'invalid_time',
    'invalid_transition',
    'project_mismatch',
] as const

export type DomainInvariantCode = (typeof domainInvariantCodes)[number]

export class DomainInvariantError extends Error {
    readonly code: DomainInvariantCode

    constructor(code: DomainInvariantCode, message: string) {
        super(message)
        this.name = 'DomainInvariantError'
        this.code = code
    }
}

export function requireNonBlank(value: string, field: string): string {
    const normalized = value.trim()

    if (normalized.length === 0) {
        throw new DomainInvariantError('blank_value', `${field} must not be blank`)
    }

    return normalized
}

export function requireTimestamp(value: number, field: string): number {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new DomainInvariantError(
            'invalid_time',
            `${field} must be a non-negative epoch-millisecond timestamp`
        )
    }

    return value
}

export function requireSameProject(
    projectId: string,
    relatedProjectId: string,
    relation: string
): void {
    if (projectId !== relatedProjectId) {
        throw new DomainInvariantError(
            'project_mismatch',
            `${relation} must belong to project ${projectId}`
        )
    }
}
