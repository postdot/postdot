import { expect, it } from 'bun:test'

import { closeDatabase, createDatabase } from './client'
import { createEventJournalStore } from './event-journal-store'
import { createManualStore } from './manual-store'
import { runMigrations } from './migrations'
import { createNotificationStore } from './notification-store'
import { createWorkspaceActorStore } from './workspace-actor-store'

function fixture() {
    const database = createDatabase(':memory:')
    runMigrations(database)
    for (const id of ['first', 'second']) {
        database.$client
            .query('insert into organization (id,name,slug,created_at) values (?,?,?,100)')
            .run(id, id, id)
        database.$client
            .query(
                'insert into workspaces (id,organization_id,name,slug,created_at,updated_at) values (?,?,?,?,100,100)'
            )
            .run(id, id, id, id)
    }
    const manual = createManualStore(database)
    const source = manual.createProject({
        name: 'Origin',
        subjectId: 'owner',
        displayName: 'Owner',
        workspaceId: 'first',
    })
    const actors = createWorkspaceActorStore(database, { now: () => 200 })
    const journal = createEventJournalStore(database)
    const actor = actors.ensureFromProjectActor({
        workspaceId: 'first',
        projectActorId: source.actor.id,
    })!
    const fact = {
        workspaceId: 'first',
        actorId: actor.id,
        name: 'channel.sharing.changed',
        version: 1,
        subject: { type: 'channel', id: 'example' },
        payload: { reason: 'test' },
        occurredAt: 201,
    }
    return { database, manual, source, actors, actor, journal, fact }
}

it('keeps workspace attribution and facts after deleting the source project without granting project access', () => {
    const f = fixture()
    try {
        expect(f.actor).toMatchObject({
            workspaceId: 'first',
            originActorId: f.source.actor.id,
            kind: 'human',
            subjectId: 'owner',
            displayName: 'Owner',
            createdAt: 200,
        })
        expect(
            f.actors.ensureFromProjectActor({
                workspaceId: 'first',
                projectActorId: f.source.actor.id,
            })
        ).toEqual(f.actor)
        const fact = f.journal.appendWorkspace(f.fact)
        expect(f.journal.readWorkspaceAfter({ workspaceId: 'first' })).toEqual([fact])
        expect(f.journal.readWorkspaceAfter({ workspaceId: 'second' })).toEqual([])
        expect(
            f.journal
                .readAfter({ projectId: f.source.project.id })
                .every(event => event.actorId !== f.actor.id)
        ).toBe(true)
        f.database.$client.query('delete from projects where id=?').run(f.source.project.id)
        expect(f.actors.get('first', f.actor.id)).toEqual(f.actor)
        expect(f.actors.get('second', f.actor.id)).toBeNull()
        expect(f.journal.readWorkspaceAfter({ workspaceId: 'first' })).toEqual([fact])
        expect(f.journal.readAfter({ projectId: f.source.project.id })).toEqual([])
        expect(f.manual.listProjects('owner')).toEqual([])
        expect(createNotificationStore(f.database).listProjectIdsForUser('owner')).toEqual([])
        expect(f.database.$client.query('pragma foreign_key_check').all()).toEqual([])
    } finally {
        closeDatabase(f.database)
    }
})

it('rejects mixed scopes, missing scopes, foreign workspace actors and fabricated source attribution', () => {
    const f = fixture()
    try {
        expect(
            f.actors.ensureFromProjectActor({
                workspaceId: 'second',
                projectActorId: f.source.actor.id,
            })
        ).toBeNull()
        expect(
            f.actors.ensureFromProjectActor({ workspaceId: 'first', projectActorId: f.actor.id })
        ).toBeNull()
        expect(
            f.actors.ensureFromProjectActor({ workspaceId: 'first', projectActorId: 'missing' })
        ).toBeNull()
        expect(() => f.journal.appendWorkspace({ ...f.fact, actorId: f.source.actor.id })).toThrow()
        expect(() => f.journal.appendWorkspace({ ...f.fact, workspaceId: 'second' })).toThrow()
        expect(() =>
            f.journal.append({ ...f.fact, projectId: f.source.project.id, actorId: f.actor.id })
        ).toThrow()
        const actorInsert = f.database.$client.query(
            "insert into actors (id, project_id, workspace_id,kind,display_name) values (?,?,?,'system','System')"
        )
        expect(() => actorInsert.run('mixed', f.source.project.id, 'first')).toThrow()
        expect(() => actorInsert.run('none', null, null)).toThrow()
        const factInsert = f.database.$client.query(
            "insert into audit_events (id,project_id,workspace_id,actor_id,action,entity_type,entity_id) values (?,?,?,?,'test','test','test')"
        )
        expect(() => factInsert.run('mixed', f.source.project.id, 'first', f.actor.id)).toThrow()
        expect(() => factInsert.run('none', null, null, f.actor.id)).toThrow()
        expect(f.journal.readWorkspaceAfter({ workspaceId: 'first' })).toEqual([])
    } finally {
        closeDatabase(f.database)
    }
})

it('rolls back attribution and workspace facts with the surrounding state transaction', () => {
    const f = fixture()
    try {
        const second = f.manual.createProject({
            name: 'Other',
            workspaceId: 'first',
            subjectId: 'other',
            displayName: 'Other',
        })
        expect(() =>
            f.database.$client
                .transaction(() => {
                    const actor = f.actors.ensureFromProjectActor({
                        workspaceId: 'first',
                        projectActorId: second.actor.id,
                    })!
                    f.journal.appendWorkspace({ ...f.fact, actorId: actor.id })
                    throw new Error('Abort state transition')
                })
                .immediate()
        ).toThrow('Abort state transition')
        expect(
            f.database.$client
                .query('select id from actors where origin_actor_id=?')
                .all(second.actor.id)
        ).toEqual([])
        expect(f.journal.readWorkspaceAfter({ workspaceId: 'first' })).toEqual([])
    } finally {
        closeDatabase(f.database)
    }
})

it('shares one ordered cursor stream while filtering project and workspace facts separately', () => {
    const f = fixture()
    try {
        const projectFact = f.journal.append({
            ...f.fact,
            projectId: f.source.project.id,
            actorId: f.source.actor.id,
        })
        const workspaceFact = f.journal.appendWorkspace(f.fact)
        const later = f.journal.append({
            ...f.fact,
            projectId: f.source.project.id,
            actorId: f.source.actor.id,
        })
        expect(f.journal.readAllAfter({ after: projectFact.cursor, limit: 1 })).toEqual([
            workspaceFact,
        ])
        expect(
            f.journal.readAfter({ projectId: f.source.project.id, after: projectFact.cursor })
        ).toEqual([later])
        expect(
            f.journal.readWorkspaceAfter({ workspaceId: 'first', after: projectFact.cursor })
        ).toEqual([workspaceFact])
        expect(f.journal.latestCursor()).toEqual(later.cursor)
        expect(() => f.journal.readWorkspaceAfter({ workspaceId: 'first', limit: 0 })).toThrow()
        expect(() => f.journal.appendWorkspace({ ...f.fact, version: 0 })).toThrow()
        expect(() =>
            f.journal.appendWorkspace({ ...f.fact, payload: { notJson: new Date() } })
        ).toThrow()
    } finally {
        closeDatabase(f.database)
    }
})

it('retires workspace actors after dependent facts and never reuses the deleted fact cursor', () => {
    const f = fixture()
    try {
        const fact = f.journal.appendWorkspace(f.fact)
        f.database.$client.query('delete from projects where id=?').run(f.source.project.id)
        f.database.$client.query('delete from workspaces where id=?').run('first')
        expect(f.actors.get('first', f.actor.id)).toBeNull()
        expect(f.journal.readWorkspaceAfter({ workspaceId: 'first' })).toEqual([])
        expect(f.journal.latestCursor()).toBe(fact.cursor)
        const source = f.manual.createProject({
            name: 'Survivor',
            subjectId: 'owner',
            displayName: 'Owner',
            workspaceId: 'second',
        })
        const actor = f.actors.ensureFromProjectActor({
            workspaceId: 'second',
            projectActorId: source.actor.id,
        })!
        const next = f.journal.appendWorkspace({
            ...f.fact,
            workspaceId: 'second',
            actorId: actor.id,
        })
        expect(Number(next.cursor.split(':')[1])).toBeGreaterThan(Number(fact.cursor.split(':')[1]))
        expect(f.database.$client.query('pragma foreign_key_check').all()).toEqual([])
    } finally {
        closeDatabase(f.database)
    }
})
