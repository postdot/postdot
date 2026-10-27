import { describe, expect, it, spyOn } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createAuth } from '@postdot/auth'
import { closeDatabase, createAccessStore, createDatabase, runMigrations } from '@postdot/db'

import { runLocalAccountPasswordRecovery } from './local-account-recovery'

const baseURL = 'http://localhost:3000'
const secret = 'postdot-test-secret-with-at-least-32-characters'
const headers = { 'content-type': 'application/json', origin: baseURL }

describe('local account recovery command', () => {
    it('resets an existing Better Auth password and rejects its previous password', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'postdot-local-account-recovery-'))
        const databaseFilename = join(directory, 'postdot.sqlite')
        const originalPassword = 'original-password-123'
        const recoveredPassword = 'recovered-password-456'
        const initialDatabase = createDatabase(databaseFilename)
        runMigrations(initialDatabase)
        const auth = createAuth(initialDatabase, {
            baseURL,
            secret,
            access: createAccessStore(initialDatabase),
        })

        try {
            const signup = await auth.handler(
                new Request(`${baseURL}/api/auth/sign-up/email`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        email: 'recovery@postdot.local',
                        name: 'Recovery User',
                        password: originalPassword,
                    }),
                })
            )
            expect(signup.status).toBe(200)
        } finally {
            closeDatabase(initialDatabase)
        }

        const promptAnswers = [
            databaseFilename,
            'recovery@postdot.local',
            recoveredPassword,
            recoveredPassword,
        ]
        const prompt = async () => {
            const answer = promptAnswers.shift()
            if (answer === undefined) throw new Error('Unexpected additional recovery prompt')
            return answer
        }
        const log = spyOn(console, 'log').mockImplementation(() => undefined)

        try {
            await runLocalAccountPasswordRecovery(
                ['account', 'recover-password', '--database', databaseFilename],
                prompt
            )
            expect(promptAnswers).toHaveLength(0)
        } finally {
            log.mockRestore()
        }

        const recoveredDatabase = createDatabase(databaseFilename)
        try {
            runMigrations(recoveredDatabase)
            const recoveredAuth = createAuth(recoveredDatabase, {
                baseURL,
                secret,
                access: createAccessStore(recoveredDatabase),
            })
            const oldPasswordResponse = await recoveredAuth.handler(
                new Request(`${baseURL}/api/auth/sign-in/email`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        email: 'recovery@postdot.local',
                        password: originalPassword,
                    }),
                })
            )
            const newPasswordResponse = await recoveredAuth.handler(
                new Request(`${baseURL}/api/auth/sign-in/email`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        email: 'recovery@postdot.local',
                        password: recoveredPassword,
                    }),
                })
            )

            expect(oldPasswordResponse.status).not.toBe(200)
            expect(newPasswordResponse.status).toBe(200)
        } finally {
            closeDatabase(recoveredDatabase)
            await rm(directory, { recursive: true, force: true })
        }
    })

    it('stops before requesting credentials when the database confirmation is wrong', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'postdot-local-account-recovery-'))
        const databaseFilename = join(directory, 'postdot.sqlite')
        const database = createDatabase(databaseFilename)
        runMigrations(database)
        closeDatabase(database)
        let promptCount = 0

        try {
            await expect(
                runLocalAccountPasswordRecovery(
                    ['account', 'recover-password', '--database', databaseFilename],
                    async () => {
                        promptCount += 1
                        return '/another/database.sqlite'
                    }
                )
            ).rejects.toThrow('confirmation did not match')
            expect(promptCount).toBe(1)
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })

    it('requires exactly one explicit database path and rejects unknown options', async () => {
        const prompt = async () => {
            throw new Error('The terminal must not be prompted for invalid arguments')
        }

        await expect(
            runLocalAccountPasswordRecovery(
                [
                    'account',
                    'recover-password',
                    '--database',
                    '/tmp/one.sqlite',
                    '--database',
                    '/tmp/two.sqlite',
                ],
                prompt
            )
        ).rejects.toThrow('exactly one explicit')
        await expect(
            runLocalAccountPasswordRecovery(
                [
                    'account',
                    'recover-password',
                    '--database',
                    '/tmp/postdot.sqlite',
                    '--password',
                    'unsafe',
                ],
                prompt
            )
        ).rejects.toThrow('Unknown account recovery option')
    })
})
