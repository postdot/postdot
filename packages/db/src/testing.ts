import type { ChannelProfileDefinition } from '@postdot/core'

import {
    closeDatabase,
    closePostgresDatabase,
    createDatabase,
    createPostgresDatabase,
    type DatabaseHandle,
} from './client'
import { runMigrations } from './migrations'
import { runPortableMigrations } from './sql/migrator'
import { createWorkspaceActorStore } from './workspace-actor-store'

/** Test fixture: an idempotent workspace row so projects can be created under the required ownership boundary. */
export async function seedTestWorkspace(
    database: DatabaseHandle,
    id = 'test-workspace'
): Promise<string> {
    await database.sql
        .statement(
            'insert into organization(id,name,slug,created_at) values (?1,?1,?1,1) on conflict do nothing'
        )
        .run(id)
    await database.sql
        .statement(
            'insert into workspaces(id,organization_id,name,slug,created_at,updated_at) values (?1,?1,?1,?1,1,1) on conflict do nothing'
        )
        .run(id)
    return id
}

/** Test fixture: the workspace that owns a project, for rows that are workspace-scoped. */
export async function workspaceOf(database: DatabaseHandle, projectId: string): Promise<string> {
    const row = await database.sql
        .statement<{ workspaceId: string | null }, [string]>(
            'select workspace_id as workspaceId from projects where id = ?'
        )
        .get(projectId)
    if (!row?.workspaceId) throw new Error(`Project ${projectId} has no workspace`)
    return row.workspaceId
}

/** Test fixture: a workspace-owned channel with its first attachment and managing project. */
export async function seedWorkspaceChannel(
    database: DatabaseHandle,
    input: {
        readonly projectId: string
        readonly channelId: string
        readonly name: string
        readonly profileVersionId: string
        readonly profile: ChannelProfileDefinition
        /** Project actor recorded as the creator. */
        readonly createdByActorId: string
        readonly state?: 'active' | 'archived'
    }
): Promise<{ readonly workspaceId: string; readonly workspaceActorId: string }> {
    const sql = database.sql
    const current = await sql
        .statement<{ workspaceId: string | null }, [string]>(
            'select workspace_id as workspaceId from projects where id = ?'
        )
        .get(input.projectId)
    if (!current) throw new Error(`Project ${input.projectId} does not exist`)
    const workspaceId = current.workspaceId ?? (await seedTestWorkspace(database))
    if (current.workspaceId === null)
        await sql
            .statement('update projects set workspace_id = ? where id = ?')
            .run(workspaceId, input.projectId)
    const actor = await createWorkspaceActorStore(database).ensureFromProjectActor({
        workspaceId,
        projectActorId: input.createdByActorId,
    })
    if (!actor) throw new Error('The creator is not an actor of the project')
    const at = Date.now()
    const archived = input.state === 'archived'
    await sql
        .statement(
            `insert into channels (id,workspace_id,name,profile_version_id,state,archived_at,created_at,updated_at) values (?,?,?,?,?,?,?,?)`
        )
        .run(
            input.channelId,
            workspaceId,
            input.name,
            input.profileVersionId,
            archived ? 'archived' : 'active',
            archived ? at : null,
            at,
            at
        )
    await sql
        .statement(
            `insert into channel_profile_versions (id,workspace_id,channel_id,profile_id,version,origin,state,profile_json,profile_hash,schema_hash,created_by_actor_id,created_at,updated_at) values (?,?,?,?,?,?,'active',?,?,?,?,?,?)`
        )
        .run(
            input.profileVersionId,
            workspaceId,
            input.channelId,
            input.profile.id,
            input.profile.version,
            input.profile.origin,
            JSON.stringify(input.profile),
            input.profile.profileHash,
            input.profile.schemaHash,
            actor.id,
            at,
            at
        )
    await sql
        .statement(
            `insert into project_channel_attachments (project_id,channel_id,workspace_id,origin,attached_by_actor_id,attached_at) values (?,?,?,'explicit',?,?)`
        )
        .run(input.projectId, input.channelId, workspaceId, actor.id, at)
    await sql
        .statement(
            `insert into channel_managers (channel_id,project_id,workspace_id) values (?,?,?)`
        )
        .run(input.channelId, input.projectId, workspaceId)
    return { workspaceId, workspaceActorId: actor.id }
}

/** Test fixture: workspace membership, required before project grants take effect for a workspace project. */
export async function seedWorkspaceMember(
    database: DatabaseHandle,
    workspaceId: string,
    userId: string
): Promise<void> {
    await database.sql
        .statement(
            `insert into member (id, organization_id, user_id, role, created_at)
             select ?1, organization_id, ?2, 'member', 1 from workspaces where id = ?3 on conflict do nothing`
        )
        .run(`member:${workspaceId}:${userId}`, userId, workspaceId)
}

/** Engine selected for the test run: `POSTDOT_TEST_ENGINE=postgres` with `POSTDOT_TEST_POSTGRES_URL`. */
export const testEngine: 'sqlite' | 'postgres' =
    process.env.POSTDOT_TEST_ENGINE === 'postgres' ? 'postgres' : 'sqlite'

export interface TestDatabase {
    readonly database: DatabaseHandle
    close(): Promise<void>
}

/**
 * Test fixture: a migrated, empty database on the selected engine (ADR-097).
 * SQLite uses an in-memory database migrated by the current chain; PostgreSQL
 * creates and later drops a disposable database migrated by the portable
 * migrations.
 */
export async function openTestDatabase(): Promise<TestDatabase> {
    const opened = await openEngineDatabase()
    openedTestDatabases.set(opened.database, opened)
    return opened
}

const openedTestDatabases = new WeakMap<DatabaseHandle, TestDatabase>()

/** Closes a database returned by `openTestDatabase` (drops it on PostgreSQL). */
export async function closeTestDatabase(database: DatabaseHandle): Promise<void> {
    const opened = openedTestDatabases.get(database)
    if (opened === undefined) throw new Error('Not a database opened by openTestDatabase')
    openedTestDatabases.delete(database)
    await opened.close()
}

async function openEngineDatabase(): Promise<TestDatabase> {
    if (testEngine === 'sqlite') {
        const database = createDatabase(':memory:')
        runMigrations(database)
        return {
            database,
            async close() {
                closeDatabase(database)
            },
        }
    }
    const url = process.env.POSTDOT_TEST_POSTGRES_URL
    if (url === undefined) {
        throw new Error('POSTDOT_TEST_ENGINE=postgres requires POSTDOT_TEST_POSTGRES_URL')
    }
    const name = `postdot_test_${crypto.randomUUID().replaceAll('-', '')}`
    const admin = createPostgresDatabase(url, { max: 1 })
    await admin.sql.exec(`create database ${name}`)
    const target = new URL(url)
    target.pathname = `/${name}`
    const database = createPostgresDatabase(target.toString(), { max: 4 })
    await runPortableMigrations(database)
    return {
        database,
        async close() {
            await closePostgresDatabase(database)
            await admin.sql.exec(`drop database if exists ${name} with (force)`)
            await closePostgresDatabase(admin)
        },
    }
}
