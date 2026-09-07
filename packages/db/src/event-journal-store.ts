import {
    createDomainEvent,
    DomainInvariantError,
    requireNonBlank,
    type CreateDomainEventInput,
    type DomainEvent,
} from '@herald/core'

import {
    createDatabaseTransaction,
    recordDatabaseCommitProject,
    type HeraldDatabase,
} from './client'

const cursorPrefix = 'event-sequence:'
const defaultReadLimit = 100
const maximumReadLimit = 500

export type EventJournalCursor = string & { readonly __eventJournalCursor: unique symbol }

export interface EventJournalEntry extends DomainEvent {
    readonly cursor: EventJournalCursor
}

export type AppendDomainEventInput = Omit<CreateDomainEventInput, 'id'> & {
    readonly id?: string
}

export interface ReadEventJournalInput {
    readonly projectId: string
    readonly after?: EventJournalCursor | null
    readonly limit?: number
}

export interface EventJournalStoreOptions {
    readonly createId?: () => string
}

export type EventJournalStore = ReturnType<typeof createEventJournalStore>

export function parseEventJournalCursor(value: string): EventJournalCursor {
    return encodeCursor(decodeCursor(value as EventJournalCursor))
}

export function eventJournalCursorSequence(cursor: EventJournalCursor): number {
    return decodeCursor(cursor)
}

interface EventJournalRow {
    readonly cursorSequence: number
    readonly id: string
    readonly projectId: string
    readonly actorId: string
    readonly name: string
    readonly version: number
    readonly subjectType: string
    readonly subjectId: string
    readonly payloadJson: string | null
    readonly occurredAt: number
    readonly correlationId: string | null
    readonly causationId: string | null
}

export function createEventJournalStore(
    database: HeraldDatabase,
    options: EventJournalStoreOptions = {}
) {
    const client = database.$client
    const createId = options.createId ?? (() => crypto.randomUUID())
    const appendStatement = client.query<
        void,
        [
            id: string,
            projectId: string,
            actorId: string,
            name: string,
            subjectType: string,
            subjectId: string,
            payloadJson: string,
            version: number,
            correlationId: string | null,
            causationId: string | null,
            occurredAt: number,
        ]
    >(`
        insert into audit_events (
            id,
            project_id,
            actor_id,
            action,
            entity_type,
            entity_id,
            metadata_json,
            event_version,
            correlation_id,
            causation_id,
            created_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
    `)
    const readStatement = client.query<
        EventJournalRow,
        [projectId: string, afterSequence: number, limit: number]
    >(`
        select sequence as cursorSequence,
               id,
               project_id as projectId,
               actor_id as actorId,
               action as name,
               event_version as version,
               entity_type as subjectType,
               entity_id as subjectId,
               metadata_json as payloadJson,
               created_at as occurredAt,
               correlation_id as correlationId,
               causation_id as causationId
        from audit_events
        where project_id = ?1
          and sequence > ?2
        order by sequence
        limit ?3
    `)
    const latestSequenceStatement = client.query<{ readonly sequence: number | null }, []>(`
        select seq as sequence
        from sqlite_sequence
        where name = 'audit_events'
    `)

    return {
        append(input: AppendDomainEventInput): EventJournalEntry {
            const event = createDomainEvent({ ...input, id: input.id ?? createId() })
            const appendCommitted = () => {
                recordDatabaseCommitProject(database, event.projectId)
                const result = appendStatement.run(
                    event.id,
                    event.projectId,
                    event.actorId,
                    event.name,
                    event.subject.type,
                    event.subject.id,
                    JSON.stringify(event.payload),
                    event.version,
                    event.correlationId,
                    event.causationId,
                    event.occurredAt
                )

                return { ...event, cursor: encodeCursor(result.lastInsertRowid) }
            }

            return client.inTransaction
                ? appendCommitted()
                : createDatabaseTransaction(database, appendCommitted)()
        },

        readAfter(input: ReadEventJournalInput): readonly EventJournalEntry[] {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const afterSequence = decodeCursor(input.after)
            const limit = input.limit ?? defaultReadLimit
            if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumReadLimit) {
                throw new DomainInvariantError(
                    'invalid_input',
                    `event journal limit must be between 1 and ${maximumReadLimit}`
                )
            }

            return readStatement
                .all(projectId, afterSequence, limit)
                .map(row => toEventJournalEntry(row))
        },

        latestCursor(): EventJournalCursor | null {
            const sequence = latestSequenceStatement.get()?.sequence ?? null
            return sequence === null ? null : encodeCursor(sequence)
        },
    }
}

function toEventJournalEntry(row: EventJournalRow): EventJournalEntry {
    const parsedPayload: unknown = row.payloadJson === null ? {} : JSON.parse(row.payloadJson)
    if (
        parsedPayload === null ||
        typeof parsedPayload !== 'object' ||
        Array.isArray(parsedPayload)
    ) {
        throw new DomainInvariantError(
            'invalid_content',
            `Stored domain event ${row.id} payload must be a JSON object`
        )
    }

    return {
        ...createDomainEvent({
            id: row.id,
            projectId: row.projectId,
            actorId: row.actorId,
            name: row.name,
            version: row.version,
            subject: { type: row.subjectType, id: row.subjectId },
            payload: parsedPayload as Record<string, unknown>,
            occurredAt: row.occurredAt,
            correlationId: row.correlationId,
            causationId: row.causationId,
        }),
        cursor: encodeCursor(row.cursorSequence),
    }
}

function encodeCursor(sequence: number | bigint): EventJournalCursor {
    const numericSequence = Number(sequence)
    if (!Number.isSafeInteger(numericSequence) || numericSequence < 1) {
        throw new DomainInvariantError(
            'invalid_input',
            'event journal cursor is outside safe range'
        )
    }
    return `${cursorPrefix}${numericSequence}` as EventJournalCursor
}

function decodeCursor(cursor: EventJournalCursor | null | undefined): number {
    if (cursor === null || cursor === undefined) return 0
    if (!cursor.startsWith(cursorPrefix)) {
        throw new DomainInvariantError('invalid_input', 'event journal cursor is invalid')
    }

    const sequence = Number(cursor.slice(cursorPrefix.length))
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
        throw new DomainInvariantError('invalid_input', 'event journal cursor is invalid')
    }
    return sequence
}
