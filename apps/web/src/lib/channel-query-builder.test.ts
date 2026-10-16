import { expect, test } from 'bun:test'

import {
    createManualChannelProfile,
    validateDeclarativeHttpExecution,
    type DeclarativeHttpExecutionContract,
} from '@postbot/core'

import { compareQuery, editQuery, projectQuery } from './channel-query-builder'

function fixture() {
    return {
        ...createManualChannelProfile(),
        origin: 'custom',
        execution: {
            kind: 'declarative_http',
            mode: 'mapped_http',
            contractId: 'query',
            revision: '1',
            request: {
                method: 'POST',
                path: ['posts', { kind: 'secret' }],
                query: {
                    format: { kind: 'literal', value: 'compact', extension: 'preserve' },
                    delivery: { kind: 'context', pointer: '/deliveryId' },
                    limit: { kind: 'literal', value: 10 },
                },
                headers: { 'X-Source': { kind: 'literal', value: 'Postbot' } },
                response: {
                    successStatuses: [201],
                    retryableStatuses: [429],
                    rejectedStatuses: [400],
                    ambiguousStatuses: [500],
                },
            },
        },
    }
}

test('projects fixed text and protects dynamic and other literal types', () => {
    expect(projectQuery(fixture())).toEqual([
        { name: 'format', value: 'compact' },
        { name: 'delivery', value: null },
        { name: 'limit', value: null },
    ])
    for (const name of ['delivery', 'limit', 'missing']) {
        expect(editQuery(fixture(), name, 'edit', 'changed')).toBeNull()
        expect(editQuery(fixture(), name, 'remove')).toBeNull()
    }
})

test('query edits preserve the profile and produce domain-valid requests with readable changes', () => {
    const before = fixture()
    const snapshot = structuredClone(before)
    let after = editQuery(before, 'format', 'edit', '')
    after = editQuery(after, 'language', 'add', 'fr & en=both')
    expect(after).toEqual({
        ...before,
        execution: {
            ...before.execution,
            request: {
                ...before.execution.request,
                query: {
                    ...before.execution.request.query,
                    format: { kind: 'literal', value: '', extension: 'preserve' },
                    language: { kind: 'literal', value: 'fr & en=both' },
                },
            },
        },
    })
    expect(before).toEqual(snapshot)
    expect(
        validateDeclarativeHttpExecution(
            (after as typeof before).execution as DeclarativeHttpExecutionContract
        )
    ).toEqual([])
    expect(compareQuery(before, after)).toEqual([
        { name: 'format', before: 'compact', after: '' },
        { name: 'language', before: undefined, after: 'fr & en=both' },
    ])
    after = editQuery(after, 'language', 'remove')
    after = editQuery(after, 'format', 'remove')
    expect(compareQuery(before, after)).toEqual([
        { name: 'format', before: 'compact', after: undefined },
    ])
})

test('adds absent maps and rejects invalid names, duplicates and full maps without prototype changes', () => {
    const before = fixture()
    Reflect.deleteProperty(before.execution.request, 'query')
    expect(projectQuery(before)).toEqual([])
    const after = editQuery(before, '__proto__', 'add', 'safe')
    expect(projectQuery(after)).toEqual([{ name: '__proto__', value: 'safe' }])
    expect(Object.getPrototypeOf((after as typeof before).execution.request.query)).toBe(
        Object.prototype
    )
    expect(compareQuery(before, after)).toEqual([
        { name: '__proto__', before: undefined, after: 'safe' },
    ])
    for (const name of [
        '',
        ' x',
        'x ',
        'a\nb',
        'a\rb',
        'a\u0000b',
        'x'.repeat(129),
        'format',
        'delivery',
    ])
        expect(editQuery(fixture(), name, 'add')).toBeNull()
    const full = fixture()
    Object.assign(full.execution.request, {
        query: Object.fromEntries(
            Array.from({ length: 64 }, (_, i) => [`key${i}`, { kind: 'literal', value: '' }])
        ),
    })
    expect(editQuery(full, 'extra', 'add')).toBeNull()
})

test('unsupported profiles and maps stay untouched and comparisons do not expose expressions', () => {
    for (const profile of [
        null,
        {},
        createManualChannelProfile(),
        { ...fixture(), origin: 'builtin' },
    ]) {
        expect(projectQuery(profile)).toBeNull()
        expect(editQuery(profile, 'format', 'edit', 'new')).toBeNull()
    }
    for (const query of [null, [], 'invalid']) {
        const profile = fixture()
        Object.assign(profile.execution.request, { query })
        expect(projectQuery(profile)).toBeNull()
        expect(editQuery(profile, 'new', 'add')).toBeNull()
        expect(compareQuery(profile, fixture())).toEqual([])
    }
    const changed = fixture()
    changed.execution.request.query.delivery.pointer = '/projectId'
    expect(compareQuery(fixture(), changed)).toEqual([])
})
