import { expect, test } from 'bun:test'

import type { ChannelProfileDefinition } from '@postdot/core'

import { createAccessStore } from './access-store'
import { createEventJournalStore } from './event-journal-store'
import { createManualStore } from './manual-store'
import { createNotificationStore } from './notification-store'
import { closeTestDatabase, openTestDatabase } from './testing'

const profile: ChannelProfileDefinition = {
    id: 'inbox-provider',
    version: 1,
    profileHash: 'sha256:inbox-provider-v1',
    schemaHash: 'sha256:inbox-provider-schema-v1',
    origin: 'built_in',
    contentSchema: {
        type: 'object',
        properties: { body: { type: 'string', minLength: 1 } },
        required: ['body'],
        additionalProperties: false,
    },
    fieldBindings: [{ id: 'body', semantic: 'primary_text', path: '/body' }],
    capabilities: {
        revision: 'inbox-v1',
        textFields: [
            { bindingId: 'body', acceptedSourceFormats: ['plain_text'], maxLength: 1_000 },
        ],
        mediaFields: [],
        relations: [],
    },
    execution: { kind: 'built_in', contractId: 'inbox-provider', revision: 'v1' },
}

test('resolves only requested recipient contexts and gates retry by live state and role', async () => {
    const { database } = await openTestDatabase()
    try {
        const at = 1_800_000_000_000
        await database.sql
            .exec(`insert into "user" (id, name, email, email_verified, created_at, updated_at)
            values ('reader', 'Reader', 'reader@postdot.local', 0, 1, 1)`)
        const access = createAccessStore(database)
        await access.claimFirstAccount({ userId: 'reader' })
        const workspace = (await access.getDefaultWorkspace())!
        const manual = createManualStore(database, { now: () => at })
        const { project, actor } = await manual.createProject({
            workspaceId: workspace.id,
            name: 'Inbox',
            subjectId: 'reader',
            displayName: 'Reader',
        })
        await access.ensureProjectOwnerMembership({ projectId: project.id, userId: 'reader' })
        const channel = (await manual.createChannel({
            projectId: project.id,
            subjectId: 'reader',
            name: 'Release',
            profile,
        }))!
        await database.sql
            .statement(`insert into publishers (id, workspace_id, channel_id, kind)
            values ('inbox-publisher', ?1, ?2, 'inbox-provider')`)
            .run(workspace.id, channel.id)
        const created = (await manual.createPost({
            projectId: project.id,
            subjectId: 'reader',
            sourceContent: {
                body: { format: 'plain_text', text: 'Release notes https://postdot.local/notes' },
                media: [],
            },
            publications: [{ channelId: channel.id, deliveryMode: 'automatic', scheduledAt: at }],
        }))!
        const publication = created.publications[0]!
        await database.sql
            .statement(
                `update publications set state = 'failed', error_message = 'Delivery failed' where id = ?1`
            )
            .run(publication.id)
        await database.sql
            .statement(
                `update jobs set state = 'failed', error_message = 'Delivery failed', started_at = 1, completed_at = 1 where publication_id = ?1`
            )
            .run(publication.id)
        const notifications = createNotificationStore(database)
        await createEventJournalStore(database).append({
            id: 'failed-event',
            projectId: project.id,
            actorId: actor.id,
            name: 'publication.execution.failed',
            version: 1,
            subject: { type: 'publication', id: publication.id },
            occurredAt: at,
        })
        await notifications.project(project.id)
        const page = await notifications.listForUser({ userId: 'reader' })
        const id = page.items[0]!.id
        const read = async () => (await notifications.publicationContexts('reader', [id])).get(id)
        expect(await read()).toMatchObject({
            postId: created.post.id,
            postTitle: 'Release notes',
            canRetry: true,
        })
        expect((await notifications.publicationContexts('reader', [])).size).toBe(0)
        expect((await notifications.publicationContexts('reader', ['not-loaded'])).size).toBe(0)
        expect((await notifications.publicationContexts('other-recipient', [id])).size).toBe(0)
        await database.sql
            .statement(`update project_user_grants set role = 'viewer' where project_id = ?1`)
            .run(project.id)
        expect(await read()).toMatchObject({ canRetry: false })
        await database.sql
            .statement(`update project_user_grants set role = 'editor' where project_id = ?1`)
            .run(project.id)
        expect(await read()).toMatchObject({ canRetry: true })
        await database.sql
            .statement(
                `update jobs set state = 'pending', error_message = null, started_at = null, completed_at = null where publication_id = ?1`
            )
            .run(publication.id)
        expect(await read()).toMatchObject({ canRetry: false })
        await database.sql
            .statement(
                `update jobs set state = 'failed', error_message = 'Delivery failed', started_at = 1, completed_at = 1 where publication_id = ?1`
            )
            .run(publication.id)
        await database.sql
            .statement(`update publications set review_state = 'review_required' where id = ?1`)
            .run(publication.id)
        expect(await read()).toMatchObject({ canRetry: false })
        await database.sql
            .statement(
                `update publications set review_state = 'compatible', confirmed_destination_revision = confirmed_destination_revision + 1 where id = ?1`
            )
            .run(publication.id)
        expect(await read()).toMatchObject({ canRetry: false })
        await database.sql
            .statement(
                `update publications set confirmed_destination_revision = confirmed_destination_revision - 1 where id = ?1`
            )
            .run(publication.id)
        await database.sql
            .statement(
                `update channel_profile_versions set state = 'disabled' where channel_id = ?1`
            )
            .run(channel.id)
        expect(await read()).toMatchObject({ canRetry: false })
        await database.sql
            .statement(`delete from project_user_grants where project_id = ?1`)
            .run(project.id)
        expect(await read()).toBeUndefined()
    } finally {
        await closeTestDatabase(database)
    }
})
