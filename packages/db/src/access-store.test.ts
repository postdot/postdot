import { describe, expect, it } from 'bun:test'

import { closeDatabase, createAccessStore, createDatabase, runMigrations } from './index'

describe('instance access store', () => {
    it('claims a fresh instance once and gives the first user the admin role', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            database.$client
                .query(
                    `insert into user (id, name, email, email_verified, created_at, updated_at)
                     values ('user-1', 'Herald Operator', 'operator@herald.local', 0, 1, 1)`
                )
                .run()

            const access = createAccessStore(database)
            expect(access.getInstanceState()).toMatchObject({
                state: 'claimable',
                bootstrapBlocked: false,
            })

            const claimed = access.claimFirstAccount({ userId: 'user-1' })
            expect(claimed.kind).toBe('claimed')
            expect(access.isInstanceAdmin('user-1')).toBe(true)
            expect(access.claimFirstAccount({ userId: 'user-1' })).toEqual({
                kind: 'already_claimed',
            })
        } finally {
            closeDatabase(database)
        }
    })

    it('does not claim a database explicitly marked for orphan recovery', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            database.$client
                .query(`update instance_state set bootstrap_blocked = 1 where id = 'default'`)
                .run()

            const access = createAccessStore(database)
            expect(access.getInstanceState()).toMatchObject({
                state: 'claimable',
                bootstrapBlocked: true,
            })
            expect(access.isSignupAllowed()).toBe(false)
            expect(access.claimFirstAccount({ userId: 'recovery-user' })).toEqual({
                kind: 'already_claimed',
            })
        } finally {
            closeDatabase(database)
        }
    })
})
