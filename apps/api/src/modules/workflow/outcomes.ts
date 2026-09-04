import type { ExternalEffectOutcome } from '@herald/core'

export function permanentFailure(
    errorMessage: string
): Extract<ExternalEffectOutcome, { readonly type: 'permanent_failure' }> {
    return {
        type: 'permanent_failure',
        effectOccurred: false,
        errorMessage,
    }
}

export function ambiguousFailure(
    errorMessage: string
): Extract<ExternalEffectOutcome, { readonly type: 'ambiguous' }> {
    return { type: 'ambiguous', errorMessage }
}

export function retryableFailure(
    errorMessage: string
): Extract<ExternalEffectOutcome, { readonly type: 'retryable_failure' }> {
    return { type: 'retryable_failure', effectOccurred: false, errorMessage }
}
