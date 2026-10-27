import { expect, it } from 'bun:test'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { closeDatabase, createDatabase } from './client'
import { createEventJournalStore, parseEventJournalCursor } from './event-journal-store'
import { seedLegacyProjectChannel, seedLegacyPublication } from './legacy-migration-fixture'
import { defaultMigrationsFolder, rehearseMigrations, runMigrations } from './migrations'
import { createPublisherCredentialCipher } from './publisher-credential-crypto'
import { createPublisherCredentialStore } from './publisher-credential-store'

it('preserves the prior data graph and retired journal cursors across rehearsal, failed upgrade and committed reopening', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'postdot-workspace-attribution-'))
    const previous = join(directory, 'previous')
    const filename = join(directory, 'instance.sqlite')
    let database = createDatabase(filename)
    try {
        mkdirSync(join(previous, 'meta'), { recursive: true })
        const journal = JSON.parse(
            readFileSync(join(defaultMigrationsFolder, 'meta/_journal.json'), 'utf8')
        ) as { entries: { idx: number; tag: string }[] }
        journal.entries = journal.entries.filter(entry => entry.idx < 21)
        writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(journal))
        for (const entry of journal.entries)
            copyFileSync(
                join(defaultMigrationsFolder, `${entry.tag}.sql`),
                join(previous, `${entry.tag}.sql`)
            )
        runMigrations(database, previous)
        const legacy = seedLegacyProjectChannel(database, 'owner', 100)
        seedLegacyPublication(database, legacy, 101)
        const credentials = createPublisherCredentialStore(database, {
            cipher: createPublisherCredentialCipher({
                keyId: 'fixture',
                key: new Uint8Array(32).fill(1),
            }),
        })
        const credential = await credentials.createPublisherCredential({
            projectId: legacy.project.id,
            connectedByActorId: legacy.actor.id,
            providerId: 'fixture',
            externalAccountId: 'fixture-account',
            accessToken: 'synthetic-preserved-access',
            refreshToken: 'synthetic-preserved-refresh',
        })
        expect(credential.kind).toBe('created')
        const insertEvent = database.$client
            .query(`insert into audit_events (sequence,id,project_id,actor_id,action,entity_type,entity_id,metadata_json,created_at)
            values (?, ?, ?, ?, 'legacy.fact', 'publication','legacy-publication','{"preserve":true}',102)`)
        insertEvent.run(10, 'kept', legacy.project.id, legacy.actor.id)
        insertEvent.run(9001, 'retired', legacy.project.id, legacy.actor.id)
        database.$client.run("delete from audit_events where id='retired'")
        database.$client
            .query(`insert into notifications
            (id,project_id,recipient_user_id,recipient_actor_id,source_event_id,kind,severity,subject_type,subject_id,title,body,created_at)
            values ('legacy-notification',?, 'owner',?, 'kept','publication_published','success','publication','legacy-publication','Preserve','Preserve',102)`)
            .run(legacy.project.id, legacy.actor.id)
        const tables = [
            'actors',
            'publisher_credentials',
            'notifications',
            'channels',
            'channel_profile_versions',
            'posts',
            'publications',
            'publication_target_revisions',
            'jobs',
            'audit_events',
            '__drizzle_migrations',
        ]
        const oldColumns = tables.map(table => ({
            table,
            columns: database.$client
                .query<{ name: string }, []>('pragma table_info(' + table + ')')
                .all()
                .map(row => row.name),
        }))
        const snapshot = () =>
            oldColumns.map(({ table, columns }) => ({
                table,
                rows: database.$client
                    .query(`select ${columns.join(',')} from ${table} order by rowid`)
                    .all(),
            }))
        const before = snapshot()
        const highWater = () =>
            database.$client
                .query("select seq from sqlite_sequence where name='audit_events'")
                .get()
        const verify = () => {
            expect(snapshot().filter(row => row.table !== '__drizzle_migrations')).toEqual(
                before.filter(row => row.table !== '__drizzle_migrations')
            )
            expect(highWater()).toEqual({ seq: 9001 })
            expect(database.$client.query('pragma foreign_key_check').all()).toEqual([])
        }
        const report = rehearseMigrations(database, undefined, { verify })
        expect(report.pending).toHaveLength(1)
        expect(snapshot()).toEqual(before)
        expect(
            database.$client
                .query('pragma table_info(actors)')
                .all()
                .some((row: unknown) => (row as { name: string }).name === 'workspace_id')
        ).toBe(false)
        expect(() =>
            runMigrations(database, undefined, {
                verify: () => {
                    verify()
                    throw new Error('Reject after rebuilding')
                },
            })
        ).toThrow('Reject after rebuilding')
        expect(snapshot()).toEqual(before)
        expect(highWater()).toEqual({ seq: 9001 })
        runMigrations(database, undefined, { verify })
        closeDatabase(database)
        database = createDatabase(filename)
        expect(database.$client.query('pragma foreign_key_check').all()).toEqual([])
        expect(
            database.$client.query('select workspace_id,origin_actor_id from actors').all()
        ).toEqual([{ workspace_id: null, origin_actor_id: null }])
        if (credential.kind !== 'created') throw new Error('Missing credential')
        const reopenedCredentials = createPublisherCredentialStore(database, {
            cipher: createPublisherCredentialCipher({
                keyId: 'fixture',
                key: new Uint8Array(32).fill(1),
            }),
        })
        expect(
            await reopenedCredentials.resolvePublisherCredentialSecrets(
                legacy.project.id,
                credential.credential.id
            )
        ).toMatchObject({
            accessToken: 'synthetic-preserved-access',
            refreshToken: 'synthetic-preserved-refresh',
        })
        const store = createEventJournalStore(database)
        expect(store.latestCursor()).toBe(parseEventJournalCursor('event-sequence:9001'))
        const next = store.append({
            projectId: legacy.project.id,
            actorId: legacy.actor.id,
            name: 'legacy.followup',
            version: 1,
            subject: { type: 'publication', id: 'legacy-publication' },
            occurredAt: 103,
        })
        expect(next.cursor).toBe(parseEventJournalCursor('event-sequence:9002'))
        expect(store.readAfter({ projectId: legacy.project.id }).map(event => event.id)).toEqual([
            'kept',
            next.id,
        ])
        runMigrations(database)
        expect(store.latestCursor()).toBe(parseEventJournalCursor('event-sequence:9002'))
    } finally {
        closeDatabase(database)
        rmSync(directory, { recursive: true, force: true })
    }
})
