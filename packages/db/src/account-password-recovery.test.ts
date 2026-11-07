import { expect, it } from 'bun:test'

import { recoverAccountPasswordInDatabase } from './local-account-recovery'
import { closeTestDatabase, insertRow, openTestDatabase } from './testing'

const at = { createdAt: 1, updatedAt: 1 }

it('resets one credential, revokes its sessions and reset links in one transaction', async () => {
    const { database } = await openTestDatabase()
    try {
        await insertRow(database, 'user', [
            { id: 'owner', name: 'Owner', email: 'Owner@Example.test', ...at },
            { id: 'other', name: 'Other', email: 'other@example.test', ...at },
        ])
        await insertRow(database, 'account', [
            {
                id: 'owner-credential',
                accountId: 'owner',
                providerId: 'credential',
                userId: 'owner',
                password: 'old',
                ...at,
            },
            {
                id: 'other-credential',
                accountId: 'other',
                providerId: 'credential',
                userId: 'other',
                password: 'kept',
                ...at,
            },
        ])
        await insertRow(database, 'session', [
            { id: 's1', token: 't1', userId: 'owner', expiresAt: Date.now() + 60_000, ...at },
            { id: 's2', token: 't2', userId: 'other', expiresAt: Date.now() + 60_000, ...at },
        ])
        await insertRow(database, 'verification', [
            {
                id: 'v1',
                identifier: 'reset-password:abc',
                value: 'owner',
                expiresAt: Date.now() + 60_000,
                ...at,
            },
        ])

        const result = await recoverAccountPasswordInDatabase(database, {
            email: ' owner@example.test ',
            passwordHash: 'new-hash',
        })

        expect(result).toEqual({
            email: 'owner@example.test',
            revokedSessionCount: 1,
            invalidatedResetTokenCount: 1,
        })
        const passwords = await database.sql
            .statement<{ id: string; password: string }>(
                'select id, password from account order by id'
            )
            .all()
        expect(passwords).toEqual([
            { id: 'other-credential', password: 'kept' },
            { id: 'owner-credential', password: 'new-hash' },
        ])
        expect(await database.sql.statement('select id from session').all()).toEqual([{ id: 's2' }])
        await expect(
            recoverAccountPasswordInDatabase(database, {
                email: 'missing@example.test',
                passwordHash: 'x',
            })
        ).rejects.toThrow('No Postdot account')
    } finally {
        await closeTestDatabase(database)
    }
})
