import { DomainInvariantError, requireNonBlank, requireTimestamp } from './invariants'

export type DomainEventJsonPrimitive = boolean | number | string | null
export type DomainEventJsonValue =
    | DomainEventJsonPrimitive
    | readonly DomainEventJsonValue[]
    | DomainEventJsonObject
export interface DomainEventJsonObject {
    readonly [key: string]: DomainEventJsonValue
}

export interface DomainEventSubject {
    readonly type: string
    readonly id: string
}

export interface DomainEvent {
    readonly id: string
    readonly projectId: string
    readonly actorId: string
    readonly name: string
    readonly version: number
    readonly subject: DomainEventSubject
    readonly payload: DomainEventJsonObject
    readonly occurredAt: number
    readonly correlationId: string | null
    readonly causationId: string | null
}

export interface CreateDomainEventInput {
    readonly id: string
    readonly projectId: string
    readonly actorId: string
    readonly name: string
    readonly version: number
    readonly subject: DomainEventSubject
    readonly payload?: Readonly<Record<string, unknown>>
    readonly occurredAt: number
    readonly correlationId?: string | null
    readonly causationId?: string | null
}

export function createDomainEvent(input: CreateDomainEventInput): DomainEvent {
    if (!Number.isSafeInteger(input.version) || input.version < 1) {
        throw new DomainInvariantError(
            'invalid_input',
            'domain event version must be a positive safe integer'
        )
    }

    const payload = input.payload ?? {}
    requireJsonObject(payload, 'domain event payload')

    return {
        id: requireNonBlank(input.id, 'domain event id'),
        projectId: requireNonBlank(input.projectId, 'domain event projectId'),
        actorId: requireNonBlank(input.actorId, 'domain event actorId'),
        name: requireNonBlank(input.name, 'domain event name'),
        version: input.version,
        subject: {
            type: requireNonBlank(input.subject.type, 'domain event subject type'),
            id: requireNonBlank(input.subject.id, 'domain event subject id'),
        },
        payload,
        occurredAt: requireTimestamp(input.occurredAt, 'domain event occurredAt'),
        correlationId: requireOptionalIdentifier(input.correlationId, 'correlationId'),
        causationId: requireOptionalIdentifier(input.causationId, 'causationId'),
    }
}

export function requireJsonObject(
    value: Readonly<Record<string, unknown>>,
    field: string
): asserts value is DomainEventJsonObject {
    if (Array.isArray(value)) throw invalidJson(field)
    validateJsonValue(value, field, new WeakSet())
}

function requireOptionalIdentifier(value: string | null | undefined, field: string): string | null {
    return value === null || value === undefined ? null : requireNonBlank(value, field)
}

function validateJsonValue(value: unknown, field: string, ancestors: WeakSet<object>): void {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return

    if (typeof value === 'number') {
        if (Number.isFinite(value)) return
        throw invalidJson(field)
    }

    if (typeof value !== 'object') throw invalidJson(field)
    if (ancestors.has(value)) {
        throw new DomainInvariantError('invalid_content', `${field} must not contain cycles`)
    }

    ancestors.add(value)
    if (Array.isArray(value)) {
        validateJsonArray(value, field, ancestors)
        ancestors.delete(value)
        return
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw invalidJson(field)

    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string') throw invalidJson(field)
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
            throw invalidJson(field)
        }
        validateJsonValue(descriptor.value, field, ancestors)
    }

    ancestors.delete(value)
}

function validateJsonArray(
    value: readonly unknown[],
    field: string,
    ancestors: WeakSet<object>
): void {
    const propertyNames = Object.getOwnPropertyNames(value)
    if (propertyNames.length !== value.length + 1 || !propertyNames.includes('length')) {
        throw invalidJson(field)
    }

    if (Object.getOwnPropertySymbols(value).length > 0) throw invalidJson(field)

    for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
            throw invalidJson(field)
        }
        validateJsonValue(descriptor.value, field, ancestors)
    }
}

function invalidJson(field: string): DomainInvariantError {
    return new DomainInvariantError('invalid_content', `${field} must contain only JSON values`)
}
