import { expect, test } from 'bun:test'

import { closeTestDatabase, openTestDatabase, testEngine } from '../testing'
import { createPublicationReadStore } from './publication-read-store'

test('keeps publication authorization and its read in one database snapshot', async () => {
    const database = (await openTestDatabase()).database
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const store = createPublicationReadStore(database, {
        async loadActor() {
            // Authorization and the publication read share one transaction snapshot.
            expect(database.sql.inTransaction()).toBe(true)
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
        // SQLite's writer gate makes other flows wait for the open transaction;
        // PostgreSQL gives them the last committed snapshot instead.
        if (testEngine === 'sqlite') expect(outsideFinished).toBe(false)
        release.resolve()
        expect(await read).toBeNull()
        await outside
        expect(outsideFinished).toBe(true)
    } finally {
        release.resolve()
        await Promise.allSettled([read, outside])
        await closeTestDatabase(database)
    }
})
