import { expect, test } from 'bun:test'

import {
    validateCustomHttpAuthenticationBinding,
    type DeclarativeHttpExecutionContract,
} from '@postbot/core'

import { customHttpAuthenticationKinds } from './custom-http-authentication'

const webhook: DeclarativeHttpExecutionContract = {
    kind: 'declarative_http',
    contractId: 'example',
    revision: '1',
    mode: 'postbot_webhook',
}
function mapped(secretCount: number): DeclarativeHttpExecutionContract {
    return {
        ...webhook,
        mode: 'mapped_http',
        request: {
            method: 'POST',
            path: [
                'posts',
                ...Array.from({ length: secretCount }, () => ({ kind: 'secret' as const })),
            ],
            response: {
                successStatuses: [200],
                retryableStatuses: [429],
                rejectedStatuses: [400],
                ambiguousStatuses: [500],
            },
        },
    }
}

test('connection choices agree with domain authentication binding for each contract', () => {
    for (const execution of [webhook, mapped(0), mapped(1)]) {
        const offered = customHttpAuthenticationKinds(execution)
        for (const kind of ['none', 'bearer', 'header', 'path'] as const) {
            const authentication = kind === 'header' ? { kind, headerName: 'X-Api-Key' } : { kind }
            expect(offered.includes(kind)).toBe(
                validateCustomHttpAuthenticationBinding(execution, authentication).length === 0
            )
        }
    }
    expect(customHttpAuthenticationKinds(webhook)).not.toContain('path')
    expect(customHttpAuthenticationKinds(mapped(1))).toEqual(['path'])
})

test('incomplete or invalid contracts do not enable submission choices', () => {
    for (const execution of [
        null,
        {},
        { kind: 'manual' },
        { kind: 'built_in' },
        mapped(2),
        { kind: 'declarative_http', mode: 'mapped_http' },
    ]) {
        expect(customHttpAuthenticationKinds(execution)).toEqual([])
    }
})
