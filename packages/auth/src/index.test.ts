import { describe, expect, it } from 'bun:test'

import { closeDatabase, createDatabase, runMigrations } from '@herald/db'

import { createAuth } from './index'

const baseURL = 'http://localhost:3000'
const secret = 'herald-test-secret-with-at-least-32-characters'

function createFixture() {
    const database = createDatabase(':memory:')
    runMigrations(database)

    return {
        auth: createAuth(database, { baseURL, secret }),
        database,
    }
}

describe('Herald authentication', () => {
    it('exposes Better Auth through its standard health endpoint', async () => {
        const { auth, database } = createFixture()

        try {
            const response = await auth.handler(new Request(`${baseURL}/api/auth/ok`))

            expect(response.status).toBe(200)
            expect(await response.json()).toEqual({ ok: true })
        } finally {
            closeDatabase(database)
        }
    })

    it('creates an email account and resolves its session through HTTP', async () => {
        const { auth, database } = createFixture()

        try {
            const signUpResponse = await auth.handler(
                new Request(`${baseURL}/api/auth/sign-up/email`, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        origin: baseURL,
                    },
                    body: JSON.stringify({
                        email: 'operator@herald.local',
                        name: 'Herald Operator',
                        password: 'correct-horse-battery-staple',
                    }),
                })
            )

            expect(signUpResponse.status).toBe(200)

            const signUpBody = (await signUpResponse.json()) as {
                user: { email: string; name: string }
            }
            expect(signUpBody.user).toMatchObject({
                email: 'operator@herald.local',
                name: 'Herald Operator',
            })

            const sessionCookie = signUpResponse.headers.get('set-cookie')?.split(';', 1)[0]
            expect(sessionCookie).toBeDefined()

            const sessionResponse = await auth.handler(
                new Request(`${baseURL}/api/auth/get-session`, {
                    headers: {
                        cookie: sessionCookie ?? '',
                    },
                })
            )

            expect(sessionResponse.status).toBe(200)
            const sessionBody = (await sessionResponse.json()) as {
                user: { email: string }
            }
            expect(sessionBody.user.email).toBe('operator@herald.local')
        } finally {
            closeDatabase(database)
        }
    })

    it('exposes only the email and password strategy', () => {
        const { database } = createFixture()
        const configured = createAuth(database, { baseURL, secret })

        try {
            expect(configured.options.emailAndPassword?.enabled).toBe(true)
            expect(Object.hasOwn(configured.options, 'socialProviders')).toBe(false)
        } finally {
            closeDatabase(database)
        }
    })
})
