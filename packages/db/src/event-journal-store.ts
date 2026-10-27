import {
    createDomainEvent,
    createWorkspaceDomainEvent,
    type WorkspaceDomainEvent,
    type CreateWorkspaceDomainEventInput,
    DomainInvariantError,
    requireNonBlank,
    type CreateDomainEventInput,
    type DomainEvent,
} from '@postdot/core'

import {
    createDatabaseTransaction,
    recordDatabaseCommitProject,
    type PostbotDatabase,
} from './client'

const cursorPrefix = 'event-sequence:'
const defaultReadLimit = 100
const maximumReadLimit = 500

export type EventJournalCursor = string & { readonly __eventJournalCursor: unique symbol }

export interface EventJournalEntry extends DomainEvent {
    readonly cursor: EventJournalCursor
}

export interface WorkspaceEventJournalEntry extends WorkspaceDomainEvent {
    readonly cursor: EventJournalCursor
}

export type JournalEntry = EventJournalEntry | WorkspaceEventJournalEntry
export type AppendWorkspaceDomainEventInput = Omit<CreateWorkspaceDomainEventInput, 'id'> & {
    readonly id?: string
}
export type ReadWorkspaceEventJournalInput = Omit<ReadEventJournalInput, 'projectId'> & {
    readonly workspaceId: string
}

export type AppendDomainEventInput = Omit<CreateDomainEventInput, 'id'> & {
    readonly id?: string
}

export interface ReadEventJournalInput {
    readonly projectId: string
    readonly after?: EventJournalCursor | null
    readonly limit?: number
}

export interface ReadAllEventJournalInput {
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
    readonly projectId: string | null
    readonly workspaceId: string | null
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
    database: PostbotDatabase,
    options: EventJournalStoreOptions = {}
) {
    const client = database.$client
    const createId = options.createId ?? (() => crypto.randomUUID())
    const appendStatement = client.query<
        void,
        [
            id: string,
            projectId: string | null,
            actorId: string,
            name: string,
            subjectType: string,
            subjectId: string,
            payloadJson: string,
            version: number,
            correlationId: string | null,
            causationId: string | null,
            occurredAt: number,
            workspaceId: string | null,
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
            created_at,
            workspace_id
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
    `)
    const readStatement = client.query<
        EventJournalRow,
        [projectId: string, afterSequence: number, limit: number]
    >(`
        select sequence as cursorSequence,
               id,
               project_id as projectId,
               workspace_id as workspaceId,
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
    const readWorkspaceStatement = client.query<
        EventJournalRow,
        [workspaceId: string, afterSequence: number, limit: number]
    >(`
        select sequence as cursorSequence,
               id,
               project_id as projectId,
               workspace_id as workspaceId,
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
        where workspace_id = ?1
          and sequence > ?2
        order by sequence
        limit ?3
    `)
    const readAllStatement = client.query<EventJournalRow, [afterSequence: number, limit: number]>(`
        select sequence as cursorSequence,
               id,
               project_id as projectId,
               workspace_id as workspaceId,
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
        where sequence > ?1
        order by sequence
        limit ?2
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
                    event.occurredAt,
                    null
                )

                return { ...event, cursor: encodeCursor(result.lastInsertRowid) }
            }

            return client.inTransaction
                ? appendCommitted()
                : createDatabaseTransaction(database, appendCommitted)()
        },

        appendWorkspace(input: AppendWorkspaceDomainEventInput): WorkspaceEventJournalEntry {
            const event = createWorkspaceDomainEvent({ ...input, id: input.id ?? createId() })
            const append = () => {
                const result = appendStatement.run(
                    event.id,
                    null,
                    event.actorId,
                    event.name,
                    event.subject.type,
                    event.subject.id,
                    JSON.stringify(event.payload),
                    event.version,
                    event.correlationId,
                    event.causationId,
                    event.occurredAt,
                    event.workspaceId
                )
                return { ...event, cursor: encodeCursor(result.lastInsertRowid) }
            }
            return client.inTransaction ? append() : createDatabaseTransaction(database, append)()
        },

        readWorkspaceAfter(
            input: ReadWorkspaceEventJournalInput
        ): readonly WorkspaceEventJournalEntry[] {
            const workspaceId = requireNonBlank(input.workspaceId, 'workspaceId')
            const limit = requireReadLimit(input.limit)
            return readWorkspaceStatement
                .all(workspaceId, decodeCursor(input.after), limit)
                .map(row => {
                    const event = toEventJournalEntry(row)
                    if (event.projectId !== null) throw new Error('Expected a workspace event')
                    return event
                })
        },

        readAfter(input: ReadEventJournalInput): readonly EventJournalEntry[] {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const afterSequence = decodeCursor(input.after)
            const limit = requireReadLimit(input.limit)

            return readStatement.all(projectId, afterSequence, limit).map(row => {
                const event = toEventJournalEntry(row)
                if (event.projectId === null) throw new Error('Expected a project event')
                return event
            })
        },

        readAllAfter(input: ReadAllEventJournalInput = {}): readonly JournalEntry[] {
            const afterSequence = decodeCursor(input.after)
            const limit = requireReadLimit(input.limit)

            return readAllStatement.all(afterSequence, limit).map(toEventJournalEntry)
        },

        latestCursor(): EventJournalCursor | null {
            const sequence = latestSequenceStatement.get()?.sequence ?? null
            return sequence === null || sequence < 1 ? null : encodeCursor(sequence)
        },
    }
}

function toEventJournalEntry(row: EventJournalRow): JournalEntry {
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

    const input = {
        id: row.id,
        actorId: row.actorId,
        name: row.name,
        version: row.version,
        subject: { type: row.subjectType, id: row.subjectId },
        payload: parsedPayload as Record<string, unknown>,
        occurredAt: row.occurredAt,
        correlationId: row.correlationId,
        causationId: row.causationId,
    }
    const cursor = encodeCursor(row.cursorSequence)
    if (row.projectId !== null)
        return { ...createDomainEvent({ ...input, projectId: row.projectId }), cursor }
    if (row.workspaceId === null) throw new Error('Journal event has no scope')
    return { ...createWorkspaceDomainEvent({ ...input, workspaceId: row.workspaceId }), cursor }
}

function requireReadLimit(value: number | undefined): number {
    const limit = value ?? defaultReadLimit
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumReadLimit) {
        throw new DomainInvariantError(
            'invalid_input',
            `event journal limit must be between 1 and ${maximumReadLimit}`
        )
    }
    return limit
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
