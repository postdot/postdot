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
