import { describe, expect, it } from 'bun:test'

import { closeDatabase, createDatabase } from './client'
import { createManualStore } from './manual-store'
import { runMigrations } from './migrations'
import { createProjectAccessTokenStore } from './project-access-token-store'

const now = 1_800_000_000_000

function createFixture() {
    const database = createDatabase(':memory:')
    runMigrations(database)
    const manualStore = createManualStore(database, { now: () => now })
    const created = manualStore.createProject({
        name: 'Access test project',
        subjectId: 'human-1',
        displayName: 'Access tester',
    })
    const accessTokens = createProjectAccessTokenStore(database, {
        now: () => now,
        createId: (() => {
            let sequence = 0
            return () => `access-id-${++sequence}`
        })(),
        createToken: () => 'herald_pat_v1_test_token_with_enough_entropy',
    })

    return { accessTokens, database, manualStore, projectId: created.project.id }
}

describe('project access token store', () => {
    it('stores only a digest and returns the secret once', () => {
        const { accessTokens, database, manualStore, projectId } = createFixture()

        try {
            const created = accessTokens.create({
                projectId,
                subjectId: 'human-1',
                name: 'Deployment agent',
            })

            expect(created).toEqual({
                accessToken: {
                    id: 'access-id-1',
                    projectId,
                    name: 'Deployment agent',
                    tokenPrefix: 'herald_pat_v1_test_token_w',
                    expiresAt: null,
                    revokedAt: null,
                    createdAt: now,
                    updatedAt: now,
                },
                token: 'herald_pat_v1_test_token_with_enough_entropy',
            })

            const row = database.$client
                .query<
                    {
                        readonly token_hash: string
                        readonly token_prefix: string
                    },
                    [string]
                >(
                    'select token_hash, token_prefix from project_access_tokens where project_id = ?1'
                )
                .get(projectId)
            expect(row?.token_hash).toHaveLength(64)
            expect(row?.token_hash).not.toBe(created?.token)
            expect(row?.token_prefix).toBe('herald_pat_v1_test_token_w')

            const authenticated = accessTokens.authenticate(created?.token ?? '')
            expect(authenticated).toMatchObject({
                id: 'access-id-1',
                projectId,
                actorId: 'access-id-2',
                subjectId: 'api-token:access-id-1',
                displayName: 'API token: Deployment agent',
            })

            const channel = manualStore.createChannel({
                projectId,
                subjectId: authenticated?.subjectId ?? '',
                name: 'Agent channel',
            })
            expect(channel?.projectId).toBe(projectId)
        } finally {
            closeDatabase(database)
        }
    })

    it('rejects non-human token management and invalid expiry input at the store boundary', () => {
        const { accessTokens, database, projectId } = createFixture()

        try {
            expect(() =>
                accessTokens.create({
                    projectId,
                    subjectId: 'human-1',
                    name: 'Expired token',
                    expiresAt: now,
                })
            ).toThrow('expiresAt must be after now')
            expect(accessTokens.list(projectId, 'unknown-human')).toBeNull()
        } finally {
            closeDatabase(database)
        }
    })

    it('enforces expiry, revocation, project isolation, and idempotent revoke', () => {
        let currentTime = now
        const database = createDatabase(':memory:')
        runMigrations(database)
        const manualStore = createManualStore(database, { now: () => currentTime })
        const first = manualStore.createProject({
            name: 'First project',
            subjectId: 'human-1',
            displayName: 'First operator',
        })
        const second = manualStore.createProject({
            name: 'Second project',
            subjectId: 'human-2',
            displayName: 'Second operator',
        })
        let sequence = 0
        const accessTokens = createProjectAccessTokenStore(database, {
            now: () => currentTime,
            createId: () => `token-${++sequence}`,
            createToken: () => 'herald_pat_v1_isolation_token',
        })

        try {
            const created = accessTokens.create({
                projectId: first.project.id,
                subjectId: 'human-1',
                name: 'Short-lived agent',
                expiresAt: now + 1_000,
            })
            expect(created).not.toBeNull()
            expect(accessTokens.list(second.project.id, 'human-2')).toEqual([])
            expect(
                accessTokens.revoke({
                    projectId: second.project.id,
                    subjectId: 'human-2',
                    tokenId: created?.accessToken.id ?? '',
                })
            ).toBeNull()

            currentTime = now + 1_000
            expect(accessTokens.authenticate(created?.token ?? '')).toBeNull()

            currentTime = now
            const revoked = accessTokens.revoke({
                projectId: first.project.id,
                subjectId: 'human-1',
                tokenId: created?.accessToken.id ?? '',
            })
            expect(revoked?.revokedAt).toBe(now)
            expect(accessTokens.authenticate(created?.token ?? '')).toBeNull()
            expect(
                accessTokens.revoke({
                    projectId: first.project.id,
                    subjectId: 'human-1',
                    tokenId: created?.accessToken.id ?? '',
                })
            ).toEqual(revoked)
        } finally {
            closeDatabase(database)
        }
    })
})
