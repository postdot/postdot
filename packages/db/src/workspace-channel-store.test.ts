import { expect, it } from 'bun:test'

import { CadenceConflictError, cadencePeriod, createChannelCadenceStore } from './channel-cadence'
import { closeDatabase, createDatabase, setDatabaseCommitObserver } from './client'
import { createEventJournalStore } from './event-journal-store'
import { createManualStore } from './manual-store'
import { runMigrations } from './migrations'
import { createWorkspaceActorStore } from './workspace-actor-store'
import {
    createWorkspaceChannelStore,
    type ChannelAccessPolicy,
    type WorkspaceChannelContext,
} from './workspace-channel-store'

function fixture() {
    const database = createDatabase(':memory:')
    runMigrations(database)
    for (const id of ['workspace', 'foreign']) {
        database.$client
            .query('insert into organization(id,name,slug,created_at) values (?,?,?,100)')
            .run(id, id, id)
        database.$client
            .query(
                'insert into workspaces(id,organization_id,name,slug,created_at,updated_at) values (?,?,?,?,100,100)'
            )
            .run(id, id, id, id)
    }
    const manual = createManualStore(database)
    const source = manual.createProject({
        name: 'Confidential source',
        subjectId: 'operator',
        displayName: 'Operator',
        workspaceId: 'workspace',
    })
    const target = manual.createProject({
        name: 'Target',
        subjectId: 'operator',
        displayName: 'Operator',
        workspaceId: 'workspace',
    })
    const other = manual.createProject({
        name: 'Other',
        subjectId: 'operator',
        displayName: 'Operator',
        workspaceId: 'workspace',
    })
    const foreign = manual.createProject({
        name: 'Foreign',
        subjectId: 'operator',
        displayName: 'Operator',
        workspaceId: 'foreign',
    })
    const seed = manual.createChannel({
        projectId: source.project.id,
        subjectId: 'operator',
        name: 'Seed',
    })!
    manual.createChannel({
        projectId: foreign.project.id,
        subjectId: 'operator',
        name: 'Foreign destination',
    })
    const actor = createWorkspaceActorStore(database).ensureFromProjectActor({
        workspaceId: 'workspace',
        projectActorId: source.actor.id,
    })!
    const roles = new Map([
        [source.project.id, 'owner'],
        [target.project.id, 'owner'],
        [other.project.id, 'owner'],
    ])
    const now = Date.now() + 1000
    const store = createWorkspaceChannelStore(database, { now: () => now })
    function context(
        settings: {
            roles?: Map<string, string>
            scopes?: Set<string>
            capabilities?: Set<string>
            admin?: boolean
            contextProjectId?: string
        } = {}
    ): WorkspaceChannelContext {
        const grants = settings.roles ?? roles
        const scope = (id: string) => settings.scopes === undefined || settings.scopes.has(id)
        const cap = (value: string) =>
            settings.capabilities === undefined || settings.capabilities.has(value)
        const authorization: ChannelAccessPolicy = {
            authorizeProject(id, action) {
                if (!scope(id)) return false
                const role = grants.get(id)
                if (!role) return false
                if (action === 'read_channels') return cap('read')
                if (action === 'withdraw_channels') return role === 'owner' && cap('share')
                if (action === 'create_channels' || action === 'manage_channels')
                    return role !== 'viewer' && cap('manage')
                return role !== 'viewer' && cap('share')
            },
            authorizeWorkspace(id, action) {
                return (
                    settings.admin === true &&
                    settings.scopes === undefined &&
                    id === 'workspace' &&
                    cap(action === 'manage_channels' ? 'manage' : 'share')
                )
            },
            authorizeSharing(ids) {
                return cap('share') && ids.every(scope)
            },
        }
        return { actorId: actor.id, authorization, contextProjectId: settings.contextProjectId }
    }
    const ctx = context({ contextProjectId: source.project.id })
    const created = store.create(ctx, { projectId: source.project.id, name: 'Shared destination' })
    if (created.kind !== 'created') throw new Error('Missing channel')
    return {
        database,
        source,
        target,
        other,
        foreign,
        actor,
        roles,
        store,
        context,
        ctx,
        channel: created.channel,
        seed,
        now,
    }
}

it('creates one workspace-owned channel, profile, attachment, manager and attributed fact atomically', () => {
    const f = fixture()
    try {
        expect(f.channel).toMatchObject({
            workspaceId: 'workspace',
            name: 'Shared destination',
            revision: 1,
            state: 'active',
        })
        expect(f.channel).not.toHaveProperty('projectId')
        expect(
            f.database.$client
                .query('select project_id from channel_managers where channel_id=?')
                .get(f.channel.id)
        ).toEqual({ project_id: f.source.project.id })
        expect(
            f.database.$client
                .query(
                    'select origin,attached_by_actor_id from project_channel_attachments where channel_id=?'
                )
                .get(f.channel.id)
        ).toEqual({ origin: 'explicit', attached_by_actor_id: f.actor.id })
        const events = createEventJournalStore(f.database).readWorkspaceAfter({
            workspaceId: 'workspace',
        })
        expect(
            events
                .filter(event => event.subject.id === f.channel.id)
                .map(event => [event.name, event.actorId, event.subject.id])
        ).toEqual([['channel.created', f.actor.id, f.channel.id]])
        expect(f.database.$client.query('pragma foreign_key_check').all()).toEqual([])
    } finally {
        closeDatabase(f.database)
    }
})

it('shares by attachment without exposing an unreadable manager project or connection material', () => {
    const f = fixture()
    try {
        expect(
            f.store.attach(f.ctx, {
                channelId: f.channel.id,
                projectId: f.target.project.id,
                expectedRevision: 1,
            })
        ).toEqual({ kind: 'changed', revision: 2 })
        const reader = f.context({
            roles: new Map([[f.target.project.id, 'viewer']]),
            contextProjectId: f.target.project.id,
        })
        const view = f.store.listProject(reader, f.target.project.id)!
        expect(view).toHaveLength(1)
        expect(view[0]).toMatchObject({
            id: f.channel.id,
            workspaceId: 'workspace',
            projectId: f.target.project.id,
            shared: true,
            canManage: false,
            canShare: false,
            canWithdraw: false,
            management: { kind: 'project', project: null },
        })
        const text = JSON.stringify(view)
        expect(text).not.toContain(f.source.project.id)
        expect(text).not.toContain('Confidential source')
        expect(text).not.toContain('credential')
        expect(text).not.toContain('profileJson')
        expect(view[0]).not.toHaveProperty('projectCount')
        expect(
            f.store.attach(reader, {
                channelId: f.channel.id,
                projectId: f.other.project.id,
                expectedRevision: 2,
            })
        ).toEqual({ kind: 'not_found' })
        expect(f.store.listProject(reader, f.source.project.id)).toBeNull()
    } finally {
        closeDatabase(f.database)
    }
})

it('keeps sharing authority separate from connection-management capabilities and checks live project ceilings', () => {
    const f = fixture()
    try {
        const scopes = new Set([f.source.project.id])
        const key = f.context({
            scopes,
            capabilities: new Set(['share']),
            contextProjectId: f.source.project.id,
        })
        expect(
            f.store.attach(key, {
                channelId: f.channel.id,
                projectId: f.target.project.id,
                expectedRevision: 1,
            })
        ).toEqual({ kind: 'not_found' })
        scopes.add(f.target.project.id)
        expect(
            f.store.attach(key, {
                channelId: f.channel.id,
                projectId: f.target.project.id,
                expectedRevision: 1,
            })
        ).toEqual({ kind: 'changed', revision: 2 })
        expect(
            f.store.create(key, {
                projectId: f.source.project.id,
                name: 'No management capability',
            })
        ).toEqual({ kind: 'not_found' })
        const readableKey = f.context({
            scopes,
            capabilities: new Set(['read', 'share']),
            contextProjectId: f.source.project.id,
        })
        expect(
            f.store
                .listProject(readableKey, f.source.project.id)
                ?.find(row => row.id === f.channel.id)
        ).toMatchObject({ canManage: false, canShare: true })
        scopes.add(f.other.project.id)
        f.roles.delete(f.source.project.id)
        expect(
            f.store.attach(key, {
                channelId: f.channel.id,
                projectId: f.other.project.id,
                expectedRevision: 2,
            })
        ).toEqual({ kind: 'not_found' })
        expect(
            f.store.attach(f.ctx, {
                channelId: f.channel.id,
                projectId: f.foreign.project.id,
                expectedRevision: 2,
            })
        ).toEqual({ kind: 'not_found' })
    } finally {
        closeDatabase(f.database)
    }
})

it('allows a project owner to withdraw its own use with only that project in scope', () => {
    const f = fixture()
    try {
        f.store.attach(f.ctx, {
            channelId: f.channel.id,
            projectId: f.target.project.id,
            expectedRevision: 1,
        })
        const owner = f.context({
            roles: new Map([[f.target.project.id, 'owner']]),
            scopes: new Set([f.target.project.id]),
            capabilities: new Set(['read', 'share']),
            contextProjectId: f.target.project.id,
        })
        expect(f.store.listProject(owner, f.target.project.id)?.[0]).toMatchObject({
            canManage: false,
            canWithdraw: true,
        })
        expect(
            f.store.detach(owner, {
                channelId: f.channel.id,
                projectId: f.target.project.id,
                expectedRevision: 2,
            })
        ).toEqual({ kind: 'changed', revision: 3 })
        expect(f.store.listProject(owner, f.target.project.id)).toEqual([])
        expect(f.store.listProject(owner, f.target.project.id, true)?.[0]).toMatchObject({
            attachmentState: 'detached',
            shared: false,
        })
        expect(
            f.database.$client
                .query('select project_id from channel_managers where channel_id=?')
                .get(f.channel.id)
        ).toEqual({ project_id: f.source.project.id })
    } finally {
        closeDatabase(f.database)
    }
})

it('requires an explicit last-attachment archive choice and leaves no accidental manager behind', () => {
    const f = fixture()
    try {
        const journal = createEventJournalStore(f.database)
        const before = journal.latestCursor()
        expect(
            f.store.detach(f.ctx, {
                channelId: f.channel.id,
                projectId: f.source.project.id,
                expectedRevision: 1,
            })
        ).toEqual({ kind: 'retirement_required', revision: 1 })
        expect(journal.latestCursor()).toBe(before)
        expect(
            f.store.detach(f.ctx, {
                channelId: f.channel.id,
                projectId: f.source.project.id,
                expectedRevision: 1,
                lastAttachment: 'archive',
            })
        ).toEqual({ kind: 'changed', revision: 2 })
        expect(
            f.database.$client
                .query('select state,archived_at,revision from channels where id=?')
                .get(f.channel.id)
        ).toEqual({ state: 'archived', archived_at: f.now, revision: 2 })
        expect(
            f.database.$client
                .query('select * from channel_managers where channel_id=?')
                .all(f.channel.id)
        ).toEqual([])
        expect(
            journal
                .readWorkspaceAfter({ workspaceId: 'workspace', after: before })
                .map(event => event.name)
        ).toEqual(['channel.project_detached', 'channel.archived'])
    } finally {
        closeDatabase(f.database)
    }
})

it('checks revisions and transfers management explicitly without granting it through an attachment', () => {
    const f = fixture()
    try {
        f.store.attach(f.ctx, {
            channelId: f.channel.id,
            projectId: f.target.project.id,
            expectedRevision: 1,
        })
        const before = createEventJournalStore(f.database).latestCursor()
        expect(
            f.store.detach(f.ctx, {
                channelId: f.channel.id,
                projectId: f.target.project.id,
                expectedRevision: 1,
            })
        ).toEqual({ kind: 'stale', revision: 2 })
        expect(createEventJournalStore(f.database).latestCursor()).toBe(before)
        expect(
            f.store.transferManagement(f.ctx, {
                channelId: f.channel.id,
                projectId: f.target.project.id,
                expectedRevision: 2,
            })
        ).toEqual({ kind: 'changed', revision: 3 })
        f.roles.delete(f.target.project.id)
        expect(
            f.store.listProject(f.ctx, f.source.project.id)?.find(row => row.id === f.channel.id)
        ).toMatchObject({ canManage: false, management: { kind: 'project', project: null } })
        expect(
            f.store.attach(f.ctx, {
                channelId: f.channel.id,
                projectId: f.other.project.id,
                expectedRevision: 3,
            })
        ).toEqual({ kind: 'not_found' })
    } finally {
        closeDatabase(f.database)
    }
})

it('rolls back resource creation and its wakeup if journal persistence fails', () => {
    const f = fixture()
    try {
        const journal = createEventJournalStore(f.database)
        journal.appendWorkspace({
            id: 'collision',
            workspaceId: 'workspace',
            actorId: f.actor.id,
            name: 'test.fact',
            version: 1,
            subject: { type: 'test', id: 'test' },
            occurredAt: 1000,
        })
        const before = f.database.$client.query('select id from channels order by id').all()
        const wakeups: unknown[] = []
        const remove = setDatabaseCommitObserver(f.database, ids => wakeups.push(ids))
        let sequence = 0
        const ids = ['new-channel', 'new-profile', 'collision']
        const failing = createWorkspaceChannelStore(f.database, {
            now: () => 1001,
            createId: () => ids[sequence++]!,
        })
        expect(() =>
            failing.create(f.ctx, { projectId: f.source.project.id, name: 'Must roll back' })
        ).toThrow()
        expect(f.database.$client.query('select id from channels order by id').all()).toEqual(
            before
        )
        expect(
            f.database.$client
                .query("select id from channel_profile_versions where id='new-profile'")
                .all()
        ).toEqual([])
        expect(wakeups).toEqual([])
        expect(f.database.$client.query('pragma foreign_key_check').all()).toEqual([])
        remove()
    } finally {
        closeDatabase(f.database)
    }
})

it('filters workspace metadata per channel and keeps administration separate from project content', () => {
    const f = fixture()
    try {
        const viewer = f.context({ roles: new Map([[f.target.project.id, 'viewer']]) })
        expect(f.store.listWorkspace(viewer, 'workspace')).toEqual([])
        f.store.attach(f.ctx, {
            channelId: f.channel.id,
            projectId: f.target.project.id,
            expectedRevision: 1,
        })
        const visible = f.store.listWorkspace(viewer, 'workspace')
        expect(visible).toHaveLength(1)
        expect(f.store.listProjectUsages(viewer, f.channel.id)).toEqual([
            { projectId: f.target.project.id, name: 'Target', state: 'active', revision: 1 },
        ])
        expect(visible[0]).toMatchObject({
            id: f.channel.id,
            shared: true,
            canManage: false,
            management: { kind: 'project', project: null },
        })
        expect(JSON.stringify(visible)).not.toContain(f.source.project.id)
        const admin = f.context({ roles: new Map(), admin: true })
        expect(f.store.listProject(admin, f.source.project.id)).toBeNull()
        expect(f.store.listProjectUsages(admin, f.channel.id)).toEqual([])
        expect(
            f.store.listWorkspace(admin, 'workspace').find(row => row.id === f.channel.id)
        ).toMatchObject({ canManage: true, management: { kind: 'project', project: null } })
        expect(f.store.listWorkspace(admin, 'foreign')).toEqual([])
    } finally {
        closeDatabase(f.database)
    }
})

it('preserves migrated attachment provenance and requires explicit management recovery after reattachment', () => {
    const f = fixture()
    try {
        const original = f.database.$client
            .query(
                'select origin,attached_at,attached_by_actor_id from project_channel_attachments where project_id=? and channel_id=?'
            )
            .get(f.source.project.id, f.seed.id)
        f.store.attach(f.ctx, {
            channelId: f.seed.id,
            projectId: f.target.project.id,
            expectedRevision: 1,
        })
        expect(
            f.store.detach(f.ctx, {
                channelId: f.seed.id,
                projectId: f.source.project.id,
                expectedRevision: 2,
            })
        ).toEqual({ kind: 'changed', revision: 3 })
        expect(
            f.store.attach(f.ctx, {
                channelId: f.seed.id,
                projectId: f.source.project.id,
                expectedRevision: 3,
            })
        ).toEqual({ kind: 'not_found' })
        f.database.$client
            .query(`insert into channel_profile_versions
            (id,workspace_id,channel_id,profile_id,version,origin,state,profile_json,profile_hash,schema_hash,created_by_actor_id)
            select 'late-profile',workspace_id,channel_id,profile_id,version+1,origin,'draft',profile_json,profile_hash,schema_hash,created_by_actor_id from channel_profile_versions where id=?`)
            .run(f.seed.profileVersionId)
        expect(
            f.database.$client
                .query(
                    "select project_id from project_channel_profiles where project_id=? and profile_id='late-profile'"
                )
                .all(f.source.project.id)
        ).toEqual([])
        const admin = f.context({ admin: true })
        expect(
            f.store.attach(admin, {
                channelId: f.seed.id,
                projectId: f.source.project.id,
                expectedRevision: 3,
            })
        ).toEqual({ kind: 'changed', revision: 4 })
        expect(
            f.database.$client
                .query(
                    'select origin,attached_at,attached_by_actor_id from project_channel_attachments where project_id=? and channel_id=?'
                )
                .get(f.source.project.id, f.seed.id)
        ).toEqual(original)
        expect(
            f.database.$client
                .query(
                    "select project_id from project_channel_profiles where project_id=? and profile_id='late-profile'"
                )
                .all(f.source.project.id)
        ).toEqual([{ project_id: f.source.project.id }])
        expect(
            f.database.$client
                .query('select * from channel_managers where channel_id=?')
                .all(f.seed.id)
        ).toEqual([])
        expect(
            f.store.transferManagement(admin, {
                channelId: f.seed.id,
                projectId: f.target.project.id,
                expectedRevision: 4,
            })
        ).toEqual({ kind: 'changed', revision: 5 })
        const event = createEventJournalStore(f.database)
            .readWorkspaceAfter({ workspaceId: 'workspace' })
            .at(-1)
        expect(event?.payload).toMatchObject({
            fromProjectId: null,
            toProjectId: f.target.project.id,
        })
    } finally {
        closeDatabase(f.database)
    }
})

it('keeps last-retired resources available to workspace administrators without restoring project management implicitly', () => {
    const f = fixture()
    try {
        f.store.detach(f.ctx, {
            channelId: f.channel.id,
            projectId: f.source.project.id,
            expectedRevision: 1,
            lastAttachment: 'archive',
        })
        expect(
            f.store
                .listProject(f.ctx, f.source.project.id, true)
                ?.find(row => row.id === f.channel.id)
        ).toMatchObject({
            state: 'archived',
            canWithdraw: false,
            canManage: false,
            management: { kind: 'workspace' },
        })
        const admin = f.context({ roles: new Map(), admin: true })
        expect(
            f.store.listWorkspace(admin, 'workspace').find(row => row.id === f.channel.id)
        ).toBeUndefined()
        expect(
            f.store.listWorkspace(admin, 'workspace', true).find(row => row.id === f.channel.id)
        ).toMatchObject({ state: 'archived', canManage: true, management: { kind: 'workspace' } })
        expect(f.store.listProject(admin, f.source.project.id, true)).toBeNull()
    } finally {
        closeDatabase(f.database)
    }
})

it('withdraws from an already archived channel without repeating the archive decision or rewriting its timestamp', () => {
    const f = fixture()
    try {
        f.database.$client
            .query("update channels set state='archived',archived_at=? where id=?")
            .run(f.now - 10, f.channel.id)
        const before = createEventJournalStore(f.database).latestCursor()
        expect(
            f.store.detach(f.ctx, {
                channelId: f.channel.id,
                projectId: f.source.project.id,
                expectedRevision: 1,
            })
        ).toEqual({ kind: 'changed', revision: 2 })
        expect(
            f.database.$client
                .query('select archived_at from channels where id=?')
                .get(f.channel.id)
        ).toEqual({ archived_at: f.now - 10 })
        expect(
            createEventJournalStore(f.database)
                .readWorkspaceAfter({ workspaceId: 'workspace', after: before })
                .map(event => event.name)
        ).toEqual(['channel.project_detached'])
    } finally {
        closeDatabase(f.database)
    }
})

it('reports only time taken by other projects, anonymously unless the project is readable', () => {
    const f = fixture()
    try {
        const manual = createManualStore(f.database)
        const attach = (projectId: string, expectedRevision: number) =>
            f.store.attach(f.ctx, { channelId: f.channel.id, projectId, expectedRevision })
        expect(attach(f.target.project.id, 1)).toEqual({ kind: 'changed', revision: 2 })
        expect(attach(f.other.project.id, 2)).toEqual({ kind: 'changed', revision: 3 })
        const post = (
            project: typeof f.target,
            title: string,
            publications: { channelId: string; scheduledAt?: number }[]
        ) =>
            manual.createPost({
                projectId: project.project.id,
                subjectId: 'operator',
                title,
                sourceContent: { body: { format: 'plain_text', text: title }, media: [] },
                publications: publications.map(item => ({ ...item, deliveryMode: 'manual' })),
            })
        const at = Date.now() + 86_400_000
        post(f.target, 'Visible launch', [{ channelId: f.channel.id, scheduledAt: at }])
        post(f.target, 'Unscheduled draft', [{ channelId: f.channel.id }])
        post(f.other, 'Confidential plan', [
            { channelId: f.channel.id, scheduledAt: at + 3_600_000 },
        ])
        const range = { from: at - 60_000, to: at + 7_200_000 }

        // A reader of the target sees that project in full and the other one anonymously.
        const partial = f.store.occupancy(
            f.context({
                roles: new Map([
                    [f.source.project.id, 'viewer'],
                    [f.target.project.id, 'viewer'],
                ]),
                contextProjectId: f.source.project.id,
            }),
            f.source.project.id,
            range
        )!
        expect(partial.map(item => [item.at, item.state, item.project?.title ?? null])).toEqual([
            [at, 'scheduled', 'Visible launch'],
            [at + 3_600_000, 'scheduled', null],
        ])
        expect(partial[0]!.project).toMatchObject({ id: f.target.project.id })
        expect(partial[1]!.project).toBeNull()
        expect(JSON.stringify(partial[1])).not.toContain('Confidential')
        expect(JSON.stringify(partial[1])).not.toContain(f.other.project.id)

        // With no other readable project every item is anonymous: drafts are neither shown nor counted.
        const anonymous = f.store.occupancy(
            f.context({
                roles: new Map([[f.source.project.id, 'viewer']]),
                contextProjectId: f.source.project.id,
            }),
            f.source.project.id,
            range
        )!
        expect(anonymous).toHaveLength(2)
        const text = JSON.stringify(anonymous)
        for (const secret of [
            'Visible launch',
            'Confidential plan',
            'Unscheduled draft',
            f.target.project.id,
            f.other.project.id,
            'Target',
        ])
            expect(text).not.toContain(secret)
        expect(anonymous.every(item => item.project === null)).toBe(true)

        // Own work is never reported back, and a caller without read access learns nothing.
        expect(
            f.store
                .occupancy(
                    f.context({
                        roles: new Map([[f.target.project.id, 'viewer']]),
                        contextProjectId: f.target.project.id,
                    }),
                    f.target.project.id,
                    range
                )!
                .map(item => item.at)
        ).toEqual([at + 3_600_000])
        expect(
            f.store.occupancy(
                f.context({ roles: new Map(), contextProjectId: f.source.project.id }),
                f.source.project.id,
                range
            )
        ).toBeNull()
        expect(() => f.store.occupancy(f.ctx, f.source.project.id, { from: 10, to: 10 })).toThrow()
    } finally {
        closeDatabase(f.database)
    }
})

it('configures cadence only through live management, defaults the timezone and rejects stale revisions', () => {
    const f = fixture()
    try {
        const input = {
            channelId: f.channel.id,
            expectedRevision: 0,
            dailyMax: 2,
            weeklyMax: 5,
            minimumIntervalMs: 60000,
        }
        expect(f.store.getCadence(f.ctx, f.channel.id)).toEqual({ rules: null, canManage: true })
        const target = f.context({
            roles: new Map([[f.target.project.id, 'owner']]),
            contextProjectId: f.target.project.id,
        })
        expect(f.store.configureCadence(target, input)).toBeNull()
        const saved = f.store.configureCadence(f.ctx, input)!
        expect(saved).toMatchObject({
            revision: 1,
            timeZone: f.source.project.timeZone,
            dailyMax: 2,
        })
        expect(() => f.store.configureCadence(f.ctx, input)).toThrow('changed')
        expect(() =>
            f.store.configureCadence(f.ctx, {
                ...input,
                expectedRevision: 1,
                timeZone: 'Invalid/Zone',
            })
        ).toThrow('timezone')
        expect(
            f.store.configureCadence(f.ctx, {
                ...input,
                expectedRevision: 1,
                dailyMax: null,
                weeklyMax: null,
                minimumIntervalMs: null,
            })
        ).toMatchObject({ revision: 2, dailyMax: null, weeklyMax: null, minimumIntervalMs: null })
    } finally {
        closeDatabase(f.database)
    }
})

it('checks planning atomically, binds confirmation to occupancy and replanning, and ignores drafts and cancellations', () => {
    const f = fixture()
    try {
        const manual = createManualStore(f.database, { now: () => f.now })
        const projectId = f.source.project.id
        const channelId = f.channel.id
        const at = f.now + 86400000
        const create = (scheduledAt: number | null, confirmation?: string) =>
            manual.createPost({
                projectId,
                subjectId: 'operator',
                title: 'Private title',
                sourceContent: { body: { format: 'plain_text', text: 'Private body' }, media: [] },
                cadenceConfirmation: confirmation,
                publications: [{ channelId, deliveryMode: 'manual', scheduledAt }],
            })!
        const first = create(at).publications[0]!
        f.store.configureCadence(f.ctx, {
            channelId,
            expectedRevision: 0,
            timeZone: 'Europe/Paris',
            dailyMax: 1,
            weeklyMax: 1,
            minimumIntervalMs: null,
        })
        create(null)
        const capture = (action: () => unknown) => {
            try {
                action()
                throw new Error('Expected cadence conflict')
            } catch (error) {
                expect(error).toBeInstanceOf(CadenceConflictError)
                return error as CadenceConflictError
            }
        }
        const before = f.database.$client
            .query<{ n: number }, []>('select count(*) as n from posts')
            .get()!.n
        const conflict = capture(() => create(at))
        expect(conflict.warnings.map(w => w.rule)).toEqual(['daily_max', 'weekly_max'])
        expect(JSON.stringify(conflict)).not.toContain('Private')
        expect(f.database.$client.query('select count(*) as n from posts').get()).toEqual({
            n: before,
        })
        const second = create(at, conflict.confirmation).publications[0]!
        expect(
            f.database.$client
                .query(
                    "select action from audit_events where action='publication.cadence_confirmed'"
                )
                .all()
        ).toHaveLength(1)
        const stale = capture(() => create(at, conflict.confirmation))
        expect(stale.confirmation).not.toBe(conflict.confirmation)
        manual.cancelPublications({ projectId, subjectId: 'operator', publicationIds: [second.id] })
        manual.reschedulePublications({
            projectId,
            subjectId: 'operator',
            publicationIds: [first.id],
            scheduledAt: at + 8 * 86400000,
        })
        expect(create(at).publications[0]!.scheduledAt).toBe(at)
        const reschedule = capture(() =>
            manual.reschedulePublications({
                projectId,
                subjectId: 'operator',
                publicationIds: [first.id],
                scheduledAt: at,
            })
        )
        expect(() =>
            manual.reschedulePublications({
                projectId,
                subjectId: 'operator',
                publicationIds: [first.id],
                scheduledAt: at + 1,
                cadenceConfirmation: reschedule.confirmation,
            })
        ).toThrow(CadenceConflictError)
        expect(
            manual.reschedulePublications({
                projectId,
                subjectId: 'operator',
                publicationIds: [first.id],
                scheduledAt: at,
                cadenceConfirmation: reschedule.confirmation,
            })
        ).toHaveLength(1)
    } finally {
        closeDatabase(f.database)
    }
})

it('uses civil days and Monday weeks across daylight saving and year boundaries', () => {
    expect(cadencePeriod(Date.parse('2027-01-03T23:30:00Z'), 'Europe/Paris')).toEqual({
        day: '2027-01-04',
        week: '2027-01-04',
    })
    expect(cadencePeriod(Date.parse('2027-01-01T12:00:00Z'), 'Europe/Paris')).toEqual({
        day: '2027-01-01',
        week: '2026-12-28',
    })
    expect(cadencePeriod(Date.parse('2026-10-25T00:30:00Z'), 'Europe/Paris')).toEqual(
        cadencePeriod(Date.parse('2026-10-25T01:30:00Z'), 'Europe/Paris')
    )
})

it('persists an attributed single-effect spacing override and invalidates it on replanning', () => {
    const f = fixture()
    try {
        const manual = createManualStore(f.database, { now: () => f.now })
        const projectId = f.source.project.id
        const at = f.now + 10000
        const created = manual.createPost({
            projectId,
            subjectId: 'operator',
            sourceContent: { body: { format: 'plain_text', text: 'Body' }, media: [] },
            publications: [{ channelId: f.channel.id, deliveryMode: 'manual', scheduledAt: at }],
        })!
        const publication = created.publications[0]!
        // The pacing service also serves automatic work without requiring a live provider in this fixture.
        f.database.$client
            .query("update publications set delivery_mode='automatic' where id=?")
            .run(publication.id)
        f.store.configureCadence(f.ctx, {
            channelId: f.channel.id,
            expectedRevision: 0,
            dailyMax: null,
            weeklyMax: null,
            minimumIntervalMs: 60000,
        })
        f.database.$client
            .query('update channel_cadence set last_effect_at=? where channel_id=?')
            .run(f.now, f.channel.id)
        const cadence = createChannelCadenceStore(f.database)
        const timing = cadence.timing(projectId, publication.id)!
        expect(timing).toMatchObject({
            reason: 'minimum_interval',
            eligibleAt: f.now + 60000,
            scheduledAt: at,
        })
        expect(() =>
            cadence.override.immediate({
                projectId,
                publicationId: publication.id,
                actorId: f.source.actor.id,
                now: f.now,
                confirmation: 'stale',
            })
        ).toThrow(CadenceConflictError)
        expect(
            cadence.override.immediate({
                projectId,
                publicationId: publication.id,
                actorId: f.source.actor.id,
                now: f.now,
                confirmation: timing.confirmation,
            })
        ).toMatchObject({ reason: null, eligibleAt: at })
        manual.reschedulePublications({
            projectId,
            subjectId: 'operator',
            publicationIds: [publication.id],
            scheduledAt: at,
        })
        expect(cadence.timing(projectId, publication.id)?.reason).toBe('minimum_interval')
        cadence.override.immediate({
            projectId,
            publicationId: publication.id,
            actorId: f.source.actor.id,
            now: f.now,
            confirmation: cadence.timing(projectId, publication.id)!.confirmation,
        })
        cadence.recordEffect(publication.id, f.now + 1)
        expect(cadence.timing(projectId, publication.id)?.eligibleAt).toBe(f.now + 60001)
    } finally {
        closeDatabase(f.database)
    }
})

it('counts shared manual work at its recorded outcome time without exposing its content', () => {
    const f = fixture()
    try {
        let now = f.now
        const manual = createManualStore(f.database, { now: () => now })
        const channelId = f.channel.id
        f.store.attach(f.ctx, { channelId, projectId: f.target.project.id, expectedRevision: 1 })
        const hidden = manual.createPost({
            projectId: f.target.project.id,
            subjectId: 'operator',
            title: 'Confidential campaign',
            sourceContent: {
                body: { format: 'plain_text', text: 'Confidential content' },
                media: [],
            },
            publications: [{ channelId, deliveryMode: 'manual', scheduledAt: now }],
        })!.publications[0]!
        now += 8 * 86400000
        expect(
            manual.publishManualPublication({
                projectId: f.target.project.id,
                publicationId: hidden.id,
                subjectId: 'operator',
            })?.publishedAt
        ).toBe(now)
        f.store.configureCadence(f.ctx, {
            channelId,
            expectedRevision: 0,
            dailyMax: 1,
            weeklyMax: null,
            minimumIntervalMs: 60000,
        })
        try {
            manual.createPost({
                projectId: f.source.project.id,
                subjectId: 'operator',
                sourceContent: { body: { format: 'plain_text', text: 'Source' }, media: [] },
                publications: [{ channelId, deliveryMode: 'manual', scheduledAt: now + 1 }],
            })
            throw new Error('Expected conflict')
        } catch (error) {
            expect(error).toBeInstanceOf(CadenceConflictError)
            expect((error as CadenceConflictError).warnings).toMatchObject([
                { rule: 'daily_max', count: 2 },
            ])
            expect(JSON.stringify(error)).not.toContain('Confidential')
            expect(JSON.stringify(error)).not.toContain(f.target.project.id)
        }
        expect(createChannelCadenceStore(f.database).eligibleAt(hidden.id, now)).toBe(now + 60000)
    } finally {
        closeDatabase(f.database)
    }
})
