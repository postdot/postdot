import { expect, test } from 'bun:test'

import {
    createManualChannelProfile,
    validateDeclarativeHttpExecution,
    type DeclarativeHttpExecutionContract,
} from '@postbot/core'

import {
    compareJsonBodyProperties,
    editJsonBodyProperty,
    projectJsonBody,
} from './channel-json-body-builder'

function fixture() {
    return {
        ...createManualChannelProfile(),
        origin: 'custom',
        execution: {
            kind: 'declarative_http',
            mode: 'mapped_http',
            contractId: 'json-body',
            revision: '1',
            request: {
                method: 'POST',
                path: ['posts', { kind: 'secret' }],
                headers: { 'X-Source': { kind: 'literal', value: 'Postbot' } },
                body: {
                    kind: 'json',
                    value: {
                        kind: 'object',
                        properties: {
                            message: { kind: 'content', pointer: '/body' },
                            caption: { kind: 'literal', value: 'Hello' },
                            priority: { kind: 'literal', value: 1 },
                            published: { kind: 'literal', value: false },
                            optional: { kind: 'literal', value: null },
                            nested: {
                                kind: 'object',
                                properties: { key: { kind: 'literal', value: 'keep' } },
                            },
                            list: {
                                kind: 'map',
                                source: { kind: 'content', pointer: '/media' },
                                maxItems: 2,
                                item: { kind: 'item', pointer: '/assetId' },
                            },
                        },
                    },
                },
                response: {
                    successStatuses: [201],
                    retryableStatuses: [429],
                    rejectedStatuses: [400],
                    ambiguousStatuses: [500],
                    externalIdPointer: '/id',
                },
            },
        },
    }
}

test('projects only simple existing leaves and locks nested expressions', () => {
    expect(
        projectJsonBody(fixture())?.map(row => [row.name, row.expression?.kind ?? null])
    ).toEqual([
        ['message', 'content'],
        ['caption', 'literal'],
        ['priority', 'literal'],
        ['published', 'literal'],
        ['optional', 'literal'],
        ['nested', null],
        ['list', null],
    ])
})

test('simple edits preserve all other profile and request fields and validate with the domain', () => {
    const before = fixture()
    const snapshot = structuredClone(before)
    let after: unknown = editJsonBodyProperty(before, 'caption', { kind: 'literal', value: '' })
    after = editJsonBodyProperty(after, 'priority', { kind: 'literal', value: 2.5 })
    after = editJsonBodyProperty(after, 'published', { kind: 'literal', value: true })
    after = editJsonBodyProperty(after, 'message', { kind: 'content', pointer: '/headline' })
    expect(after).not.toBeNull()
    const execution = (after as typeof before).execution as DeclarativeHttpExecutionContract
    expect(validateDeclarativeHttpExecution(execution)).toEqual([])
    const expected = structuredClone(before)
    expected.execution.request.body.value.properties.caption.value = ''
    expected.execution.request.body.value.properties.priority.value = 2.5
    expected.execution.request.body.value.properties.published.value = true
    expected.execution.request.body.value.properties.message.pointer = '/headline'
    expect(after).toEqual(expected)
    expect(before).toEqual(snapshot)
    expect(compareJsonBodyProperties(before, after).map(change => change.name)).toEqual([
        'message',
        'caption',
        'priority',
        'published',
    ])
})

test('rejects type changes, unknown properties, unbound references and nested replacement', () => {
    const before = fixture()
    expect(editJsonBodyProperty(before, 'priority', { kind: 'literal', value: '2' })).toBeNull()
    expect(
        editJsonBodyProperty(before, 'priority', { kind: 'literal', value: Infinity })
    ).toBeNull()
    expect(
        editJsonBodyProperty(before, 'message', { kind: 'content', pointer: '/missing' })
    ).toBeNull()
    expect(
        editJsonBodyProperty(before, 'message', { kind: 'literal', value: 'replacement' })
    ).toBeNull()
    for (const name of ['missing', 'nested', 'list', '__proto__'])
        expect(
            editJsonBodyProperty(before, name, { kind: 'literal', value: 'replacement' })
        ).toBeNull()
})

test('unsupported body formats, root expressions and provider contracts are not converted', () => {
    const before = fixture()
    for (const profile of [
        null,
        { ...before, origin: 'built_in' },
        { ...before, execution: { kind: 'manual' } },
        {
            ...before,
            execution: {
                ...before.execution,
                request: { ...before.execution.request, body: { kind: 'form', fields: {} } },
            },
        },
        {
            ...before,
            execution: {
                ...before.execution,
                request: {
                    ...before.execution.request,
                    body: { kind: 'json', value: { kind: 'content', pointer: '/body' } },
                },
            },
        },
    ]) {
        expect(projectJsonBody(profile)).toBeNull()
        expect(
            editJsonBodyProperty(profile, 'caption', { kind: 'literal', value: 'new' })
        ).toBeNull()
        expect(compareJsonBodyProperties(before, profile)).toEqual([])
    }
    expect(compareJsonBodyProperties(before, before)).toEqual([])
})
