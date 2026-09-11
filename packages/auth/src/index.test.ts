import { describe, expect, it } from 'bun:test'

import {
    closeDatabase,
    createAccessStore,
    createDatabase,
    createManualStore,
    runMigrations,
} from '@herald/db'

import { createAuth } from './index'

const baseURL = 'http://localhost:3000'
const secret = 'herald-test-secret-with-at-least-32-characters'

function createFixture(options: { readonly allowAdditionalSignups?: boolean } = {}) {
    const database = createDatabase(':memory:')
    runMigrations(database)
    const access = createAccessStore(database)

    return {
        auth: createAuth(database, {
            baseURL,
            secret,
            access,
            allowAdditionalSignups: options.allowAdditionalSignups,
        }),
        access,
        database,
        manualStore: createManualStore(database, { now: Date.now }),
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

    it('gives the bootstrap account admin capabilities and supports organization API keys', async () => {
        const { auth, database } = createFixture()
        const headers = {
            'content-type': 'application/json',
            origin: baseURL,
        }

        try {
            const signUpResponse = await auth.handler(
                new Request(`${baseURL}/api/auth/sign-up/email`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        email: 'owner@herald.local',
                        name: 'Herald Owner',
                        password: 'correct-horse-battery-staple',
                    }),
                })
            )
            expect(signUpResponse.status).toBe(200)

            const signUpBody = (await signUpResponse.json()) as { user: { id: string } }
            expect(
                database.$client
                    .query<{ role: string | null }, [string]>('select role from user where id = ?1')
                    .get(signUpBody.user.id)
            ).toEqual({ role: 'admin' })

            const sessionCookie = signUpResponse.headers.get('set-cookie')?.split(';', 1)[0]
            expect(sessionCookie).toBeDefined()
            const adminResponse = await auth.handler(
                new Request(`${baseURL}/api/auth/admin/list-users?limit=10`, {
                    headers: { cookie: sessionCookie ?? '' },
                })
            )
            expect(adminResponse.status).toBe(200)
            expect(await adminResponse.json()).toMatchObject({
                users: [expect.objectContaining({ id: signUpBody.user.id })],
            })

            const unguardedRoleMutation = await auth.handler(
                new Request(`${baseURL}/api/auth/admin/set-role`, {
                    method: 'POST',
                    headers: {
                        ...headers,
                        cookie: sessionCookie ?? '',
                    },
                    body: JSON.stringify({ userId: signUpBody.user.id, role: 'user' }),
                })
            )
            expect(unguardedRoleMutation.status).toBe(403)

            const unguardedApiKeyMutation = await auth.handler(
                new Request(`${baseURL}/api/auth/api-key/create`, {
                    method: 'POST',
                    headers: {
                        ...headers,
                        cookie: sessionCookie ?? '',
                    },
                    body: JSON.stringify({
                        name: 'Unbound key must be rejected',
                        organizationId: 'not-a-herald-project',
                    }),
                })
            )
            expect(unguardedApiKeyMutation.status).toBe(403)

            const organization = await auth.api.createOrganization({
                body: {
                    name: 'Herald Project',
                    slug: 'herald-project-test',
                    userId: signUpBody.user.id,
                },
            })
            const createdKey = await auth.api.createApiKey({
                body: {
                    name: 'CI key',
                    organizationId: organization.id,
                    userId: signUpBody.user.id,
                    expiresIn: 24 * 60 * 60,
                },
            })
            expect(createdKey.key).toMatch(/^herald_pat_/)
            expect(createdKey.expiresAt).toBeInstanceOf(Date)

            const verified = await auth.api.verifyApiKey({ body: { key: createdKey.key } })
            expect(verified).toMatchObject({
                valid: true,
                key: { referenceId: organization.id },
            })

            const listed = await auth.api.listApiKeys({
                query: { organizationId: organization.id },
                headers: new Headers({ cookie: sessionCookie ?? '' }),
            })
            expect(listed.total).toBe(1)
            expect(listed.apiKeys[0]).toMatchObject({
                id: createdKey.id,
                name: 'CI key',
                referenceId: organization.id,
            })
        } finally {
            closeDatabase(database)
        }
    })

    it('uses organization invitations with Better Auth roles and expiry', async () => {
        const { auth, database } = createFixture()
        const headers = {
            'content-type': 'application/json',
            origin: baseURL,
        }

        try {
            const ownerSignup = await auth.handler(
                new Request(`${baseURL}/api/auth/sign-up/email`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        email: 'organization-owner@herald.local',
                        name: 'Organization Owner',
                        password: 'correct-horse-battery-staple',
                    }),
                })
            )
            expect(ownerSignup.status).toBe(200)
            const owner = (await ownerSignup.json()) as { user: { id: string } }
            const ownerCookie = ownerSignup.headers.get('set-cookie')?.split(';', 1)[0] ?? ''

            const organization = await auth.api.createOrganization({
                body: {
                    name: 'Invitation Project',
                    slug: 'invitation-project-test',
                    userId: owner.user.id,
                },
            })
            const invitation = await auth.api.createInvitation({
                body: {
                    email: 'organization-member@herald.local',
                    role: 'editor',
                    organizationId: organization.id,
                },
                headers: new Headers({ cookie: ownerCookie }),
            })

            expect(invitation).toMatchObject({
                email: 'organization-member@herald.local',
                organizationId: organization.id,
                role: 'editor',
                status: 'pending',
            })
            expect(invitation.expiresAt.getTime()).toBeGreaterThan(Date.now())

            const memberSignup = await auth.handler(
                new Request(`${baseURL}/api/auth/sign-up/email`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        email: 'organization-member@herald.local',
                        name: 'Organization Member',
                        password: 'correct-horse-battery-staple',
                    }),
                })
            )
            expect(memberSignup.status).toBe(200)
            const memberCookie = memberSignup.headers.get('set-cookie')?.split(';', 1)[0] ?? ''

            const accepted = await auth.api.acceptInvitation({
                body: { invitationId: invitation.id },
                headers: new Headers({ cookie: memberCookie }),
            })
            expect(accepted).toMatchObject({
                invitation: { id: invitation.id, status: 'accepted' },
                member: { organizationId: organization.id, role: 'editor' },
            })
        } finally {
            closeDatabase(database)
        }
    })

    it('keeps the Herald project projection aligned with native organization membership changes', async () => {
        const { access, auth, database, manualStore } = createFixture({
            allowAdditionalSignups: true,
        })
        const headers = {
            'content-type': 'application/json',
            origin: baseURL,
        }

        try {
            const ownerSignup = await auth.handler(
                new Request(`${baseURL}/api/auth/sign-up/email`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        email: 'native-organization-owner@herald.local',
                        name: 'Native Organization Owner',
                        password: 'correct-horse-battery-staple',
                    }),
                })
            )
            const memberSignup = await auth.handler(
                new Request(`${baseURL}/api/auth/sign-up/email`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        email: 'native-organization-member@herald.local',
                        name: 'Native Organization Member',
                        password: 'correct-horse-battery-staple',
                    }),
                })
            )
            expect(ownerSignup.status).toBe(200)
            expect(memberSignup.status).toBe(200)

            const owner = (await ownerSignup.json()) as { user: { id: string } }
            const member = (await memberSignup.json()) as { user: { id: string } }
            const ownerCookie = ownerSignup.headers.get('set-cookie')?.split(';', 1)[0] ?? ''
            const memberCookie = memberSignup.headers.get('set-cookie')?.split(';', 1)[0] ?? ''
            const organization = await auth.api.createOrganization({
                body: {
                    name: 'Native Organization Project',
                    slug: 'native-organization-project-test',
                    userId: owner.user.id,
                },
            })
            const project = manualStore.createProject({
                name: 'Native organization project',
                subjectId: owner.user.id,
                displayName: 'Native Organization Owner',
                organizationId: organization.id,
            })
            expect(
                access.ensureProjectOwnerMembership({
                    projectId: project.project.id,
                    userId: owner.user.id,
                })
            ).not.toBeNull()

            const added = await auth.api.addMember({
                body: {
                    userId: member.user.id,
                    role: 'editor',
                    organizationId: organization.id,
                },
            })
            expect(added).toMatchObject({
                organizationId: organization.id,
                userId: member.user.id,
                role: 'editor',
            })
            expect(access.canAccessProject(project.project.id, member.user.id, 'editor')).toBe(true)
            expect(manualStore.listProjects(member.user.id)).toEqual([
                expect.objectContaining({ id: project.project.id }),
            ])

            await auth.api.updateMemberRole({
                body: {
                    memberId: added.id,
                    role: 'viewer',
                    organizationId: organization.id,
                },
                headers: new Headers({ cookie: ownerCookie }),
            })
            expect(access.canAccessProject(project.project.id, member.user.id, 'editor')).toBe(
                false
            )
            expect(access.canAccessProject(project.project.id, member.user.id, 'viewer')).toBe(true)

            await auth.api.removeMember({
                body: {
                    memberIdOrEmail: added.id,
                    organizationId: organization.id,
                },
                headers: new Headers({ cookie: ownerCookie }),
            })
            expect(access.canAccessProject(project.project.id, member.user.id)).toBe(false)
            expect(access.getProjectMembership(project.project.id, member.user.id)).toBeNull()

            const readded = await auth.api.addMember({
                body: {
                    userId: member.user.id,
                    role: 'viewer',
                    organizationId: organization.id,
                },
            })
            await auth.api.leaveOrganization({
                body: { organizationId: organization.id },
                headers: new Headers({ cookie: memberCookie }),
            })
            expect(readded.userId).toBe(member.user.id)
            // `leaveOrganization` has no projection hook in Better Auth 1.7;
            // access still follows the deleted Better Auth member row.
            expect(access.canAccessProject(project.project.id, member.user.id)).toBe(false)
        } finally {
            closeDatabase(database)
        }
    })

    it('closes public signup after bootstrap while keeping the first account usable', async () => {
        const { auth, database } = createFixture()
        const headers = {
            'content-type': 'application/json',
            origin: baseURL,
        }
        const password = 'correct-horse-battery-staple'

        try {
            const firstSignup = await auth.handler(
                new Request(`${baseURL}/api/auth/sign-up/email`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        email: 'first@herald.local',
                        name: 'First Herald Operator',
                        password,
                    }),
                })
            )
            expect(firstSignup.status).toBe(200)

            const secondSignup = await auth.handler(
                new Request(`${baseURL}/api/auth/sign-up/email`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        email: 'second@herald.local',
                        name: 'Second Herald Operator',
                        password,
                    }),
                })
            )
            expect(secondSignup.status).toBe(400)
            expect(await secondSignup.json()).toMatchObject({
                code: 'FAILED_TO_CREATE_USER',
            })

            const signIn = await auth.handler(
                new Request(`${baseURL}/api/auth/sign-in/email`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        email: 'first@herald.local',
                        password,
                    }),
                })
            )
            expect(signIn.status).toBe(200)
            expect(await signIn.json()).toMatchObject({
                user: { email: 'first@herald.local' },
            })
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
