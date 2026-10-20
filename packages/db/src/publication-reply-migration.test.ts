import { expect, test } from 'bun:test'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { closeDatabase, createDatabase } from './client'
import { createManualStore } from './manual-store'
import { defaultMigrationsFolder, runMigrations } from './migrations'

test('upgrades existing Bluesky reply history without losing intent, claims or outcomes', () => {
    const folder = mkdtempSync(join(tmpdir(), 'postbot-reply-migration-'))
    const database = createDatabase(':memory:')
    try {
        const journal = JSON.parse(
            readFileSync(join(defaultMigrationsFolder, 'meta/_journal.json'), 'utf8')
        ) as { entries: { idx: number; tag: string }[] }
        const previous = { ...journal, entries: journal.entries.filter(entry => entry.idx < 15) }
        mkdirSync(join(folder, 'meta'))
        writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify(previous))
        for (const entry of previous.entries)
            copyFileSync(
                join(defaultMigrationsFolder, `${entry.tag}.sql`),
                join(folder, `${entry.tag}.sql`)
            )
        runMigrations(database, folder)
        const now = 1_800_000_000_000
        database.$client
            .query(
                'insert into "user" (id, name, email, email_verified, created_at, updated_at) values (?1, ?2, ?3, 1, ?4, ?4)'
            )
            .run('owner', 'Owner', 'owner@example.test', now)
        const manual = createManualStore(database, { now: () => now })
        const { project, actor } = manual.createProject({
            name: 'Project',
            subjectId: 'owner',
            displayName: 'Owner',
        })
        const channel = manual.createChannel({
            projectId: project.id,
            subjectId: 'owner',
            name: 'Channel',
        })!
        const publication = manual.createPost({
            projectId: project.id,
            subjectId: 'owner',
            sourceContent: { body: { format: 'plain_text', text: 'Source' }, media: [] },
            publications: [{ channelId: channel.id, deliveryMode: 'manual' }],
        })!.publications[0]!
        for (const state of ['pending', 'running', 'sent', 'ambiguous']) {
            database.$client
                .query(`insert into publication_comment_replies
                (id,project_id,publication_id,actor_id,root_uri,parent_uri,text,connection_id,credential_id,account_did,record_key,state,attempts,claim_token,lease_expires_at,effect_started_at,external_id,external_url,last_error,created_at,updated_at)
                values (?1,?2,?3,?4,'at://root','at://parent','Retained reply','connection','credential','did:plc:owner',?1,?5,1,?6,?7,?8,?9,?10,?11,?12,?12)`)
                .run(
                    state,
                    project.id,
                    publication.id,
                    actor.id,
                    state,
                    state === 'running' ? 'claim' : null,
                    state === 'running' ? now + 1000 : null,
                    state === 'pending' ? null : now,
                    state === 'sent' ? 'at://reply' : null,
                    state === 'sent' ? 'https://bsky.app/profile/owner/post/reply' : null,
                    state === 'ambiguous' ? 'Uncertain' : null,
                    now
                )
        }
        const before = database.$client
            .query('select * from publication_comment_replies order by id')
            .all() as Record<string, unknown>[]
        runMigrations(database)
        const expected = before.map(({ account_did, ...row }) => ({
            ...row,
            account_id: account_did,
            provider_id: 'bluesky',
            instance_origin: null,
        }))
        expect(
            database.$client.query('select * from publication_comment_replies order by id').all()
        ).toEqual(expected)
        expect(database.$client.query('PRAGMA foreign_key_check').all()).toEqual([])
        runMigrations(database)
        expect(
            database.$client.query('select * from publication_comment_replies order by id').all()
        ).toEqual(expected)
    } finally {
        closeDatabase(database)
        rmSync(folder, { recursive: true, force: true })
    }
})
