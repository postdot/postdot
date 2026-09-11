import { describe, expect, test } from 'bun:test'

import {
    validateCustomHttpAuthenticationBinding,
    validateDeclarativeHttpExecution,
    type DeclarativeHttpPathSegment,
    type DeclarativeHttpExecutionContract,
} from './channel-transport'

const mappedExecution = (
    path: readonly DeclarativeHttpPathSegment[]
): DeclarativeHttpExecutionContract => ({
    kind: 'declarative_http',
    contractId: 'custom-path',
    revision: '1',
    mode: 'mapped_http',
    request: {
        method: 'POST',
        path,
        response: {
            successStatuses: [202],
            retryableStatuses: [429],
            rejectedStatuses: [400],
            ambiguousStatuses: [500],
        },
    },
})

describe('custom HTTP authentication binding', () => {
    test('accepts one secret path segment with path authentication', () => {
        const execution = mappedExecution(['hooks', { kind: 'secret' }, 'publish'])

        expect(validateDeclarativeHttpExecution(execution)).toEqual([])
        expect(validateCustomHttpAuthenticationBinding(execution, { kind: 'path' })).toEqual([])
    })

    test('requires path authentication to be backed by exactly one secret segment', () => {
        const execution = mappedExecution(['hooks'])

        expect(validateCustomHttpAuthenticationBinding(execution, { kind: 'path' })).toEqual([
            expect.objectContaining({
                code: 'mapping.secret_path_required',
                path: '/execution/request/path',
            }),
        ])
    })

    test('does not allow a secret segment through another authentication binding', () => {
        const execution = mappedExecution(['hooks', { kind: 'secret' }])

        expect(validateCustomHttpAuthenticationBinding(execution, { kind: 'bearer' })).toEqual([
            expect.objectContaining({
                code: 'mapping.secret_path_auth_required',
                path: '/execution/request/path',
            }),
        ])
    })

    test('rejects more than one secret segment structurally', () => {
        const execution = mappedExecution(['hooks', { kind: 'secret' }, { kind: 'secret' }])

        expect(validateDeclarativeHttpExecution(execution)).toEqual([
            expect.objectContaining({
                code: 'mapping.secret_path_limit',
                path: '/execution/request/path/2',
            }),
        ])
    })

    test('does not allow path authentication for the Herald webhook mode', () => {
        const execution: DeclarativeHttpExecutionContract = {
            kind: 'declarative_http',
            contractId: 'custom-webhook',
            revision: '1',
            mode: 'herald_webhook',
        }

        expect(validateCustomHttpAuthenticationBinding(execution, { kind: 'path' })).toEqual([
            expect.objectContaining({
                code: 'authentication.path_mode_invalid',
                path: '/authentication/kind',
            }),
            expect.objectContaining({
                code: 'mapping.secret_path_required',
                path: '/execution/request/path',
            }),
        ])
    })
})
