import { expect, it } from 'bun:test'

import { createManualChannelProfile } from '@postdot/core'

import { closeDatabase, createDatabase } from './client'
import { createManualStore } from './manual-store'
import { runMigrations, rehearseMigrations } from './migrations'
import { createPublisherCredentialCipher } from './publisher-credential-crypto'
import { createPublisherCredentialStore } from './publisher-credential-store'
import { createPublisherStore } from './publisher-store'
import { seedTestWorkspace } from './testing'
import { planWorkspaceChannelMigration } from './workspace-channel-migration-plan'

function fixture() {
    const database = createDatabase(':memory:')
    runMigrations(database)
    database.$client.run(
        "insert into organization (id,name,slug,created_at) values ('organization','Workspace','workspace',1800000000000)"
    )
    database.$client.run(
        "insert into workspaces (id,organization_id,name,slug,created_at,updated_at) values ('workspace','organization','Workspace','workspace',1800000000000,1800000000000)"
    )
    return { database, manual: createManualStore(database) }
}

it('refuses unknown ownership without assigning a default or modifying existing data', () => {
    const f = fixture()
    try {
        const project = f.manual.createProject({
            workspaceId: seedTestWorkspace(f.database),
            name: 'Unassigned project',
            subjectId: 'owner',
            displayName: 'Owner',
        })
        // New projects must be assigned; this models historical data that never was.
        f.database.$client.query('update projects set workspace_id = null').run()
        const before = f.database.$client.query('select * from projects').all()
        expect(() => planWorkspaceChannelMigration(f.database)).toThrow(project.project.id)
        expect(f.database.$client.query('select * from projects').all()).toEqual(before)
        expect(
            f.database.$client.query('select workspace_id as workspaceId from projects').get()
        ).toEqual({ workspaceId: null })
    } finally {
        closeDatabase(f.database)
    }
})

it('plans existing resource IDs without merging duplicate accounts or exposing credential material', async () => {
    const f = fixture()
    try {
        const credentials = createPublisherCredentialStore(f.database, {
            cipher: createPublisherCredentialCipher({
                keyId: 'test',
                key: new Uint8Array(32).fill(1),
            }),
        })
        const ids: string[] = []
        for (const subjectId of ['first-owner', 'second-owner']) {
            const project = f.manual.createProject({
                name: 'Project',
                subjectId,
                displayName: 'Owner',
                workspaceId: 'workspace',
            })
            f.manual.createChannel({ projectId: project.project.id, subjectId, name: 'Channel' })
            const credential = await credentials.createPublisherCredential({
                projectId: project.project.id,
                connectedByActorId: project.actor.id,
                providerId: 'test-provider',
                externalAccountId: 'same-real-account',
                accessToken: 'private-access-token',
                refreshToken: 'private-refresh-token',
            })
            if (credential.kind !== 'created') throw new Error('Missing credential')
            ids.push(credential.credential.id)
        }
        const plan = planWorkspaceChannelMigration(f.database)
        expect(plan.credentials.map(row => row.id).sort()).toEqual(ids.sort())
        expect(plan.credentials.every(row => row.workspaceId === 'workspace')).toBe(true)
        expect(plan.channels).toHaveLength(2)
        expect(plan.profiles).toHaveLength(2)
        for (const secret of [
            'private-access-token',
            'private-refresh-token',
            'same-real-account',
            'ciphertext',
            'nonce',
        ])
            expect(JSON.stringify(plan)).not.toContain(secret)
    } finally {
        closeDatabase(f.database)
    }
})

it('rehearses the committed chain against representative selected and queued work without rewriting it', async () => {
    const f = fixture()
    try {
        const project = f.manual.createProject({
            name: 'Queued project',
            subjectId: 'owner',
            displayName: 'Owner',
            workspaceId: 'workspace',
        })
        const profile = {
            ...createManualChannelProfile(),
            id: 'migration-fixture',
            execution: {
                kind: 'built_in' as const,
                contractId: 'migration-fixture',
                revision: 'text-v1',
            },
        }
        const channel = f.manual.createChannel({
            projectId: project.project.id,
            subjectId: 'owner',
            name: 'Queued channel',
            profile,
        })
        if (!channel) throw new Error('Missing channel')
        const credentials = createPublisherCredentialStore(f.database, {
            cipher: createPublisherCredentialCipher({
                keyId: 'test',
                key: new Uint8Array(32).fill(1),
            }),
        })
        const credential = await credentials.createPublisherCredential({
            projectId: project.project.id,
            connectedByActorId: project.actor.id,
            providerId: 'migration-fixture',
            externalAccountId: 'account',
            accessToken: 'synthetic-never-dispatched',
        })
        if (credential.kind !== 'created') throw new Error('Missing credential')
        const publisher = createPublisherStore(f.database, {
            credentialRevoker: credentials,
            connectionPolicies: {
                'migration-fixture': {
                    defaultDestination: row => ({
                        type: 'account',
                        id: row.externalAccountId,
                        name: null,
                    }),
                    validateDestination: () => true,
                },
            },
        })
        expect(
            publisher.createPublisherConnection({
                projectId: project.project.id,
                channelId: channel.id,
                subjectId: 'owner',
                kind: 'migration-fixture',
                credentialId: credential.credential.id,
            }).kind
        ).toBe('created')
        const post = f.manual.createPost({
            projectId: project.project.id,
            subjectId: 'owner',
            sourceContent: {
                body: { format: 'plain_text', text: 'Preserve exact source and selected content' },
                media: [],
            },
            publications: [
                {
                    channelId: channel.id,
                    deliveryMode: 'automatic',
                    scheduledAt: Date.now() + 60000,
                },
            ],
        })
        expect(post).not.toBeNull()
        const snapshot = () =>
            [
                'posts',
                'publications',
                'publication_target_revisions',
                'publication_working_drafts',
                'jobs',
                'channel_profile_versions',
                'audit_events',
                '__drizzle_migrations',
            ].map(table => ({
                table,
                rows: f.database.$client.query(`select * from ${table} order by rowid`).all(),
            }))
        const before = snapshot()
        const plan = planWorkspaceChannelMigration(f.database)
        const report = rehearseMigrations(f.database, undefined, {
            preflight: db => {
                expect(planWorkspaceChannelMigration(db)).toEqual(plan)
            },
            verify: () => {
                expect(snapshot()).toEqual(before)
            },
        })
        expect(report.pending).toEqual([])
        expect(snapshot()).toEqual(before)
        expect(
            f.database.$client
                .query("select count(*) as count from jobs where state='pending'")
                .get()
        ).toEqual({ count: 1 })
    } finally {
        closeDatabase(f.database)
    }
})
