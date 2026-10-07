import { DomainInvariantError } from './invariants'
import type { ValidationIssue } from './validation'

/** Retain normalized failures without making raw diagnostics a public HTTP contract. */
export class ChannelProfileValidationError extends DomainInvariantError {
    readonly issues: readonly ValidationIssue[]

    constructor(issues: readonly ValidationIssue[]) {
        super(
            'invalid_content',
            `Channel profile is invalid: ${issues.map(issue => issue.message).join('; ')}`
        )
        this.issues = Object.freeze(issues.map(issue => Object.freeze({ ...issue })))
    }
}
