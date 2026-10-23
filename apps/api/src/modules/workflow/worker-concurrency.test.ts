import { expect, test } from 'bun:test'

import {
    closeDatabase,
    createDatabase,
    createManualStore,
    createPublisherCredentialCipher,
    createPublisherCredentialStore,
    createPublisherStore,
    runMigrations,
} from '@postdot/db'
import { linkedinChannelProfile } from '@postdot/linkedin'

import { linkedInPublisherConnectionPolicy } from '../publishers/providers/linkedin'
import { createPublicationWorker } from './worker'

function gate() {
    let release!: () => void
    const promise = new Promise<void>(resolve => {
        release = resolve
    })
    return { promise, release }
}

async function fixture() {
    const database = createDatabase(':memory:')
    runMigrations(database)
    let creationTime = Date.now()
    const manual = createManualStore(database, { now: () => creationTime })
    const credentials = createPublisherCredentialStore(database, {
        cipher: createPublisherCredentialCipher({
            keyId: 'test',
            key: new Uint8Array(32).fill(11),
        }),
    })
    const publisherStore = createPublisherStore(database, {
        credentialRevoker: credentials,
        connectionPolicies: { linkedin: linkedInPublisherConnectionPolicy },
    })
    async function project(name: string) {
        const created = manual.createProject({
            name,
            subjectId: 'operator',
            displayName: 'Operator',
        })
        const id = created.project.id
        const channel = manual.createChannel({
            projectId: id,
            subjectId: 'operator',
            name,
            profile: linkedinChannelProfile,
        })!
        const credential = await credentials.createPublisherCredential({
            projectId: id,
            connectedByActorId: created.actor.id,
            providerId: 'linkedin',
            externalAccountId: name.replaceAll(' ', '-'),
            scopes: ['openid', 'profile', 'w_member_social'],
            accessToken: 'synthetic',
        })
        if (credential.kind !== 'created') throw new Error('Credential fixture failed')
        expect(
            publisherStore.createPublisherConnection({
                projectId: id,
                channelId: channel.id,
                subjectId: 'operator',
                kind: 'linkedin',
                credentialId: credential.credential.id,
            }).kind
        ).toBe('created')
        return {
            id,
            enqueue(text: string) {
                creationTime = Date.now()
                const result = manual.createPost({
                    projectId: id,
                    subjectId: 'operator',
                    sourceContent: { body: { text, format: 'plain_text' }, media: [] },
                    publications: [
                        {
                            channelId: channel.id,
                            deliveryMode: 'automatic',
                            scheduledAt: creationTime,
                        },
                    ],
                })
                expect(result).not.toBeNull()
                return result!.publications[0]!.id
            },
        }
    }
    return {
        database,
        project,
        options: { database, publisherStore, publisherCredentialStore: credentials },
    }
}

async function until(predicate: () => boolean) {
    const deadline = Date.now() + 3_000
    while (!predicate()) {
        if (Date.now() >= deadline)
            throw new Error('Expected dispatch did not occur within three seconds')
        await new Promise(resolve => setTimeout(resolve, 5))
    }
}

test('a blocked project retains one slot while another serves existing and newly arriving projects', async () => {
    const f = await fixture()
    const blocked = gate()
    const first = await f.project('Slow')
    const second = await f.project('Quiet')
    const starts: string[] = []
    const activeProjects = new Set<string>()
    let maximum = 0
    first.enqueue('slow')
    second.enqueue('quiet')
    const worker = createPublicationWorker({
        ...f.options,
        builtInProviderRegistry: {
            resolve: () => ({
                providerId: 'linkedin',
                contractId: 'linkedin',
                revision: 'test',
                async execute(input) {
                    expect(activeProjects.has(input.target.projectId)).toBe(false)
                    activeProjects.add(input.target.projectId)
                    maximum = Math.max(maximum, activeProjects.size)
                    const text = String(input.target.content.commentary)
                    starts.push(text)
                    try {
                        if (text === 'slow') await blocked.promise
                        return { type: 'published', externalId: text }
                    } finally {
                        activeProjects.delete(input.target.projectId)
                    }
                },
            }),
        },
    })
    const run = worker.processDueEvents(Date.now())
    try {
        await until(() => starts.includes('quiet') && starts.includes('slow'))
        first.enqueue('same-project-later')
        expect(starts).not.toContain('same-project-later')
        const arriving = await f.project('Arriving')
        arriving.enqueue('new-project')
        worker.replan()
        await until(() => starts.includes('new-project'))
        expect(maximum).toBe(2)
        blocked.release()
        await run
        expect(starts).toContain('same-project-later')
    } finally {
        blocked.release()
        await worker.stop()
        await run
        closeDatabase(f.database)
    }
})

test('stop drains both occupied slots and leaves pending work unclaimed', async () => {
    const f = await fixture()
    const blocked = gate()
    const projects = [await f.project('First'), await f.project('Second'), await f.project('Third')]
    for (const project of projects) project.enqueue(project.id)
    let started = 0
    const worker = createPublicationWorker({
        ...f.options,
        builtInProviderRegistry: {
            resolve: () => ({
                providerId: 'linkedin',
                contractId: 'linkedin',
                revision: 'test',
                async execute() {
                    started++
                    await blocked.promise
                    return { type: 'published' }
                },
            }),
        },
    })
    const run = worker.processDueEvents(Date.now())
    try {
        await until(() => started === 2)
        let stopped = false
        const stop = worker.stop().then(() => {
            stopped = true
        })
        await Promise.resolve()
        expect(stopped).toBe(false)
        blocked.release()
        await stop
        await run
        expect(started).toBe(2)
        expect(
            f.database.$client
                .query<{ count: number }, []>(
                    "SELECT count(*) AS count FROM jobs WHERE state = 'pending'"
                )
                .get()?.count
        ).toBe(1)
    } finally {
        blocked.release()
        await worker.stop()
        await run
        closeDatabase(f.database)
    }
})

test('replies and first comments share publication slots and cannot overlap another effect in their project', async () => {
    const f = await fixture()
    const blocked = gate()
    const first = await f.project('Reply project')
    const second = await f.project('Comment project')
    const third = await f.project('Publication project')
    first.enqueue('same-project-publication')
    third.enqueue('unrelated-publication')
    const activeProjects = new Set<string>()
    const starts: string[] = []
    let maximum = 0
    async function effect(projectId: string, kind: string) {
        expect(activeProjects.has(projectId)).toBe(false)
        activeProjects.add(projectId)
        maximum = Math.max(maximum, activeProjects.size)
        starts.push(kind)
        try {
            if (kind === 'reply') await blocked.promise
        } finally {
            activeProjects.delete(projectId)
        }
    }
    function service(projectId: string, kind: string) {
        let pending = true
        return {
            getNextEventAt: () => (pending ? Date.now() : null),
            async processDueEvent(id: string) {
                if (id !== projectId || !pending) return false
                pending = false
                await effect(id, kind)
                return true
            },
        }
    }
    const worker = createPublicationWorker({
        ...f.options,
        replies: service(first.id, 'reply'),
        firstComments: service(second.id, 'first-comment'),
        builtInProviderRegistry: {
            resolve: () => ({
                providerId: 'linkedin',
                contractId: 'linkedin',
                revision: 'test',
                async execute(input) {
                    await effect(input.target.projectId, String(input.target.content.commentary))
                    return { type: 'published' }
                },
            }),
        },
    })
    const run = worker.processDueEvents(Date.now())
    try {
        await until(
            () =>
                starts.includes('reply') &&
                starts.includes('first-comment') &&
                starts.includes('unrelated-publication')
        )
        expect(maximum).toBeLessThanOrEqual(2)
        expect(starts).toContain('same-project-publication')
    } finally {
        blocked.release()
        await run
        await worker.stop()
        closeDatabase(f.database)
    }
})

test('a publication backlog in concurrent projects cannot starve replies or first comments', async () => {
    const f = await fixture()
    const first = await f.project('Busy-first')
    const second = await f.project('Busy-second')
    for (let index = 0; index < 4; index++) {
        first.enqueue(`publication-${index}`)
        second.enqueue(`other-${index}`)
    }
    const starts: string[] = []
    function service(kind: string) {
        let pending = true
        return {
            getNextEventAt: () => (pending ? Date.now() : null),
            async processDueEvent(projectId: string) {
                if (projectId !== first.id || !pending) return false
                pending = false
                starts.push(kind)
                await new Promise(resolve => setTimeout(resolve, 5))
                return true
            },
        }
    }
    const worker = createPublicationWorker({
        ...f.options,
        replies: service('reply'),
        firstComments: service('first-comment'),
        builtInProviderRegistry: {
            resolve: () => ({
                providerId: 'linkedin',
                contractId: 'linkedin',
                revision: 'test',
                async execute(input) {
                    if (input.target.projectId === first.id)
                        starts.push(String(input.target.content.commentary))
                    await new Promise(resolve => setTimeout(resolve, 5))
                    return { type: 'published' }
                },
            }),
        },
    })
    try {
        await worker.processDueEvents(Date.now())
        expect(starts[0]).toStartWith('publication-')
        expect(starts.slice(1, 3)).toEqual(['reply', 'first-comment'])
        expect(starts).toHaveLength(6)
    } finally {
        await worker.stop()
        closeDatabase(f.database)
    }
})

test('an immediate local backlog yields to stop signals instead of draining in a microtask chain', async () => {
    const f = await fixture()
    const project = await f.project('Immediate-backlog')
    for (let index = 0; index < 10; index++) project.enqueue(`item-${index}`)
    let started = 0
    const worker = createPublicationWorker({
        ...f.options,
        builtInProviderRegistry: {
            resolve: () => ({
                providerId: 'linkedin',
                contractId: 'linkedin',
                revision: 'test',
                async execute() {
                    started++
                    return { type: 'published' }
                },
            }),
        },
    })
    const run = worker.processDueEvents(Date.now())
    const stopped = new Promise<void>((resolve, reject) => {
        setTimeout(() => {
            void worker.stop().then(resolve, reject)
        }, 0)
    })
    try {
        await stopped
        await run
        expect(started).toBeGreaterThan(0)
        expect(started).toBeLessThan(10)
    } finally {
        await worker.stop()
        await run
        closeDatabase(f.database)
    }
})
