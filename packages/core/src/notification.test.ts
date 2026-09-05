import { describe, expect, it } from 'bun:test'

import { createDomainEvent } from './domain-event'
import { DomainInvariantError } from './invariants'
import { createProjectNotification, projectNotificationTemplate } from './notification'

const occurredAt = 1_800_000_000_000

function event(name: string, version = 1, payload: Record<string, unknown> = {}) {
    return createDomainEvent({
        id: `event-${name}`,
        projectId: 'project-1',
        actorId: 'actor-1',
        name,
        version,
        subject: { type: 'publication', id: 'publication-1' },
        payload,
        occurredAt,
    })
}

describe('project notifications', () => {
    it('projects only supported publication outcomes', () => {
        expect(projectNotificationTemplate(event('publication.execution.succeeded'))?.kind).toBe(
            'publication_published'
        )
        expect(projectNotificationTemplate(event('publication.execution.failed'))?.kind).toBe(
            'publication_failed'
        )
        expect(projectNotificationTemplate(event('publication.execution.ambiguous'))?.kind).toBe(
            'publication_ambiguous'
        )
        expect(
            projectNotificationTemplate(
                event('publication.reconciled', 1, { toState: 'published' })
            )?.kind
        ).toBe('publication_published')
        expect(projectNotificationTemplate(event('publication.execution.claimed'))).toBeNull()
        expect(projectNotificationTemplate(event('publication.execution.succeeded', 2))).toBeNull()
    })

    it('rejects malformed notification lifecycle data', () => {
        const valid = {
            id: 'notification-1',
            projectId: 'project-1',
            recipientActorId: 'actor-1',
            sourceEventId: 'event-1',
            kind: 'publication_failed' as const,
            severity: 'error' as const,
            subject: { type: 'publication', id: 'publication-1' },
            title: 'Publication failed',
            body: 'The publication needs attention.',
            createdAt: occurredAt,
        }

        expect(createProjectNotification(valid)).toEqual({
            ...valid,
            readAt: null,
            archivedAt: null,
        })
        expect(() => createProjectNotification({ ...valid, readAt: occurredAt - 1 })).toThrow(
            DomainInvariantError
        )
    })
})
