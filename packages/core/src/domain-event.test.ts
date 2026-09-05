import { describe, expect, it } from 'bun:test'

import { createDomainEvent } from './domain-event'
import { DomainInvariantError } from './invariants'

const validInput = {
    id: 'event-1',
    projectId: 'project-1',
    actorId: 'actor-1',
    name: 'publication.published',
    version: 1,
    subject: { type: 'publication', id: 'publication-1' },
    payload: { externalId: 'remote-1', media: [{ kind: 'image' }] },
    occurredAt: 1_800_000_000_000,
    correlationId: 'publication-1',
    causationId: 'job-1',
} as const

describe('domain events', () => {
    it('normalizes a versioned event envelope', () => {
        expect(createDomainEvent(validInput)).toEqual(validInput)
    })

    it('uses an empty payload and null context when they are omitted', () => {
        const {
            payload: _payload,
            correlationId: _correlationId,
            causationId: _causationId,
            ...input
        } = validInput

        const event = createDomainEvent(input)

        expect(event.payload).toEqual({})
        expect(event.correlationId).toBeNull()
        expect(event.causationId).toBeNull()
    })

    it.each([
        ['zero version', { ...validInput, version: 0 }],
        ['blank name', { ...validInput, name: '  ' }],
        ['invalid timestamp', { ...validInput, occurredAt: Number.NaN }],
        ['blank correlation', { ...validInput, correlationId: '  ' }],
        ['non-finite payload number', { ...validInput, payload: { attempts: Infinity } }],
        ['undefined payload field', { ...validInput, payload: { outcome: undefined } }],
        ['non-plain payload value', { ...validInput, payload: { occurredAt: new Date() } }],
    ])('rejects %s', (_label, input) => {
        expect(() => createDomainEvent(input)).toThrow(DomainInvariantError)
    })

    it('rejects cyclic payloads', () => {
        const payload: Record<string, unknown> = {}
        payload.self = payload

        expect(() => createDomainEvent({ ...validInput, payload })).toThrow(
            'must not contain cycles'
        )
    })

    it('rejects custom serialization, accessors, and sparse arrays', () => {
        const customSerialization: Record<string, unknown> = { message: 'safe' }
        Object.defineProperty(customSerialization, 'toJSON', {
            enumerable: false,
            value: () => ({ message: 'changed' }),
        })
        const accessor: Record<string, unknown> = {}
        Object.defineProperty(accessor, 'message', {
            enumerable: true,
            get: () => 'computed',
        })
        const sparseArray: unknown[] = []
        sparseArray.length = 1

        expect(() => createDomainEvent({ ...validInput, payload: customSerialization })).toThrow(
            DomainInvariantError
        )
        expect(() => createDomainEvent({ ...validInput, payload: accessor })).toThrow(
            DomainInvariantError
        )
        expect(() => createDomainEvent({ ...validInput, payload: { items: sparseArray } })).toThrow(
            DomainInvariantError
        )
    })
})
