import { createPostbotClient, type PostbotClient } from '@postdot/client'

import type { CadenceWarning } from './cadence-confirmation'
export const client: PostbotClient = createPostbotClient(window.location.origin)
export interface ProfileDefinitionIssue {
    readonly code: string
    readonly path: string
}

export class ApiError extends Error {
    readonly status: number
    readonly code: string
    readonly blockers: readonly string[]

    constructor(
        status: number,
        code: string,
        message: string,
        blockers: readonly string[] = [],
        readonly profileIssues: readonly ProfileDefinitionIssue[] = [],
        readonly profileIssueCount: number = profileIssues.length,
        readonly confirmation?: string,
        readonly warnings?: readonly CadenceWarning[]
    ) {
        super(message)
        this.name = 'ApiError'
        this.status = status
        this.code = code
        this.blockers = blockers
    }
}

export function errorFrom(status: number, value: unknown) {
    const envelope =
        typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
    const payload =
        envelope?.value !== null && typeof envelope?.value === 'object'
            ? (envelope.value as Record<string, unknown>)
            : envelope
    const details =
        payload?.error !== null && typeof payload?.error === 'object'
            ? (payload.error as Record<string, unknown>)
            : payload
    const blockers = Array.isArray(details?.blockers)
        ? details.blockers.filter((blocker): blocker is string => typeof blocker === 'string')
        : []
    return new ApiError(
        status,
        typeof details?.code === 'string' ? details.code : 'request_failed',
        typeof details?.message === 'string' ? details.message : '',
        blockers,
        Array.isArray(details?.issues)
            ? details.issues
                  .filter(
                      (issue): issue is ProfileDefinitionIssue =>
                          typeof issue === 'object' &&
                          issue !== null &&
                          typeof issue.code === 'string' &&
                          typeof issue.path === 'string' &&
                          issue.path.length <= 512
                  )
                  .slice(0, 20)
            : [],
        typeof details?.issueCount === 'number' &&
            Number.isSafeInteger(details.issueCount) &&
            details.issueCount > 0
            ? details.issueCount
            : 0,
        typeof details?.confirmation === 'string' ? details.confirmation : undefined,
        Array.isArray(details?.warnings) ? (details.warnings as CadenceWarning[]) : undefined
    )
}

export function unwrap<T>(result: {
    readonly data: T | null
    readonly error: unknown
    readonly status: number
}): T {
    if (result.error !== null) throw errorFrom(result.status, result.error)
    if (result.data === null) throw new ApiError(result.status, 'empty_response', '')
    return result.data
}
