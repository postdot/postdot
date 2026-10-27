import { expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createManualChannelProfile } from '@postdot/core'

import { closeDatabase, createDatabase, type PostbotDatabase } from './client'
import { createManualStore } from './manual-store'
import { rehearseMigrations, runMigrations } from './migrations'
import { createPublisherCredentialCipher } from './publisher-credential-crypto'
import { createPublisherCredentialStore } from './publisher-credential-store'
import { createPublisherStore } from './publisher-store'
import { planWorkspaceChannelMigration } from './workspace-channel-migration-plan'

const candidate = fileURLToPath(
    new URL('../migration-candidates/workspace-channels', import.meta.url)
)

function workspace(db: PostbotDatabase, id: string) {
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
    runMigrations(database)
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
        const project = manual.createProject({
            name: id,
            subjectId: id,
            displayName: id,
            workspaceId: 'workspace',
        })
        const channel = manual.createChannel({
            projectId: project.project.id,
            subjectId: id,
            name: id,
            profile: {
                ...createManualChannelProfile(),
                id: 'fixture',
                execution: { kind: 'built_in', contractId: 'fixture', revision: 'v1' },
            },
        })!
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
        const connection = publishers.createPublisherConnection({
            projectId: project.project.id,
            channelId: channel.id,
            subjectId: id,
            kind: 'fixture',
            credentialId: credential.credential.id,
        })
        if (connection.kind !== 'created') throw new Error('Missing connection')
        const post = manual.createPost({
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
        })!
        records.push({
            project,
            channel,
            credential: credential.credential,
            connection: connection.connection,
            post,
        })
    }
    return { database, manual, cipher, records }
}

function unchanged(db: PostbotDatabase) {
    return [
        'posts',
        'publications',
        'publication_working_drafts',
        'publication_target_revisions',
        'publication_revision_media',
        'publication_execution_revisions',
        'publication_execution_revision_media',
        'media_assets',
        'media_representations',
        'jobs',
        'audit_events',
    ].map(table => ({
        table,
        rows: db.$client.query(`select * from ${table} order by rowid`).all(),
    }))
}

it('converts preserved IDs, duplicate accounts, profiles, queued work and attribution without inventing historical events', async () => {
    const f = await fixture()
    try {
        const before = unchanged(f.database)
        const plan = planWorkspaceChannelMigration(f.database)
        const profiles = f.database.$client
            .query(
                'select id,profile_json,profile_hash,schema_hash from channel_profile_versions order by id'
            )
            .all()
        const actors = f.database.$client.query('select * from actors order by id').all()
        const envelopes = f.database.$client
            .query(
                'select id,encryption_version,encryption_key_id,access_token_ciphertext,access_token_nonce,refresh_token_ciphertext,refresh_token_nonce,provider_session_ciphertext,provider_session_nonce from publisher_credentials order by id'
            )
            .all()
        const verify = (db: PostbotDatabase) => {
            expect(unchanged(db)).toEqual(before)
            expect(
                db.$client
                    .query(
                        'select id,profile_json,profile_hash,schema_hash from channel_profile_versions order by id'
                    )
                    .all()
            ).toEqual(profiles)
            expect(db.$client.query('pragma foreign_key_check').all()).toEqual([])
            expect(
                db.$client
                    .query(
                        'select id,encryption_version,encryption_key_id,access_token_ciphertext,access_token_nonce,refresh_token_ciphertext,refresh_token_nonce,provider_session_ciphertext,provider_session_nonce from publisher_credentials order by id'
                    )
                    .all()
            ).toEqual(envelopes)
            expect(db.$client.query('select id from channels order by id').all()).toEqual(
                plan.channels.map(row => ({ id: row.id }))
            )
            expect(
                db.$client.query('select id from publisher_credentials order by id').all()
            ).toEqual(plan.credentials.map(row => ({ id: row.id })))
            expect(
                db.$client.query("select count(*) as count from jobs where state='pending'").get()
            ).toEqual({ count: 2 })
        }
        expect(rehearseMigrations(f.database, candidate, { verify }).pending).toHaveLength(1)
        expect(unchanged(f.database)).toEqual(before)
        expect(f.database.$client.query('select project_id from channels').all()).toHaveLength(2)
        expect(() =>
            runMigrations(f.database, candidate, {
                verify: db => {
                    verify(db)
                    throw new Error('Reject converted graph')
                },
            })
        ).toThrow('Reject converted graph')
        expect(f.database.$client.query('select * from actors order by id').all()).toEqual(actors)
        expect(f.database.$client.query('select project_id from channels').all()).toHaveLength(2)
        runMigrations(f.database, candidate, { verify })
        expect(f.database.$client.query('select workspace_id from channels').all()).toEqual([
            { workspace_id: 'workspace' },
            { workspace_id: 'workspace' },
        ])
        expect(
            f.database.$client
                .query('pragma table_info(channels)')
                .all()
                .some((row: unknown) => (row as { name: string }).name === 'project_id')
        ).toBe(false)
        const attachments = f.database.$client
            .query<{ origin: string; attached_at: number; attached_by_actor_id: null }, []>(
                'select origin,attached_at,attached_by_actor_id from project_channel_attachments'
            )
            .all()
        expect(attachments).toHaveLength(2)
        expect(
            attachments.every(
                row =>
                    row.origin === 'migrated' &&
                    row.attached_at > 0 &&
                    row.attached_by_actor_id === null
            )
        ).toBe(true)
        expect(
            f.database.$client
                .query("select count(*) as count from actors where workspace_id='workspace'")
                .get()
        ).toEqual({ count: 2 })
    } finally {
        closeDatabase(f.database)
    }
})

it('enforces attachment/workspace relations while retaining a shared resource after origin-project deletion', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'postdot-channel-conversion-'))
    const filename = join(directory, 'instance.sqlite')
    const f = await fixture(filename)
    try {
        const [first, second] = f.records
        if (!first || !second) throw new Error('Missing projects')
        workspace(f.database, 'foreign')
        const foreign = f.manual.createProject({
            name: 'Foreign',
            subjectId: 'foreign',
            displayName: 'Foreign',
            workspaceId: 'foreign',
        })
        runMigrations(f.database, candidate)
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
        attach.run(second.project.project.id, first.channel.id, 'workspace', actor.id)
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
        runMigrations(f.database, candidate)
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

it('refuses unknown workspace ownership and rolls back every conversion change', () => {
    const database = createDatabase(':memory:')
    try {
        runMigrations(database)
        const project = createManualStore(database).createProject({
            name: 'Unassigned',
            subjectId: 'owner',
            displayName: 'Owner',
        })
        const before = database.$client.query('select * from projects').all()
        expect(() => runMigrations(database, candidate)).toThrow('workspace_assignment_required')
        expect(database.$client.query('select * from projects').all()).toEqual(before)
        expect(
            database.$client
                .query('select workspace_id from projects where id=?')
                .get(project.project.id)
        ).toEqual({ workspace_id: null })
        expect(
            database.$client
                .query(
                    "select name from sqlite_master where name like '__share_%' or name='project_channel_attachments'"
                )
                .all()
        ).toEqual([])
    } finally {
        closeDatabase(database)
    }
})
