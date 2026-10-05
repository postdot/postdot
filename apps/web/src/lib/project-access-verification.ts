import type { ProjectMemberRole } from '@/lib/api'

/**
 * Explicit access assessment for one open project. `confirmed` is the only
 * state that permits new server writes. `verifying` never asserts revocation:
 * the `project.access-revoked` signal cannot distinguish genuine revocation
 * from an unavailable authorization check.
 */
export type ProjectAccessStatus = 'confirmed' | 'verifying' | 'denied' | 'technical-error'

export interface ProjectAccessState {
    readonly status: ProjectAccessStatus
    /**
     * Fresh role override from a successful verification read. `null` means no
     * override: the caller falls back to the project dashboard role, which
     * stays authoritative for ordinary refreshes.
     */
    readonly role: ProjectMemberRole | null
    /**
     * Increments on every entry into `verifying`. Async continuations capture
     * the epoch at dispatch and must apply nothing once it changed.
     */
    readonly epoch: number
}

export type ProjectAccessAction =
    | { readonly type: 'access-revoked' }
    | { readonly type: 'refetch-refused' }
    | { readonly type: 'verification-succeeded'; readonly role: ProjectMemberRole }
    | { readonly type: 'verification-denied' }
    | { readonly type: 'verification-failed' }
    | { readonly type: 'retry-verification' }
    | { readonly type: 'clear-role-override' }

export function createProjectAccessState(): ProjectAccessState {
    return { status: 'confirmed', role: null, epoch: 0 }
}

export function projectAccessReducer(
    state: ProjectAccessState,
    action: ProjectAccessAction
): ProjectAccessState {
    switch (action.type) {
        case 'access-revoked':
            if (state.status !== 'confirmed') return state
            return { status: 'verifying', role: state.role, epoch: state.epoch + 1 }
        // A refused refetch of previously loaded data is the same ambiguous
        // situation through a degraded transport: genuine revocation and an
        // unavailable check are indistinguishable from the status alone.
        case 'refetch-refused':
            if (state.status !== 'confirmed') return state
            return { status: 'verifying', role: state.role, epoch: state.epoch + 1 }
        case 'verification-succeeded':
            if (state.status !== 'verifying') return state
            return { status: 'confirmed', role: action.role, epoch: state.epoch }
        case 'verification-denied':
            if (state.status !== 'verifying') return state
            return { status: 'denied', role: state.role, epoch: state.epoch }
        case 'verification-failed':
            if (state.status !== 'verifying') return state
            return { status: 'technical-error', role: state.role, epoch: state.epoch }
        case 'retry-verification':
            if (state.status !== 'denied' && state.status !== 'technical-error') return state
            return { status: 'verifying', role: state.role, epoch: state.epoch + 1 }
        case 'clear-role-override':
            if (state.status !== 'confirmed' || state.role === null) return state
            return { status: 'confirmed', role: null, epoch: state.epoch }
    }
}

/**
 * Map a membership verification failure onto the machine. 401 always means an
 * unusable session or transport and must never be presented as a revocation.
 * 403/404 from the session membership read mean editor capability cannot be
 * established for this page. The check is structural so this module never
 * depends on the API client runtime; `ApiError` always carries a numeric
 * status.
 */
export function classifyMembershipVerificationError(
    error: unknown
): 'verification-denied' | 'verification-failed' {
    const status =
        typeof error === 'object' && error !== null
            ? (error as { readonly status?: unknown }).status
            : null
    if (status === 401) return 'verification-failed'
    if (status === 403 || status === 404) return 'verification-denied'
    return 'verification-failed'
}

export interface ConfirmedReconcileInput {
    readonly hasLocalChanges: boolean
    readonly serverRevision: number
    readonly expectedRevision: number
    readonly serverSourceConflict: boolean
}

export type ConfirmedReconcileDecision =
    | { readonly kind: 'adopt-server' }
    | { readonly kind: 'keep-local'; readonly conflict: boolean }

/**
 * Decide how a confirmed access state reconciles with a fresh server editor.
 * A divergent working copy never adopts a new reference revision here: the
 * existing write-conflict path stays responsible for resolving it.
 */
export function decideConfirmedReconcile(
    input: ConfirmedReconcileInput
): ConfirmedReconcileDecision {
    if (!input.hasLocalChanges) return { kind: 'adopt-server' }
    if (input.serverSourceConflict || input.serverRevision !== input.expectedRevision)
        return { kind: 'keep-local', conflict: true }
    return { kind: 'keep-local', conflict: false }
}
