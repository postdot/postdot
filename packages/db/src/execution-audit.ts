export const automaticExecutionAuditActions = {
    claimed: 'publication.execution.claimed',
    effectStarted: 'publication.execution.effect_started',
    succeeded: 'publication.execution.succeeded',
    retryScheduled: 'publication.execution.retry_scheduled',
    failed: 'publication.execution.failed',
    ambiguous: 'publication.execution.ambiguous',
    claimRecovered: 'publication.execution.claim_recovered',
    ambiguityRecovered: 'publication.execution.ambiguity_recovered',
    cancelled: 'publication.execution.cancelled',
} as const

export type AutomaticExecutionAuditAction =
    (typeof automaticExecutionAuditActions)[keyof typeof automaticExecutionAuditActions]

export interface AutomaticExecutionAuditMetadata {
    readonly jobId: string
    readonly attempt: number
    readonly occurredAt: number
    readonly [key: string]: unknown
}

export function serializeAutomaticExecutionAuditMetadata(
    metadata: AutomaticExecutionAuditMetadata
): string {
    return JSON.stringify(metadata)
}
