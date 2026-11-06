import { expect, test } from 'bun:test'

import { closeDatabase, createDatabase } from '../client'
import { createPublicationReadStore } from './publication-read-store'

test('keeps publication authorization and its read in one database snapshot', async () => {
    const database = createDatabase(':memory:')
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const store = createPublicationReadStore(database, {
        async loadActor() {
            entered.resolve()
            await release.promise
            return null
        },
        loadPublication: async () => null,
        loadChannel: async () => null,
        loadProfile: async () => null,
    })
    let read: Promise<unknown> | undefined
    let outside: Promise<unknown> | undefined
    try {
        read = store.api.getPublicationWorkingDraft('project', 'publication', 'subject')
        await entered.promise
        let outsideFinished = false
        outside = database.sql
            .statement('select 1')
            .get()
            .then(value => {
                outsideFinished = true
                return value
            })
        await new Promise<void>(resolve => setTimeout(resolve, 0))
        expect(outsideFinished).toBe(false)
        release.resolve()
        expect(await read).toBeNull()
        await outside
        expect(outsideFinished).toBe(true)
    } finally {
        release.resolve()
        await Promise.allSettled([read, outside])
        closeDatabase(database)
    }
})
