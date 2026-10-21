import { expect, test } from 'bun:test'

import {
    validateDeclarativeHttpExecution,
    type DeclarativeHttpExecutionContract,
} from '@postdot/core'

import {
    compareMappedRequests,
    editMappedRequest,
    projectMappedRequest,
    type RequestEdit,
} from './channel-request-builder'

function fixture(bodyKind: 'json' | 'form' | 'multipart' = 'json') {
    const body =
        bodyKind === 'json'
            ? {
                  kind: 'json',
                  value: {
                      kind: 'object',
                      properties: {
                          text: { kind: 'content', pointer: '/body' },
                          items: {
                              kind: 'map',
                              source: { kind: 'content', pointer: '/media' },
                              maxItems: 4,
                              item: { kind: 'item', pointer: '/assetId' },
                          },
                      },
                  },
              }
            : bodyKind === 'form'
              ? { kind: 'form', fields: { text: { kind: 'content', pointer: '/body' } } }
              : {
                    kind: 'multipart',
                    fields: { text: { kind: 'content', pointer: '/body' } },
                    media: [{ fieldName: 'file', pointer: '/media' }],
                }
    return {
        id: 'custom-http',
        origin: 'custom',
        version: 2,
        contentSchema: { type: 'object', properties: { body: { type: 'string' } } },
        fieldBindings: [{ id: 'body', path: '/body', semantic: 'primary_text' }],
        capabilities: { textFields: [{ bindingId: 'body', maxGraphemes: 100 }] },
        execution: {
            kind: 'declarative_http',
            mode: 'mapped_http',
            contractId: 'custom-http',
            revision: '2',
            request: {
                method: 'POST',
                path: [
                    'posts',
                    { kind: 'secret' },
                    { kind: 'content', pointer: '/slug' },
                    { kind: 'context', pointer: '/publicationId' },
                ],
                query: { draft: { kind: 'literal', value: false } },
                headers: { 'X-Project': { kind: 'context', pointer: '/projectId' } },
                body,
                idempotencyHeader: 'Idempotency-Key',
                response: {
                    successStatuses: [201],
                    retryableStatuses: [429],
                    rejectedStatuses: [400],
                    ambiguousStatuses: [500],
                    externalIdPointer: '/id',
                    externalUrlPointer: '/url',
                },
            },
        },
    }
}

function apply(profile: unknown, edit: RequestEdit) {
    const result = editMappedRequest(profile, edit)
    if (!result.ok) throw new Error(result.reason)
    expect(
        validateDeclarativeHttpExecution(
            result.profile.execution as DeclarativeHttpExecutionContract
        )
    ).toEqual([])
    return result.profile
}

test('projects dynamic segments as locked rather than rendering expressions as editable strings', () => {
    const view = projectMappedRequest(fixture())!
    expect(view.segments.map(segment => segment.editable)).toEqual([true, false, false, false])
    for (const index of [1, 2, 3])
        expect(
            editMappedRequest(fixture(), { kind: 'segment', index, value: 'replacement' })
        ).toEqual({ ok: false, reason: 'dynamic' })
})

test('targeted edits preserve nested JSON, form and multipart mappings and all content rules', () => {
    for (const kind of ['json', 'form', 'multipart'] as const) {
        const original = fixture(kind)
        const snapshot = structuredClone(original)
        let result = apply(original, { kind: 'method', value: 'PATCH' })
        result = apply(result, { kind: 'segment', index: 0, value: 'articles' })
        result = apply(result, { kind: 'statuses', outcome: 'successStatuses', value: [200, 202] })
        const expected = structuredClone(original)
        expected.execution.request.method = 'PATCH'
        expected.execution.request.path[0] = 'articles'
        expected.execution.request.response.successStatuses = [200, 202]
        expect(result).toEqual(expected)
        expect(original).toEqual(snapshot)
    }
})

test('rejects path separators, traversal and invalid indices without mutating the profile', () => {
    for (const value of ['', '.', '..', 'a/b', 'a?b', 'a#b', 'a\\b', 'a\u0000b', 'a'.repeat(257)]) {
        expect(editMappedRequest(fixture(), { kind: 'segment', index: 0, value })).toEqual({
            ok: false,
            reason: 'invalid',
        })
    }
    for (const index of [-1, 1.5, 4])
        expect(editMappedRequest(fixture(), { kind: 'segment', index, value: 'ok' })).toEqual({
            ok: false,
            reason: 'invalid',
        })
})

test('response codes remain bounded, nonempty and disjoint across outcomes', () => {
    for (const value of [[], [99], [600], [200.5], Array.from({ length: 65 }, (_, i) => 200 + i)]) {
        expect(
            editMappedRequest(fixture(), { kind: 'statuses', outcome: 'successStatuses', value })
        ).toEqual({ ok: false, reason: 'invalid' })
    }
    for (const value of [[200, 200], [429]])
        expect(
            editMappedRequest(fixture(), { kind: 'statuses', outcome: 'successStatuses', value })
        ).toEqual({ ok: false, reason: 'overlap' })
})

test('does not convert manual, built-in or webhook contracts into mapped HTTP', () => {
    const source = fixture()
    for (const value of [
        null,
        {},
        { ...source, origin: 'built_in' },
        { ...source, execution: { kind: 'manual' } },
        { ...source, execution: { kind: 'declarative_http', mode: 'postbot_webhook' } },
        { ...source, execution: { kind: 'declarative_http', mode: 'mapped_http' } },
    ]) {
        expect(projectMappedRequest(value)).toBeNull()
        expect(editMappedRequest(value, { kind: 'method', value: 'PUT' })).toEqual({
            ok: false,
            reason: 'unsupported',
        })
    }
})

test('reassigns response codes atomically without losing extraction pointers', () => {
    const original = fixture()
    expect(
        editMappedRequest(original, { kind: 'statuses', outcome: 'successStatuses', value: [429] })
    ).toEqual({ ok: false, reason: 'overlap' })
    const result = apply(original, {
        kind: 'outcomes',
        value: {
            successStatuses: [429],
            retryableStatuses: [201],
            rejectedStatuses: [400],
            ambiguousStatuses: [500],
        },
    })
    const response = (result.execution as DeclarativeHttpExecutionContract).request!.response
    expect(response.successStatuses).toEqual([429])
    expect(response.retryableStatuses).toEqual([201])
    expect(response.externalIdPointer).toBe('/id')
    expect(response.externalUrlPointer).toBe('/url')
    expect(original.execution.request.response.successStatuses).toEqual([201])
})

test('parses code lists strictly instead of coercing ranges or expressions', async () => {
    const { parseRequestStatuses } = await import('./channel-request-builder')
    expect(parseRequestStatuses('200, 201 202')).toEqual([200, 201, 202])
    for (const value of ['', '20e1', '200-299', '99', '600', '200.0', '200, nope'])
        expect(parseRequestStatuses(value)).toBeNull()
})

test('compares method, static segments and response groups without exposing dynamic values', () => {
    const before = fixture()
    let after = apply(before, { kind: 'method', value: 'PATCH' })
    after = apply(after, { kind: 'segment', index: 0, value: 'articles' })
    after = apply(after, {
        kind: 'outcomes',
        value: {
            successStatuses: [200, 202],
            retryableStatuses: [503],
            rejectedStatuses: [400],
            ambiguousStatuses: [500],
        },
    })
    expect(compareMappedRequests(before, after)).toEqual([
        { key: 'method', before: 'POST', after: 'PATCH' },
        { key: 'segment-0', segmentIndex: 0, before: 'posts', after: 'articles' },
        { key: 'successStatuses', before: '201', after: '200, 202' },
        { key: 'retryableStatuses', before: '429', after: '503' },
    ])
    expect(JSON.stringify(compareMappedRequests(before, after))).not.toContain('/slug')
    expect(compareMappedRequests(before, before)).toEqual([])
})

test('comparison ignores code ordering and does not claim complete contract coverage', () => {
    const before = fixture()
    before.execution.request.response.successStatuses = [200, 201]
    const after = structuredClone(before)
    after.execution.request.response.successStatuses = [201, 200]
    after.execution.request.response.externalIdPointer = '/result/id'
    expect(compareMappedRequests(before, after)).toEqual([
        { key: 'externalIdPointer', before: '/id', after: '/result/id' },
    ])
    expect(compareMappedRequests(null, after)).toEqual([])
    expect(compareMappedRequests({ ...before, origin: 'built_in' }, after)).toEqual([])
})

test('response extraction edits add, change and remove pointers without losing mappings', () => {
    const before = fixture('multipart')
    let after = apply(before, { kind: 'extraction', field: 'externalIdPointer', value: '/data/id' })
    after = apply(after, { kind: 'extraction', field: 'externalUrlPointer', value: undefined })
    const expected = structuredClone(before) as Record<string, unknown>
    const response = (expected.execution as DeclarativeHttpExecutionContract).request!
        .response as unknown as Record<string, unknown>
    response.externalIdPointer = '/data/id'
    delete response.externalUrlPointer
    expect(after).toEqual(expected)
    expect(compareMappedRequests(before, after)).toEqual([
        { key: 'externalIdPointer', before: '/id', after: '/data/id' },
        { key: 'externalUrlPointer', before: '/url', after: null },
    ])
    after = apply(after, { kind: 'extraction', field: 'externalUrlPointer', value: '/data/link' })
    expect(compareMappedRequests(expected, after)).toEqual([
        { key: 'externalUrlPointer', before: null, after: '/data/link' },
    ])
    expect(before.execution.request.response.externalUrlPointer).toBe('/url')
})

test('pointer validation agrees with the domain, including escaped keys and empty-key tokens', () => {
    for (const value of [
        '/data/id',
        '/a~1b/~0key',
        '/',
        '/items/0/id',
        '',
        'id',
        '#/id',
        '/bad~',
        '/bad~2',
    ]) {
        const before = fixture()
        const execution = structuredClone(before.execution) as DeclarativeHttpExecutionContract
        const response = execution.request!.response as unknown as Record<string, unknown>
        response.externalIdPointer = value
        const valid = validateDeclarativeHttpExecution(execution).length === 0
        const result = editMappedRequest(before, {
            kind: 'extraction',
            field: 'externalIdPointer',
            value,
        })
        expect(result.ok).toBe(valid)
    }
})
