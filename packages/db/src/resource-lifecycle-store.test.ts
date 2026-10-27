import { expect, it } from 'bun:test'

import { createDatabase, closeDatabase } from './client'
import { createManualStore } from './manual-store'
import { runMigrations } from './migrations'
import { createResourceLifecycleStore } from './resource-lifecycle-store'
import { seedTestWorkspace } from './testing'

it('archives and restores a project, then deletes its SQL data while retaining a receipt', () => {
    const db = createDatabase(':memory:')
    try {
        runMigrations(db)
        const manual = createManualStore(db)
        const { project } = manual.createProject({
            workspaceId: seedTestWorkspace(db),
            name: 'Disposable',
            subjectId: 'operator',
            displayName: 'Operator',
        })
        const lifecycle = createResourceLifecycleStore(db)
        const original = lifecycle.impact('project', project.id)!
        const archive = lifecycle.mutate({
            kind: 'project',
            id: project.id,
            action: 'archive',
            actorId: 'operator',
            fingerprint: original.fingerprint,
            authorize: () => true,
        })
        expect(archive.state).toBe('archived')
        expect(manual.listProjects('operator')).toHaveLength(1)
        const restored = lifecycle.mutate({
            kind: 'project',
            id: project.id,
            action: 'restore',
            actorId: 'operator',
            fingerprint: archive.fingerprint,
            authorize: () => true,
        })
        expect(restored.state).toBe('active')
        expect(() =>
            lifecycle.mutate({
                kind: 'project',
                id: project.id,
                action: 'delete',
                actorId: 'operator',
                fingerprint: original.fingerprint,
                confirmName: project.name,
                authorize: () => true,
            })
        ).toThrow('Resource changed')
        const removed = lifecycle.mutate({
            kind: 'project',
            id: project.id,
            action: 'delete',
            actorId: 'operator',
            fingerprint: restored.fingerprint,
            confirmName: project.name,
            authorize: () => true,
        })
        expect(removed.state).toBe('deleted')
        expect(manual.listProjects('operator')).toHaveLength(0)
    } finally {
        closeDatabase(db)
    }
})

it('cancels scheduled work explicitly and restores without rescheduling', () => {
    const db = createDatabase(':memory:')
    try {
        runMigrations(db)
        const manual = createManualStore(db)
        const { project } = manual.createProject({
            workspaceId: seedTestWorkspace(db),
            name: 'Scheduled',
            subjectId: 'operator',
            displayName: 'Operator',
        })
        const channel = manual.createChannel({
            projectId: project.id,
            subjectId: 'operator',
            name: 'Manual',
        })!
        manual.createPost({
            projectId: project.id,
            subjectId: 'operator',
            sourceContent: { body: { format: 'plain_text', text: 'Preserved content' }, media: [] },
            publications: [{ channelId: channel.id, scheduledAt: Date.now() + 60_000 }],
        })
        const lifecycle = createResourceLifecycleStore(db)
        const before = lifecycle.impact('project', project.id)!
        expect(before.pending).toBe(1)
        expect(() =>
            lifecycle.mutate({
                kind: 'project',
                id: project.id,
                action: 'archive',
                actorId: 'operator',
                fingerprint: before.fingerprint,
                authorize: () => true,
            })
        ).toThrow('Confirm cancellation')
        expect(lifecycle.state('project', project.id)).toBe('active')
        const archived = lifecycle.mutate({
            kind: 'project',
            id: project.id,
            action: 'archive',
            actorId: 'operator',
            fingerprint: before.fingerprint,
            cancelPending: true,
            authorize: () => true,
        })
        expect(archived.state).toBe('archived')
        expect(db.$client.query('select state from publications').get()).toEqual({
            state: 'cancelled',
        })
        expect(() =>
            manual.createPost({
                projectId: project.id,
                subjectId: 'operator',
                sourceContent: { body: { format: 'plain_text', text: 'Rejected' }, media: [] },
                publications: [],
            })
        ).toThrow()
        lifecycle.mutate({
            kind: 'project',
            id: project.id,
            action: 'restore',
            actorId: 'operator',
            fingerprint: archived.fingerprint,
            authorize: () => true,
        })
        expect(db.$client.query('select state from publications').get()).toEqual({
            state: 'cancelled',
        })
        expect(db.$client.query('select count(*) as n from posts').get()).toEqual({ n: 1 })
    } finally {
        closeDatabase(db)
    }
})

it('waits for an admitted request and retries failed object deletion after restart without losing ownership', async () => {
    const { createMediaAssetStore } = await import('./media-asset-store')
    const { createLocalMediaStore } = await import('@postdot/media')
    const { mkdtemp, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const root = await mkdtemp(join(tmpdir(), 'postdot-resource-cleanup-'))
    let db = createDatabase(join(root, 'instance.sqlite'))
    try {
        runMigrations(db)
        const manual = createManualStore(db)
        const { project } = manual.createProject({
            workspaceId: seedTestWorkspace(db),
            name: 'With media',
            subjectId: 'operator',
            displayName: 'Operator',
        })
        const lifecycle = createResourceLifecycleStore(db)
        const storage = createLocalMediaStore({
            rootDirectory: root,
            storeId: 'owned-store',
            maxObjectBytes: 1024 * 1024,
        })
        const media = createMediaAssetStore(db, lifecycle.wrapMedia(storage))
        const reservation = media.reserveUpload({
            projectId: project.id,
            subjectId: 'operator',
            originalFilename: 'owned.txt',
        })!
        await storage.put(reservation.representation.objectKey, new Blob(['owned bytes']).stream())
        const release = lifecycle.beginRequest(project.id)
        const impact = lifecycle.impact('project', project.id)!
        const result = lifecycle.mutate({
            kind: 'project',
            id: project.id,
            action: 'delete',
            actorId: 'operator',
            fingerprint: impact.fingerprint,
            confirmName: project.name,
            authorize: () => true,
        })
        expect(result.state).toBe('deleting')
        expect(manual.listProjects('operator')).toHaveLength(1)
        release()
        let attempts = 0
        const failing = {
            storeId: storage.storeId,
            maxObjectBytes: storage.maxObjectBytes,
            put: storage.put.bind(storage),
            open: storage.open.bind(storage),
            stat: storage.stat.bind(storage),
            async delete() {
                attempts++
                throw new Error('Synthetic storage outage')
            },
        }
        await lifecycle.reconcile(failing)
        expect(attempts).toBe(1)
        expect(manual.listProjects('operator')).toHaveLength(0)
        expect(lifecycle.state('project', project.id)).toBe('deleting')
        expect(
            db.$client.query('select count(*) as n from resource_cleanup_objects').get()
        ).toEqual({ n: 1 })
        expect(await storage.stat(reservation.representation.objectKey)).not.toBeNull()
        closeDatabase(db)
        db = createDatabase(join(root, 'instance.sqlite'))
        runMigrations(db)
        const restarted = createResourceLifecycleStore(db)
        await restarted.reconcile({ ...failing, storeId: 'different-store' })
        expect(
            db.$client.query('select count(*) as n from resource_cleanup_objects').get()
        ).toEqual({ n: 1 })
        db.$client
            .query(
                'insert into media_backup_fences (id,owner_id,expires_at,created_at,updated_at) values (1,?,?,?,?)'
            )
            .run('test-backup', Date.now() + 60_000, Date.now(), Date.now())
        await restarted.reconcile(storage)
        expect(await storage.stat(reservation.representation.objectKey)).not.toBeNull()
        db.$client.run('delete from media_backup_fences')
        await restarted.reconcile(storage)
        expect(restarted.state('project', project.id)).toBe('deleted')
        expect(await storage.stat(reservation.representation.objectKey)).toBeNull()
        expect(
            db.$client.query('select count(*) as n from resource_lifecycle_events').get()
        ).toEqual({ n: 1 })
        expect(() =>
            db.$client.query('insert into projects(id,name) values (?,?)').run(project.id, 'Reused')
        ).toThrow('resource_identity_reserved')
    } finally {
        closeDatabase(db)
        await rm(root, { recursive: true, force: true })
    }
})

it('permanently deletes scheduled work with selected targets through the lifecycle boundary', () => {
    const database = createDatabase(':memory:')
    try {
        runMigrations(database)
        const manual = createManualStore(database)
        const { project } = manual.createProject({
            workspaceId: seedTestWorkspace(database),
            name: 'Scheduled retirement',
            subjectId: 'operator',
            displayName: 'Operator',
        })
        const channel = manual.createChannel({
            projectId: project.id,
            subjectId: 'operator',
            name: 'Manual',
        })!
        manual.createPost({
            projectId: project.id,
            subjectId: 'operator',
            sourceContent: { body: { format: 'plain_text', text: 'Retained content' }, media: [] },
            publications: [
                {
                    channelId: channel.id,
                    deliveryMode: 'manual',
                    scheduledAt: Date.now() + 86400000,
                },
            ],
        })
        const lifecycle = createResourceLifecycleStore(database)
        const impact = lifecycle.impact('project', project.id)!
        lifecycle.mutate({
            kind: 'project',
            id: project.id,
            action: 'delete',
            actorId: 'operator',
            fingerprint: impact.fingerprint,
            confirmName: project.name,
            cancelPending: true,
            authorize: () => true,
        })
        expect(lifecycle.state('project', project.id)).toBe('deleted')
        expect(database.$client.query('pragma foreign_key_check').all()).toEqual([])
    } finally {
        closeDatabase(database)
    }
})

it('retires an image graph with derived previews and queues every object before deleting SQL ownership', async () => {
    const { createMediaAssetStore } = await import('./media-asset-store')
    const { previewFixturePng } = await import('./image-preview-fixture')
    const { createLocalMediaStore } = await import('@postdot/media')
    const { mkdtemp, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const root = await mkdtemp(join(tmpdir(), 'postdot-derived-retirement-'))
    const database = createDatabase(':memory:')
    try {
        runMigrations(database)
        const manual = createManualStore(database)
        const { project } = manual.createProject({
            workspaceId: seedTestWorkspace(database),
            name: 'Image graph',
            subjectId: 'operator',
            displayName: 'Operator',
        })
        const storage = createLocalMediaStore({
            rootDirectory: root,
            storeId: 'derived',
            maxObjectBytes: 2000000,
        })
        const media = createMediaAssetStore(database, storage)
        const bytes = previewFixturePng(40, 30)
        const reservation = media.reserveUpload({
            projectId: project.id,
            subjectId: 'operator',
            originalFilename: 'retained.png',
            contentType: 'image/png',
            expectedSize: bytes.length,
        })!
        await media.upload({
            projectId: project.id,
            subjectId: 'operator',
            intentId: reservation.intent.id,
            source: new Blob([bytes]).stream(),
        })
        expect(
            (
                await media.finalizeUpload({
                    projectId: project.id,
                    subjectId: 'operator',
                    intentId: reservation.intent.id,
                })
            ).kind
        ).toBe('ready')
        const representations = media.getAsset(
            project.id,
            reservation.asset.id,
            'operator'
        )!.representations
        expect(
            representations.filter(item => item.sourceRepresentationId !== null).length
        ).toBeGreaterThan(0)
        const lifecycle = createResourceLifecycleStore(database)
        lifecycle.mutate({
            kind: 'project',
            id: project.id,
            action: 'delete',
            actorId: 'operator',
            fingerprint: lifecycle.impact('project', project.id)!.fingerprint,
            confirmName: project.name,
            authorize: () => true,
        })
        expect(
            database.$client.query('select id from projects where id=?').get(project.id)
        ).toBeNull()
        expect(
            database.$client.query('select count(*) as count from resource_cleanup_objects').get()
        ).toEqual({ count: representations.length })
        expect(database.$client.query('pragma foreign_key_check').all()).toEqual([])
        expect(database.$client.query('pragma foreign_keys').get()).toEqual({ foreign_keys: 1 })
        expect(database.$client.query('pragma defer_foreign_keys').get()).toEqual({
            defer_foreign_keys: 0,
        })
        await createResourceLifecycleStore(database).reconcile(storage)
        expect(lifecycle.state('project', project.id)).toBe('deleted')
        for (const representation of representations)
            expect(await storage.stat(representation.objectKey)).toBeNull()
    } finally {
        closeDatabase(database)
        await rm(root, { recursive: true, force: true })
    }
})

it('rolls back retirement and retains foreign-key enforcement when a dependency survives the deletion graph', () => {
    const database = createDatabase(':memory:')
    try {
        runMigrations(database)
        const manual = createManualStore(database)
        const { project } = manual.createProject({
            workspaceId: seedTestWorkspace(database),
            name: 'Protected',
            subjectId: 'operator',
            displayName: 'Operator',
        })
        database.$client.exec(
            'create table retirement_guard(project_id text references projects(id) on delete restrict)'
        )
        database.$client.query('insert into retirement_guard values (?)').run(project.id)
        const lifecycle = createResourceLifecycleStore(database)
        const input = {
            kind: 'project' as const,
            id: project.id,
            action: 'delete' as const,
            actorId: 'operator',
            fingerprint: lifecycle.impact('project', project.id)!.fingerprint,
            confirmName: project.name,
            authorize: () => true,
        }
        expect(() => lifecycle.mutate(input)).toThrow('FOREIGN KEY')
        expect(lifecycle.state('project', project.id)).toBe('active')
        expect(
            database.$client.query('select id from projects where id=?').get(project.id)
        ).toEqual({ id: project.id })
        expect(database.$client.query('select * from resource_lifecycle_events').all()).toEqual([])
        expect(database.$client.query('pragma foreign_keys').get()).toEqual({ foreign_keys: 1 })
        expect(database.$client.query('pragma defer_foreign_keys').get()).toEqual({
            defer_foreign_keys: 0,
        })
        database.$client.exec('delete from retirement_guard')
        lifecycle.mutate(input)
        expect(lifecycle.state('project', project.id)).toBe('deleted')
    } finally {
        closeDatabase(database)
    }
})
