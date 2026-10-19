import { expect, test } from 'bun:test'

import { createRealtimeRefreshQueue, type RefreshScope } from './realtime-refresh'

test('a publication signal during a project read refreshes editors after that read', async () => {
    const reads: RefreshScope[] = []
    let release = () => {}
    const blocked = new Promise<void>(resolve => {
        release = resolve
    })
    const refresh = createRealtimeRefreshQueue(async (_key, scope) => {
        reads.push(scope)
        if (reads.length === 1) await blocked
    })
    const first = refresh('project')
    await Promise.resolve()
    const publication = refresh('project', false, true)
    release()
    await Promise.all([first, publication])
    expect(reads).toEqual([
        { full: false, includePublicationEditors: false },
        { full: false, includePublicationEditors: true },
    ])
})

test('reconnect scope is retained and a later event gets a fresh read', async () => {
    let release = () => {}
    const blocked = new Promise<void>(resolve => {
        release = resolve
    })
    const reads: RefreshScope[] = []
    const refresh = createRealtimeRefreshQueue(async (_key, scope) => {
        reads.push(scope)
        if (reads.length === 1) await blocked
    })
    const first = refresh('project', false, true)
    await Promise.resolve()
    void refresh('project', true)
    void refresh('project')
    release()
    await first
    expect(reads[1]).toEqual({ full: true, includePublicationEditors: true })
    await refresh('project')
    expect(reads[2]).toEqual({ full: false, includePublicationEditors: false })
})

test('a failed read releases its key for recovery', async () => {
    let fail = true
    const refresh = createRealtimeRefreshQueue(async () => {
        if (fail) throw new Error('read failed')
    })
    await expect(refresh('project')).rejects.toThrow('read failed')
    fail = false
    await refresh('project')
})

test('a blocked project does not serialize another project or leak its scope', async () => {
    let releaseA = () => {}
    const blockedA = new Promise<void>(resolve => {
        releaseA = resolve
    })
    let signalAStarted = () => {}
    const aReadStarted = new Promise<void>(resolve => {
        signalAStarted = resolve
    })
    const reads: Record<'a' | 'b', RefreshScope[]> = { a: [], b: [] }
    const refresh = createRealtimeRefreshQueue(async (key, scope) => {
        if (key !== 'a' && key !== 'b') throw new Error('Unexpected project key')
        reads[key].push(scope)
        if (key === 'a' && reads.a.length === 1) {
            signalAStarted()
            await blockedA
        }
    })
    try {
        const firstA = refresh('a', true, false)
        await aReadStarted
        expect(reads.a).toEqual([{ full: true, includePublicationEditors: false }])

        const projectB = refresh('b', false, true)
        await projectB
        expect(reads.b).toEqual([{ full: false, includePublicationEditors: true }])
        expect(reads.a).toEqual([{ full: true, includePublicationEditors: false }])

        const overlappingA = refresh('a', true, true)
        releaseA()
        await Promise.all([firstA, projectB, overlappingA])
        expect(reads.a).toEqual([
            { full: true, includePublicationEditors: false },
            { full: true, includePublicationEditors: true },
        ])
        expect(reads.b).toEqual([{ full: false, includePublicationEditors: true }])
    } finally {
        releaseA()
    }
})

test('an event during the replay read triggers a third read with the merged scope', async () => {
    let serverState = 'one'
    let cachedState = 'one'
    let releaseFirst = () => {}
    const firstBlocked = new Promise<void>(resolve => {
        releaseFirst = resolve
    })
    let releaseSecond = () => {}
    const secondBlocked = new Promise<void>(resolve => {
        releaseSecond = resolve
    })
    let secondStarted = () => {}
    const secondReadStarted = new Promise<void>(resolve => {
        secondStarted = resolve
    })
    const reads: RefreshScope[] = []
    const refresh = createRealtimeRefreshQueue(async (_key, scope) => {
        reads.push(scope)
        const snapshot = serverState
        if (reads.length === 1) await firstBlocked
        if (reads.length === 2) {
            secondStarted()
            await secondBlocked
        }
        cachedState = snapshot
    })
    const first = refresh('project')
    await Promise.resolve()
    serverState = 'two'
    void refresh('project', false, true)
    releaseFirst()
    await secondReadStarted
    serverState = 'three'
    void refresh('project', true)
    releaseSecond()
    await first
    expect(reads).toEqual([
        { full: false, includePublicationEditors: false },
        { full: false, includePublicationEditors: true },
        { full: true, includePublicationEditors: true },
    ])
    expect(cachedState).toBe('three')
})

test('an event during the final read cannot leave the cached state behind the server', async () => {
    let serverState = 'queued'
    let cachedState = 'queued'
    let release = () => {}
    const blocked = new Promise<void>(resolve => {
        release = resolve
    })
    let reads = 0
    const refresh = createRealtimeRefreshQueue(async () => {
        const snapshot = serverState
        reads++
        if (reads === 1) await blocked
        cachedState = snapshot
    })
    const first = refresh('project', false, true)
    await Promise.resolve()
    serverState = 'published'
    const completed = refresh('project', false, true)
    release()
    await Promise.all([first, completed])
    expect(cachedState).toBe('published')
    expect(reads).toBe(2)
})
