import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { closeDatabase, createDatabase } from './client'
import { migrationsThrough } from './legacy-migration-fixture'
import { defaultMigrationsFolder, runMigrations } from './migrations'

interface ColumnInfo {
    readonly name: string
    readonly type: string
    readonly notnull: number
    readonly dflt_value: string | null
    readonly pk: number
}

test('0026 renames stored Postbot identities without breaking references', () => {
    const folder = mkdtempSync(join(tmpdir(), 'postdot-identity-migration-'))
    const database = createDatabase(':memory:')
    try {
        runMigrations(database, migrationsThrough(folder, 25))
        const client = database.$client
        client.exec('pragma foreign_keys = off; pragma ignore_check_constraints = on')

        const insert = (table: string, values: Record<string, unknown>) => {
            const columns = client.query(`pragma table_info("${table}")`).all() as ColumnInfo[]
            const row: Record<string, unknown> = { ...values }
            for (const column of columns) {
                if (column.name in row || column.notnull === 0 || column.dflt_value !== null)
                    continue
                row[column.name] = /int/i.test(column.type) ? 1 : 'x'
            }
            const names = Object.keys(row)
            client
                .query(
                    `insert into "${table}" (${names.map(name => `"${name}"`).join(',')}) values (${names.map(() => '?').join(',')})`
                )
                .run(...(Object.values(row) as never[]))
        }

        const hashes = {
            profile_hash: 'sha256:postbot-x-post-v2',
            schema_hash: 'sha256:postbot-x-post-schema-v2',
        }
        insert('organization', {
            id: 'org',
            slug: 'postbot-workspace-w1',
            metadata: '{"postbotResource":"workspace","postbotDefault":true}',
        })
        insert('workspaces', { id: 'w1', organization_id: 'org', slug: 'postbot-workspace-w1' })
        insert('team', { id: 'postbot-workspace-team:w1:viewers', organization_id: 'org' })
        insert('team_member', {
            id: 'postbot-team-member:postbot-workspace-team:w1:viewers:u1',
            membership_key: 'postbot-team-member:postbot-workspace-team:w1:viewers:u1',
            team_id: 'postbot-workspace-team:w1:viewers',
            user_id: 'u1',
        })
        insert('member', { id: 'postbot-workspace-member:w1:u1', organization_id: 'org' })
        insert('project_user_grants', {
            id: 'postbot-project-user-grant:p1:u1',
            project_id: 'p1',
            role: 'viewer',
        })
        insert('project_team_grants', {
            id: 'postbot-project-team-grant:p1:postbot-workspace-team:w1:viewers',
            project_id: 'p1',
            role: 'viewer',
            team_id: 'postbot-workspace-team:w1:viewers',
        })
        insert('channel_profile_versions', {
            id: 'version',
            profile_json:
                '{"profileHash":"sha256:postbot-x-post-v2","execution":{"mode":"postbot_webhook"},"revision":"postbot-custom-v1"}',
            ...hashes,
        })
        insert('publication_target_revisions', { id: 'target', ...hashes })
        insert('media_representations', { id: 'rep', processor_id: 'postbot-image-preview' })
        insert('provider_analytics_observations', {
            id: 'obs',
            postbot_entity_type: 'channel',
            postbot_entity_id: 'channel-1',
        })

        // Apply the statements directly: the fixture rows deliberately omit unrelated parents.
        const statements = readFileSync(
            join(defaultMigrationsFolder, '0026_postdot_identity.sql'),
            'utf8'
        )
        for (const statement of statements.split('--> statement-breakpoint')) client.exec(statement)

        const one = (sql: string) => client.query(sql).get() as Record<string, unknown>
        expect(one('select slug, metadata from organization')).toEqual({
            slug: 'postdot-workspace-w1',
            metadata: '{"postdotResource":"workspace","postdotDefault":true}',
        })
        expect(one('select slug from workspaces')).toEqual({ slug: 'postdot-workspace-w1' })
        expect(one('select id from team')).toEqual({ id: 'postdot-workspace-team:w1:viewers' })
        expect(one('select id, membership_key, team_id from team_member')).toEqual({
            id: 'postdot-team-member:postdot-workspace-team:w1:viewers:u1',
            membership_key: 'postdot-team-member:postdot-workspace-team:w1:viewers:u1',
            team_id: 'postdot-workspace-team:w1:viewers',
        })
        expect(one('select id from member')).toEqual({ id: 'postdot-workspace-member:w1:u1' })
        expect(one('select id from project_user_grants')).toEqual({
            id: 'postdot-project-user-grant:p1:u1',
        })
        expect(one('select id, team_id from project_team_grants')).toEqual({
            id: 'postdot-project-team-grant:p1:postdot-workspace-team:w1:viewers',
            team_id: 'postdot-workspace-team:w1:viewers',
        })
        expect(
            one('select profile_json, profile_hash, schema_hash from channel_profile_versions')
        ).toEqual({
            profile_json:
                '{"profileHash":"sha256:postdot-x-post-v2","execution":{"mode":"postbot_webhook"},"revision":"postbot-custom-v1"}',
            profile_hash: 'sha256:postdot-x-post-v2',
            schema_hash: 'sha256:postdot-x-post-schema-v2',
        })
        expect(one('select profile_hash, schema_hash from publication_target_revisions')).toEqual({
            profile_hash: 'sha256:postdot-x-post-v2',
            schema_hash: 'sha256:postdot-x-post-schema-v2',
        })
        expect(one('select processor_id from media_representations')).toEqual({
            processor_id: 'postdot-image-preview',
        })
        expect(
            one(
                'select postdot_entity_type, postdot_entity_id from provider_analytics_observations'
            )
        ).toEqual({ postdot_entity_type: 'channel', postdot_entity_id: 'channel-1' })
    } finally {
        closeDatabase(database)
        rmSync(folder, { recursive: true, force: true })
    }
})
