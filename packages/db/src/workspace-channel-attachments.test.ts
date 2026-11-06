import { expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
    createManualChannelProfile,
    fingerprintChannelProfile,
    type ChannelProfileDefinition,
} from '@postdot/core'

import { closeDatabase, createDatabase, type PostdotDatabase } from './client'
import { createManualStore } from './manual-store'
import { runMigrations } from './migrations'
import { createPublisherCredentialCipher } from './publisher-credential-crypto'
import { createPublisherCredentialStore } from './publisher-credential-store'
import { createPublisherStore } from './publisher-store'

function workspace(db: PostdotDatabase, id: string) {
    db.$client
        .query('insert into organization (id,name,slug,created_at) values (?,?,?,100)')
        .run(id, id, id)
    db.$client
        .query(
            'insert into workspaces (id,organization_id,name,slug,created_at,updated_at) values (?,?,?,?,100,100)'
        )
        .run(id, id, id, id)
}

async function fixture(filename = ':memory:') {
    const database = createDatabase(filename)
    await runMigrations(database)
    workspace(database, 'workspace')
    const manual = createManualStore(database)
    const cipher = createPublisherCredentialCipher({
        keyId: 'test',
        key: new Uint8Array(32).fill(1),
    })
    const credentials = createPublisherCredentialStore(database, { cipher })
    const publishers = createPublisherStore(database, {
        credentialRevoker: credentials,
        connectionPolicies: {
            fixture: {
                defaultDestination: row => ({
                    type: 'account',
                    id: row.externalAccountId,
                    name: null,
                }),
                validateDestination: () => true,
            },
        },
    })
    const records = []
    for (const id of ['first', 'second']) {
        const project = await manual.createProject({
            name: id,
            subjectId: id,
            displayName: id,
            workspaceId: 'workspace',
        })
        const channel = (await manual.createChannel({
            projectId: project.project.id,
            subjectId: id,
            name: id,
            profile: {
                ...createManualChannelProfile(),
                id: 'fixture',
                execution: { kind: 'built_in', contractId: 'fixture', revision: 'v1' },
            },
        }))!
        const credential = await credentials.createPublisherCredential({
            projectId: project.project.id,
            connectedByActorId: project.actor.id,
            providerId: 'fixture',
            externalAccountId: 'same-account',
            accessToken: `synthetic-${id}`,
            refreshToken: `refresh-${id}`,
            providerSession: `session-${id}`,
        })
        if (credential.kind !== 'created') throw new Error('Missing credential')
        const connection = await publishers.createPublisherConnection({
            projectId: project.project.id,
            channelId: channel.id,
            subjectId: id,
            kind: 'fixture',
            credentialId: credential.credential.id,
        })
        if (connection.kind !== 'created') throw new Error('Missing connection')
        const post = (await manual.createPost({
            projectId: project.project.id,
            subjectId: id,
            sourceContent: { body: { format: 'plain_text', text: id }, media: [] },
            publications: [
                {
                    channelId: channel.id,
                    deliveryMode: 'automatic',
                    scheduledAt: Date.now() + 60000,
                },
            ],
        }))!
        records.push({
            project,
            channel,
            credential: credential.credential,
            connection: connection.connection,
            post,
        })
    }
    return { database, manual, cipher, records, credentials, publishers }
}

it('enforces attachment/workspace relations while retaining a shared resource after origin-project deletion', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'postdot-channel-conversion-'))
    const filename = join(directory, 'instance.sqlite')
    const f = await fixture(filename)
    try {
        const [first, second] = f.records
        if (!first || !second) throw new Error('Missing projects')
        workspace(f.database, 'foreign')
        const foreign = await f.manual.createProject({
            name: 'Foreign',
            subjectId: 'foreign',
            displayName: 'Foreign',
            workspaceId: 'foreign',
        })
        const unrelated = await f.manual.createProject({
            name: 'Unrelated',
            subjectId: 'unrelated',
            displayName: 'Unrelated',
            workspaceId: 'workspace',
        })
        closeDatabase(f.database)
        f.database = createDatabase(filename)
        const actor = f.database.$client
            .query<{ id: string }, [string]>(
                "select id from actors where workspace_id='workspace' and origin_actor_id=?"
            )
            .get(second.project.actor.id)!
        const attach = f.database.$client.query(
            "insert into project_channel_attachments(project_id,channel_id,workspace_id,origin,attached_by_actor_id,attached_at) values (?,?,?,'explicit',?,200)"
        )
        expect(() =>
            attach.run(foreign.project.id, first.channel.id, 'foreign', actor.id)
        ).toThrow()
        expect(
            f.database.$client
                .query(
                    'select id from project_publisher_credential_contexts where project_id=? and id=?'
                )
                .all(second.project.project.id, first.credential.id)
        ).toEqual([])
        attach.run(second.project.project.id, first.channel.id, 'workspace', actor.id)
        expect(
            f.database.$client
                .query('select id from project_channel_contexts where project_id=? and id=?')
                .get(second.project.project.id, first.channel.id)
        ).toEqual({ id: first.channel.id })
        expect(
            f.database.$client
                .query(
                    'select id from project_publisher_connection_contexts where project_id=? and id=?'
                )
                .get(second.project.project.id, first.connection.id)
        ).toEqual({ id: first.connection.id })
        expect(
            f.database.$client
                .query(
                    'select id from project_publisher_credential_contexts where project_id=? and id=?'
                )
                .get(second.project.project.id, first.credential.id)
        ).toEqual({ id: first.credential.id })
        expect(
            f.database.$client
                .query('select id from project_publisher_credential_contexts where project_id=?')
                .all(unrelated.project.id)
        ).toEqual([])
        expect(
            f.database.$client
                .query('select id from project_publisher_credential_contexts where project_id=?')
                .all(foreign.project.id)
        ).toEqual([])
        expect(
            f.database.$client
                .query(
                    'select profile_id from project_channel_profiles where project_id=? and channel_id=?'
                )
                .all(second.project.project.id, first.channel.id)
        ).toEqual([{ profile_id: first.channel.profileVersionId }])
        const clone = f.database.$client.query(`insert into publications
            (id,project_id,post_id,channel_id,delivery_mode,review_state,state,created_by_actor_id,state_changed_by_actor_id)
            values ('shared-publication',?,?,?,'manual','compatible','draft',?,?)`)
        expect(() =>
            clone.run(
                second.project.project.id,
                first.post.post.id,
                first.channel.id,
                second.project.actor.id,
                second.project.actor.id
            )
        ).toThrow()
        clone.run(
            second.project.project.id,
            second.post.post.id,
            first.channel.id,
            second.project.actor.id,
            second.project.actor.id
        )
        f.database.$client.query('delete from projects where id=?').run(first.project.project.id)
        expect(
            f.database.$client.query('select id from channels where id=?').get(first.channel.id)
        ).toEqual({ id: first.channel.id })
        expect(
            f.database.$client
                .query('select id from publisher_credentials where id=?')
                .get(first.credential.id)
        ).toEqual({ id: first.credential.id })
        expect(
            f.database.$client
                .query("select channel_id from publications where id='shared-publication'")
                .get()
        ).toEqual({ channel_id: first.channel.id })
        expect(
            f.database.$client
                .query('select project_id from channel_managers where channel_id=?')
                .all(first.channel.id)
        ).toEqual([])
        expect(
            f.database.$client
                .query('select project_id from project_channel_attachments where channel_id=?')
                .all(first.channel.id)
        ).toEqual([{ project_id: second.project.project.id }])
        expect(f.database.$client.query('pragma foreign_key_check').all()).toEqual([])
        expect(
            f.database.$client
                .query(
                    'select id from project_publisher_connection_contexts where project_id=? and id=?'
                )
                .get(second.project.project.id, first.connection.id)
        ).toEqual({ id: first.connection.id })
        f.database.$client
            .query(
                "update project_channel_attachments set state='detached',detached_at=300,revision=revision+1 where project_id=? and channel_id=?"
            )
            .run(second.project.project.id, first.channel.id)
        expect(
            f.database.$client
                .query("select id from publications where id='shared-publication'")
                .get()
        ).toEqual({ id: 'shared-publication' })
        expect(f.database.$client.query('pragma foreign_key_check').all()).toEqual([])
    } finally {
        closeDatabase(f.database)
        rmSync(directory, { recursive: true, force: true })
    }
})

it('blocks new effects after detach while allowing an admitted effect to finalize', async () => {
    const f = await fixture()
    try {
        for (const [index, record] of f.records.entries()) {
            const publication = record.post.publications[0]!
            f.database.$client
                .query(`insert into publication_comment_replies
                (id,project_id,publication_id,actor_id,root_uri,parent_uri,text,connection_id,credential_id,account_id,record_key,state,claim_token,lease_expires_at,created_at,updated_at)
                values (?,?,?,?, 'synthetic-root','synthetic-parent','Reply',?,?, 'synthetic-account',?,'running','proof',2000,1000,1000)`)
                .run(
                    `reply-${index}`,
                    record.project.project.id,
                    publication.id,
                    record.project.actor.id,
                    record.connection.id,
                    record.credential.id,
                    `reply-${index}`
                )
            f.database.$client
                .query(`insert into publication_first_comments
                (id,project_id,publication_id,actor_id,text,delay_seconds,due_at,root_uri,execution_revision_id,connection_id,credential_id,account_id,record_key,state,claim_token,lease_expires_at,created_at,updated_at)
                values (?,?,?,?,'First',0,1000,'synthetic-root','synthetic-execution',?,?,'synthetic-account',?,'running','proof',2000,1000,1000)`)
                .run(
                    `comment-${index}`,
                    record.project.project.id,
                    publication.id,
                    record.project.actor.id,
                    record.connection.id,
                    record.credential.id,
                    `comment-${index}`
                )
            f.database.$client
                .query(
                    `update jobs set state='running',claim_token='proof',claimed_by_actor_id=?,claimed_at=1000,lease_expires_at=2000,started_at=1000,attempts=1 where project_id=?`
                )
                .run(`system:${record.project.project.id}`, record.project.project.id)
            if (index === 1)
                expect(
                    f.database.$client
                        .query('update jobs set effect_started_at=1001 where project_id=?')
                        .run(record.project.project.id).changes
                ).toBe(1)
            if (index === 1)
                for (const table of ['publication_comment_replies', 'publication_first_comments'])
                    expect(
                        f.database.$client
                            .query(`update ${table} set effect_started_at=1001 where project_id=?`)
                            .run(record.project.project.id).changes
                    ).toBe(1)
            f.database.$client
                .query(
                    "update project_channel_attachments set state='detached',detached_at=1002,revision=revision+1 where project_id=?"
                )
                .run(record.project.project.id)
            if (index === 0)
                expect(
                    f.database.$client
                        .query('update jobs set effect_started_at=1003 where project_id=?')
                        .run(record.project.project.id).changes
                ).toBe(0)
            else
                expect(
                    f.database.$client
                        .query(
                            "update jobs set state='succeeded',claim_token=NULL,lease_expires_at=NULL,completed_at=1004 where project_id=?"
                        )
                        .run(record.project.project.id).changes
                ).toBe(1)
            for (const table of ['publication_comment_replies', 'publication_first_comments']) {
                if (index === 0)
                    expect(
                        f.database.$client
                            .query(`update ${table} set effect_started_at=1003 where project_id=?`)
                            .run(record.project.project.id).changes
                    ).toBe(0)
                else
                    expect(
                        f.database.$client
                            .query(
                                `update ${table} set state='sent',claim_token=NULL,lease_expires_at=NULL,external_id='synthetic-receipt',updated_at=1004 where project_id=?`
                            )
                            .run(record.project.project.id).changes
                    ).toBe(1)
            }
            expect(() =>
                f.database.$client
                    .query(
                        `insert into publications (id,project_id,post_id,channel_id,delivery_mode,review_state,state,created_by_actor_id,state_changed_by_actor_id) values (?,?,?,?,'manual','compatible','draft',?,?)`
                    )
                    .run(
                        `blocked-${index}`,
                        record.project.project.id,
                        record.post.post.id,
                        record.channel.id,
                        record.project.actor.id,
                        record.project.actor.id
                    )
            ).toThrow('channel_detached')
            expect(
                f.database.$client
                    .query('select project_id from channel_managers where channel_id=?')
                    .all(record.channel.id)
            ).toEqual([])
        }
        expect(f.database.$client.query('pragma foreign_key_check').all()).toEqual([])
    } finally {
        closeDatabase(f.database)
    }
})

it('keeps editorial readers and content on their project context when a detached channel later changes profile', async () => {
    const f = await fixture()
    try {
        const [first, second] = f.records
        if (!first || !second || !second.project.actor.subjectId)
            throw new Error('Missing projects')
        const unrelated = await f.manual.createProject({
            name: 'Unrelated',
            subjectId: 'unrelated',
            displayName: 'Unrelated',
            workspaceId: 'workspace',
        })
        const actor = f.database.$client
            .query<{ id: string }, [string]>(
                "select id from actors where workspace_id='workspace' and origin_actor_id=?"
            )
            .get(first.project.actor.id)!
        f.database.$client
            .query(
                "insert into project_channel_attachments(project_id,channel_id,workspace_id,origin,attached_by_actor_id,attached_at) values (?,?,'workspace','explicit',?,200)"
            )
            .run(second.project.project.id, first.channel.id, actor.id)
        expect(
            await f.publishers.getPublisherConnection(
                second.project.project.id,
                first.channel.id,
                second.project.actor.subjectId
            )
        ).toMatchObject({
            projectId: second.project.project.id,
            credentialId: first.credential.id,
            id: first.connection.id,
        })
        expect(
            await f.credentials.resolvePublisherCredentialSecrets(
                second.project.project.id,
                first.credential.id
            )
        ).toMatchObject({ accessToken: 'synthetic-first' })
        expect(
            await f.credentials.resolvePublisherCredentialSecrets(
                unrelated.project.id,
                first.credential.id
            )
        ).toBeNull()
        const post = (await f.manual.createPost({
            projectId: second.project.project.id,
            subjectId: second.project.actor.subjectId,
            sourceContent: {
                body: { format: 'plain_text', text: 'Content belongs to the second project' },
                media: [],
            },
            publications: [
                {
                    channelId: first.channel.id,
                    deliveryMode: 'automatic',
                    scheduledAt: Date.now() + 60000,
                },
            ],
        }))!
        const publication = post.publications[0]!
        const before = (await f.manual.getPublicationEditorState(
            second.project.project.id,
            publication.id,
            second.project.actor.subjectId
        ))!
        expect(before).not.toBeNull()
        f.database.$client
            .query(
                "update project_channel_attachments set state='detached',detached_at=300,revision=revision+1 where project_id=? and channel_id=?"
            )
            .run(second.project.project.id, first.channel.id)
        const original = f.database.$client
            .query<{ json: string }, [string]>(
                'select profile_json as json from channel_profile_versions where id=?'
            )
            .get(first.channel.profileVersionId)!
        const definition = JSON.parse(original.json) as ChannelProfileDefinition
        const replacement = fingerprintChannelProfile(
            { ...definition, version: definition.version + 1, profileHash: '', schemaHash: '' },
            value => `sha256:${createHash('sha256').update(value).digest('hex')}`
        )
        f.database.$client
            .query("update channel_profile_versions set state='superseded' where id=?")
            .run(first.channel.profileVersionId)
        f.database.$client
            .query(
                `insert into channel_profile_versions (id,workspace_id,channel_id,profile_id,version,origin,state,profile_json,profile_hash,schema_hash,created_by_actor_id) values ('replacement-profile','workspace',?,?,?,?,'active',?,?,?,?)`
            )
            .run(
                first.channel.id,
                replacement.id,
                replacement.version,
                replacement.origin,
                JSON.stringify(replacement),
                replacement.profileHash,
                replacement.schemaHash,
                actor.id
            )
        f.database.$client
            .query("update channels set profile_version_id='replacement-profile' where id=?")
            .run(first.channel.id)
        expect(
            f.database.$client
                .query(
                    "select * from project_channel_profiles where project_id=? and profile_id='replacement-profile'"
                )
                .all(second.project.project.id)
        ).toEqual([])
        const after = await f.manual.getPublicationEditorState(
            second.project.project.id,
            publication.id,
            second.project.actor.subjectId
        )
        expect(after).not.toBeNull()
        expect(after?.post).toEqual(before.post)
        expect(before.selectedTarget).not.toBeNull()
        expect(after?.selectedTarget).toEqual(before.selectedTarget)
        expect(after?.draft.content).toEqual(before.draft.content)
        expect(f.database.$client.query('pragma foreign_key_check').all()).toEqual([])
    } finally {
        closeDatabase(f.database)
    }
})
