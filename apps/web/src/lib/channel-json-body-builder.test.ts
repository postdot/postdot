import { expect, test } from 'bun:test'

import {
    createManualChannelProfile,
    validateDeclarativeHttpExecution,
    type DeclarativeHttpExecutionContract,
} from '@postdot/core'

import {
    canCreateJsonBody,
    createJsonBody,
    isJsonBodyCreated,
    compareJsonBodyProperties,
    changeJsonBodyProperty,
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
                headers: { 'X-Source': { kind: 'literal', value: 'Postdot' } },
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

test('adds and removes simple properties with explicit absence in comparison', () => {
    const before = fixture()
    const added = changeJsonBodyProperty(before, 'campaign', 'add', {
        kind: 'literal',
        value: 'Launch',
    })!
    expect(added).not.toBeNull()
    expect(
        validateDeclarativeHttpExecution(added.execution as DeclarativeHttpExecutionContract)
    ).toEqual([])
    expect(compareJsonBodyProperties(before, added)).toEqual([
        { name: 'campaign', before: undefined, after: { kind: 'literal', value: 'Launch' } },
    ])
    const removed = changeJsonBodyProperty(added, 'caption', 'remove')!
    expect(compareJsonBodyProperties(added, removed)).toEqual([
        { name: 'caption', before: { kind: 'literal', value: 'Hello' }, after: undefined },
    ])
    expect(changeJsonBodyProperty(before, 'nested', 'remove')).toBeNull()
    expect(
        changeJsonBodyProperty(before, 'list', 'replace', { kind: 'literal', value: '' })
    ).toBeNull()
    expect(before.execution.request.body.value.properties.caption.value).toBe('Hello')
})

test('explicit source changes remove incompatible expression fields and preserve everything else', () => {
    const before = fixture()
    const changed = changeJsonBodyProperty(before, 'caption', 'replace', {
        kind: 'content',
        pointer: '/body',
    })!
    const expected = structuredClone(before) as unknown as Record<string, unknown>
    const execution = expected.execution as DeclarativeHttpExecutionContract
    const properties = (
        execution.request!.body as { value: { properties: Record<string, unknown> } }
    ).value.properties
    properties.caption = { kind: 'content', pointer: '/body' }
    expect(changed).toEqual(expected)
    const fixed = changeJsonBodyProperty(changed, 'caption', 'replace', {
        kind: 'literal',
        value: 0,
    })!
    const row = projectJsonBody(fixed)!.find(item => item.name === 'caption')!
    expect(row.expression).toEqual({ kind: 'literal', value: 0 })
    expect(
        validateDeclarativeHttpExecution(fixed.execution as DeclarativeHttpExecutionContract)
    ).toEqual([])
})

test('enforces property names, uniqueness, limits and safe own-key handling', () => {
    const before = fixture()
    for (const name of [
        '',
        ' caption',
        'caption ',
        'a\nb',
        'a\rb',
        'a\u0000b',
        'a'.repeat(129),
        'caption',
        'nested',
    ]) {
        expect(
            changeJsonBodyProperty(before, name, 'add', { kind: 'literal', value: '' })
        ).toBeNull()
    }
    expect(
        changeJsonBodyProperty(before, 'message', 'replace', {
            kind: 'content',
            pointer: '/missing',
        })
    ).toBeNull()
    const safe = changeJsonBodyProperty(before, '__proto__', 'add', {
        kind: 'literal',
        value: 'safe',
    })!
    expect(projectJsonBody(safe)!.find(item => item.name === '__proto__')?.expression).toEqual({
        kind: 'literal',
        value: 'safe',
    })
    expect(Object.getPrototypeOf(safe)).toBe(Object.prototype)
    expect(
        validateDeclarativeHttpExecution(safe.execution as DeclarativeHttpExecutionContract)
    ).toEqual([])
    const full = fixture()
    const properties = full.execution.request.body.value.properties as unknown as Record<
        string,
        unknown
    >
    for (let index = Object.keys(properties).length; index < 64; index++)
        properties[`field${index}`] = { kind: 'literal', value: '' }
    expect(
        changeJsonBodyProperty(full, 'overflow', 'add', { kind: 'literal', value: '' })
    ).toBeNull()
})

function withoutBody() {
    const profile = fixture()
    Reflect.deleteProperty(profile.execution.request, 'body')
    return profile
}

test('explicit body creation preserves the request and produces a valid empty JSON object', () => {
    const before = withoutBody()
    const snapshot = structuredClone(before)
    expect(canCreateJsonBody(before)).toBe(true)
    const after = createJsonBody(before)
    expect(after).toEqual({
        ...before,
        execution: {
            ...before.execution,
            request: {
                ...before.execution.request,
                body: { kind: 'json', value: { kind: 'object', properties: {} } },
            },
        },
    })
    expect(before).toEqual(snapshot)
    expect(projectJsonBody(after)).toEqual([])
    expect(
        validateDeclarativeHttpExecution(
            (after as typeof before).execution as DeclarativeHttpExecutionContract
        )
    ).toEqual([])
    expect(createJsonBody(after)).toBeNull()
    expect(isJsonBodyCreated(before, after)).toBe(true)
    expect(compareJsonBodyProperties(before, after)).toEqual([])
    const populated = changeJsonBodyProperty(after, 'message', 'add', {
        kind: 'content',
        pointer: '/body',
    })
    expect(compareJsonBodyProperties(before, populated)).toEqual([
        { name: 'message', before: undefined, after: { kind: 'content', pointer: '/body' } },
    ])
})

test('body creation never converts a defined body or edits a non-mapped profile', () => {
    for (const body of [
        undefined,
        null,
        {},
        { kind: 'form' },
        { kind: 'multipart' },
        { kind: 'json', value: { kind: 'content', pointer: '/body' } },
        fixture().execution.request.body,
    ]) {
        const profile = withoutBody()
        Object.defineProperty(profile.execution.request, 'body', { value: body, enumerable: true })
        expect(canCreateJsonBody(profile)).toBe(false)
        expect(createJsonBody(profile)).toBeNull()
        expect(isJsonBodyCreated(profile, fixture())).toBe(false)
        if (!projectJsonBody(profile))
            expect(compareJsonBodyProperties(profile, fixture())).toEqual([])
    }
    for (const profile of [
        null,
        {},
        createManualChannelProfile(),
        { ...withoutBody(), origin: 'builtin' },
    ]) {
        expect(createJsonBody(profile)).toBeNull()
    }
})
