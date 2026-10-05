import { describe, expect, test } from 'bun:test'

import {
    classifyMembershipVerificationError,
    createProjectAccessState,
    decideConfirmedReconcile,
    projectAccessReducer,
} from '@/lib/project-access-verification'

describe('project access verification', () => {
    test('starts confirmed and advances the epoch on every verification entry', () => {
        const initial = createProjectAccessState()
        expect(initial).toEqual({ status: 'confirmed', role: null, epoch: 0 })

        const verifying = projectAccessReducer(initial, { type: 'access-revoked' })
        expect(verifying).toEqual({ status: 'verifying', role: null, epoch: 1 })

        // A repeated signal while verifying must not start another read.
        expect(projectAccessReducer(verifying, { type: 'access-revoked' })).toBe(verifying)

        // A refused refetch is the same ambiguous situation through a
        // degraded transport and follows the same single-verification path.
        const refused = projectAccessReducer(createProjectAccessState(), {
            type: 'refetch-refused',
        })
        expect(refused).toEqual({ status: 'verifying', role: null, epoch: 1 })
        expect(projectAccessReducer(verifying, { type: 'refetch-refused' })).toBe(verifying)

        const denied = projectAccessReducer(verifying, { type: 'verification-denied' })
        expect(denied.status).toBe('denied')

        const retrying = projectAccessReducer(denied, { type: 'retry-verification' })
        expect(retrying).toEqual({ status: 'verifying', role: null, epoch: 2 })

        // Retry is only offered from denied or technical-error states.
        expect(projectAccessReducer(initial, { type: 'retry-verification' })).toBe(initial)
        expect(projectAccessReducer(verifying, { type: 'retry-verification' })).toBe(verifying)
    })

    test('applies verification outcomes only while verifying', () => {
        const verifying = projectAccessReducer(createProjectAccessState(), {
            type: 'access-revoked',
        })

        const confirmed = projectAccessReducer(verifying, {
            type: 'verification-succeeded',
            role: 'viewer',
        })
        expect(confirmed).toEqual({ status: 'confirmed', role: 'viewer', epoch: 1 })

        const stale = createProjectAccessState()
        expect(
            projectAccessReducer(stale, { type: 'verification-succeeded', role: 'editor' })
        ).toBe(stale)
        expect(projectAccessReducer(stale, { type: 'verification-denied' })).toBe(stale)
        expect(projectAccessReducer(stale, { type: 'verification-failed' })).toBe(stale)

        const technical = projectAccessReducer(verifying, { type: 'verification-failed' })
        expect(technical.status).toBe('technical-error')

        const cleared = projectAccessReducer(confirmed, { type: 'clear-role-override' })
        expect(cleared).toEqual({ status: 'confirmed', role: null, epoch: 1 })
        expect(projectAccessReducer(verifying, { type: 'clear-role-override' })).toBe(verifying)
    })

    test('never presents an expired session as a revocation', () => {
        // ApiError always carries a numeric status; plain shapes pin the mapping.
        expect(classifyMembershipVerificationError({ status: 401 })).toBe('verification-failed')
        expect(classifyMembershipVerificationError({ status: 403 })).toBe('verification-denied')
        expect(classifyMembershipVerificationError({ status: 404 })).toBe('verification-denied')
        expect(classifyMembershipVerificationError({ status: 500 })).toBe('verification-failed')
        expect(classifyMembershipVerificationError(new TypeError('fetch failed'))).toBe(
            'verification-failed'
        )
        expect(classifyMembershipVerificationError(null)).toBe('verification-failed')
    })

    test('adopts the server snapshot only for a clean working copy', () => {
        expect(
            decideConfirmedReconcile({
                hasLocalChanges: false,
                serverRevision: 2,
                expectedRevision: 1,
                serverSourceConflict: false,
            })
        ).toEqual({ kind: 'adopt-server' })
    })

    test('keeps a divergent draft on its reference revision and reports conflict', () => {
        expect(
            decideConfirmedReconcile({
                hasLocalChanges: true,
                serverRevision: 2,
                expectedRevision: 1,
                serverSourceConflict: false,
            })
        ).toEqual({ kind: 'keep-local', conflict: true })
        expect(
            decideConfirmedReconcile({
                hasLocalChanges: true,
                serverRevision: 1,
                expectedRevision: 1,
                serverSourceConflict: true,
            })
        ).toEqual({ kind: 'keep-local', conflict: true })
    })

    test('keeps a divergent draft without conflict when revisions agree', () => {
        expect(
            decideConfirmedReconcile({
                hasLocalChanges: true,
                serverRevision: 1,
                expectedRevision: 1,
                serverSourceConflict: false,
            })
        ).toEqual({ kind: 'keep-local', conflict: false })
    })
})
