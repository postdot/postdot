import { describe, expect, it } from 'bun:test'

import { closeTestDatabase, openTestDatabase } from '@postdot/db/testing'

import { postdotSqlAdapter } from './sql-adapter'

interface UserRow {
    readonly id: string
    readonly name: string
    readonly email: string
    readonly emailVerified: boolean
    readonly createdAt: Date
    readonly banned: boolean | null
}

async function withAdapter(
    run: (adapter: ReturnType<ReturnType<typeof postdotSqlAdapter>>) => Promise<void>
) {
    const { database } = await openTestDatabase()
    try {
        const adapter = postdotSqlAdapter(database)({
            user: { additionalFields: { banned: { type: 'boolean', required: false } } },
        })
        await run(adapter)
    } finally {
        await closeTestDatabase(database)
    }
}

async function seed(adapter: ReturnType<ReturnType<typeof postdotSqlAdapter>>) {
    for (const [index, name] of ['Alice Martin', 'bob stone', 'Carol Martin'].entries()) {
        await adapter.create({
            model: 'user',
            data: {
                id: `user-${index}`,
                name,
                email: `${name.split(' ')[0]!.toLowerCase()}@postdot.local`,
                emailVerified: index === 0,
                createdAt: new Date(1_800_000_000_000 + index),
                updatedAt: new Date(1_800_000_000_000 + index),
            },
            forceAllowId: true,
        })
    }
}

describe('Better Auth on the persistence port', () => {
    it('round-trips dates and booleans', async () => {
        await withAdapter(async adapter => {
            await seed(adapter)
            const user = await adapter.findOne<UserRow>({
                model: 'user',
                where: [{ field: 'email', value: 'alice@postdot.local' }],
            })
            expect(user?.emailVerified).toBe(true)
            expect(user?.createdAt).toEqual(new Date(1_800_000_000_000))
            const verified = await adapter.findMany<UserRow>({
                model: 'user',
                where: [{ field: 'emailVerified', value: false }],
                sortBy: { field: 'createdAt', direction: 'desc' },
            })
            expect(verified.map(row => row.id)).toEqual(['user-2', 'user-1'])
        })
    })

    it('applies Better Auth operators with portable semantics', async () => {
        await withAdapter(async adapter => {
            await seed(adapter)
            const ids = async (where: Parameters<typeof adapter.findMany>[0]['where']) =>
                (
                    await adapter.findMany<UserRow>({
                        model: 'user',
                        where,
                        sortBy: { field: 'id', direction: 'asc' },
                    })
                ).map(row => row.id)

            // Pattern operators are case-sensitive unless the mode says otherwise.
            expect(await ids([{ field: 'name', operator: 'contains', value: 'martin' }])).toEqual(
                []
            )
            expect(
                await ids([
                    { field: 'name', operator: 'contains', value: 'martin', mode: 'insensitive' },
                ])
            ).toEqual(['user-0', 'user-2'])
            expect(await ids([{ field: 'name', operator: 'starts_with', value: 'bob' }])).toEqual([
                'user-1',
            ])
            expect(await ids([{ field: 'name', operator: 'ends_with', value: 'Martin' }])).toEqual([
                'user-0',
                'user-2',
            ])
            expect(
                await ids([{ field: 'name', operator: 'ends_with', value: 'x Alice Martin' }])
            ).toEqual([])
            expect(
                await ids([{ field: 'email', value: 'ALICE@postdot.local', mode: 'insensitive' }])
            ).toEqual(['user-0'])
            expect(
                await ids([{ field: 'id', operator: 'in', value: ['user-0', 'user-2'] }])
            ).toEqual(['user-0', 'user-2'])
            expect(await ids([{ field: 'id', operator: 'in', value: [] }])).toEqual([])
            expect(await ids([{ field: 'id', operator: 'not_in', value: ['user-1'] }])).toEqual([
                'user-0',
                'user-2',
            ])
            expect(
                await ids([
                    { field: 'createdAt', operator: 'gte', value: new Date(1_800_000_000_001) },
                    { field: 'id', value: 'user-0', connector: 'OR' },
                    { field: 'id', value: 'user-1', connector: 'OR' },
                ])
            ).toEqual(['user-1'])
            expect(await ids([{ field: 'image', operator: 'ne', value: null }])).toEqual([])
            expect(
                await adapter.count({
                    model: 'user',
                    where: [{ field: 'name', operator: 'contains', value: 'Martin' }],
                })
            ).toBe(2)
        })
    })

    it('updates, consumes and deletes rows', async () => {
        await withAdapter(async adapter => {
            await seed(adapter)
            const updated = await adapter.update<UserRow>({
                model: 'user',
                where: [{ field: 'id', value: 'user-1' }],
                update: { name: 'Bob Stone', emailVerified: true },
            })
            expect(updated).toMatchObject({ id: 'user-1', name: 'Bob Stone', emailVerified: true })
            expect(
                await adapter.updateMany({
                    model: 'user',
                    where: [{ field: 'emailVerified', value: true }],
                    update: { image: 'avatar' },
                })
            ).toBe(2)
            expect(
                await adapter.deleteMany({
                    model: 'user',
                    where: [{ field: 'name', operator: 'ends_with', value: 'Martin' }],
                })
            ).toBe(2)
            expect(await adapter.count({ model: 'user' })).toBe(1)
        })
    })

    it('rolls back a Better Auth transaction as a whole', async () => {
        await withAdapter(async adapter => {
            await seed(adapter)
            await expect(
                adapter.transaction(async transaction => {
                    await transaction.delete({
                        model: 'user',
                        where: [{ field: 'id', value: 'user-0' }],
                    })
                    throw new Error('abort')
                })
            ).rejects.toThrow('abort')
            expect(await adapter.count({ model: 'user' })).toBe(3)
        })
    })

    it('refuses fields outside the Better Auth schema', async () => {
        await withAdapter(async adapter => {
            await expect(
                adapter.findMany({
                    model: 'user',
                    sortBy: { field: 'name; drop table user', direction: 'asc' },
                })
            ).rejects.toThrow()
        })
    })
})
