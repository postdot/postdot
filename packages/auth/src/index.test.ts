import { describe, expect, it } from 'bun:test'

import {
    closeDatabase,
    createAccessStore,
    createDatabase,
    createManualStore,
    runMigrations,
} from '@postbot/db'
import { verifyPassword } from 'better-auth/crypto'

import {
    createAuth,
    hashPostbotPassword,
    postbotUserApiKeyConfigId,
    postbotPasswordPolicy,
    type PostbotAuthRuntimeOptions,
    type PostbotAuthVerificationEmail,
    type PostbotOrganizationInvitationEmail,
} from './index'

const baseURL = 'http://localhost:3000'
const secret = 'postbot-test-secret-with-at-least-32-characters'

function createFixture(
    options: Pick<
        PostbotAuthRuntimeOptions,
        | 'allowAdditionalSignups'
        | 'organizationInvitationURL'
        | 'requireEmailVerificationOnInvitation'
        | 'sendOrganizationInvitationEmail'
        | 'sendEmailVerification'
        | 'sendEmailVerificationOnSignUp'
        | 'sendPasswordResetEmail'
    > = {}
) {
    const database = createDatabase(':memory:')
    runMigrations(database)
    const access = createAccessStore(database)

    return {
        auth: createAuth(database, {
            baseURL,
            secret,
            access,
            allowAdditionalSignups: options.allowAdditionalSignups,
            organizationInvitationURL: options.organizationInvitationURL,
            requireEmailVerificationOnInvitation: options.requireEmailVerificationOnInvitation,
            sendOrganizationInvitationEmail: options.sendOrganizationInvitationEmail,
            sendEmailVerification: options.sendEmailVerification,
            sendEmailVerificationOnSignUp: options.sendEmailVerificationOnSignUp,
            sendPasswordResetEmail: options.sendPasswordResetEmail,
        }),
        access,
        database,
        manualStore: createManualStore(database, { now: Date.now }),
    }
}

describe('Postbot authentication', () => {
    it('uses Better Auth password hashes for offline recovery', async () => {
        const password = 'recovered-password-123'
        const hash = await hashPostbotPassword(password)

        expect(hash).not.toBe(password)
        expect(await verifyPassword({ hash, password })).toBe(true)
        expect(await verifyPassword({ hash, password: 'different-password-123' })).toBe(false)
    })

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
                        email: 'operator@postbot.local',
                        name: 'Postbot Operator',
                        password: 'correct-horse-battery-staple',
                    }),
                })
            )

            expect(signUpResponse.status).toBe(200)

            const signUpBody = (await signUpResponse.json()) as {
                user: { email: string; name: string }
            }
            expect(signUpBody.user).toMatchObject({
                email: 'operator@postbot.local',
                name: 'Postbot Operator',
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
            expect(sessionBody.user.email).toBe('operator@postbot.local')
        } finally {
            closeDatabase(database)
        }
    })

    it('gives the bootstrap account admin capabilities and supports user API keys', async () => {
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
                        email: 'owner@postbot.local',
                        name: 'Postbot Owner',
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
                        organizationId: 'not-a-postbot-project',
                    }),
                })
            )
            expect(unguardedApiKeyMutation.status).toBe(403)

            const unguardedOrganizationMutation = await auth.handler(
                new Request(`${baseURL}/api/auth/organization/invite-member`, {
                    method: 'POST',
                    headers: {
                        ...headers,
                        cookie: sessionCookie ?? '',
                    },
                    body: JSON.stringify({
                        email: 'bypass@postbot.local',
                        role: 'viewer',
                        organizationId: 'not-a-postbot-project',
                    }),
                })
            )
            expect(unguardedOrganizationMutation.status).toBe(403)

            const createdKey = await auth.api.createApiKey({
                body: {
                    name: 'CI key',
                    configId: postbotUserApiKeyConfigId,
                    userId: signUpBody.user.id,
                    expiresIn: 24 * 60 * 60,
                    metadata: {
                        postbotApiKeyVersion: 2,
                        postbotProjectAccess: 'all',
                    },
                },
            })
            expect(createdKey.key).toMatch(/^postbot_pat_/)
            expect(createdKey.expiresAt).toBeInstanceOf(Date)

            const verified = await auth.api.verifyApiKey({ body: { key: createdKey.key } })
            expect(verified).toMatchObject({
                valid: true,
                key: { configId: postbotUserApiKeyConfigId, referenceId: signUpBody.user.id },
            })

            const listed = await auth.api.listApiKeys({
                query: { configId: postbotUserApiKeyConfigId },
                headers: new Headers({ cookie: sessionCookie ?? '' }),
            })
            expect(listed.total).toBe(1)
            expect(listed.apiKeys[0]).toMatchObject({
                id: createdKey.id,
                name: 'CI key',
                referenceId: signUpBody.user.id,
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
                        email: 'organization-owner@postbot.local',
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
                    email: 'organization-member@postbot.local',
                    role: 'editor',
                    organizationId: organization.id,
                },
                headers: new Headers({ cookie: ownerCookie }),
            })

            expect(invitation).toMatchObject({
                email: 'organization-member@postbot.local',
                organizationId: organization.id,
                role: 'editor',
                status: 'pending',
            })
            expect(invitation.expiresAt.getTime()).toBeGreaterThan(Date.now())

            const reissuedInvitation = await auth.api.createInvitation({
                body: {
                    email: 'organization-member@postbot.local',
                    role: 'editor',
                    organizationId: organization.id,
                },
                headers: new Headers({ cookie: ownerCookie }),
            })
            expect(reissuedInvitation.id).not.toBe(invitation.id)
            expect(reissuedInvitation.status).toBe('pending')
            expect(
                (
                    await auth.api.listInvitations({
                        query: { organizationId: organization.id },
                        headers: new Headers({ cookie: ownerCookie }),
                    })
                ).filter(
                    candidate =>
                        candidate.email === 'organization-member@postbot.local' &&
                        candidate.status === 'pending'
                )
            ).toEqual([expect.objectContaining({ id: reissuedInvitation.id })])

            const memberSignup = await auth.handler(
                new Request(`${baseURL}/api/auth/sign-up/email`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        email: 'organization-member@postbot.local',
                        name: 'Organization Member',
                        password: 'correct-horse-battery-staple',
                    }),
                })
            )
            expect(memberSignup.status).toBe(200)
            const memberCookie = memberSignup.headers.get('set-cookie')?.split(';', 1)[0] ?? ''

            const accepted = await auth.api.acceptInvitation({
                body: { invitationId: reissuedInvitation.id },
                headers: new Headers({ cookie: memberCookie }),
            })
            expect(accepted).toMatchObject({
                invitation: { id: reissuedInvitation.id, status: 'accepted' },
                member: { organizationId: organization.id, role: 'editor' },
            })
        } finally {
            closeDatabase(database)
        }
    })

    it('forwards optional organization invitation delivery through a deployment hook', async () => {
        const deliveries: PostbotOrganizationInvitationEmail[] = []
        const { auth, database } = createFixture({
            organizationInvitationURL: ({ id, organizationId }) =>
                `https://app.example.test/invitations/${id}?organizationId=${organizationId}`,
            sendOrganizationInvitationEmail: delivery => {
                deliveries.push(delivery)
            },
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
                        email: 'invitation-sender@postbot.local',
                        name: 'Invitation Sender',
                        password: 'correct-horse-battery-staple',
                    }),
                })
            )
            expect(ownerSignup.status).toBe(200)
            const owner = (await ownerSignup.json()) as { user: { id: string } }
            const ownerCookie = ownerSignup.headers.get('set-cookie')?.split(';', 1)[0] ?? ''

            const organization = await auth.api.createOrganization({
                body: {
                    name: 'Delivery Hook Project',
                    slug: 'delivery-hook-project-test',
                    userId: owner.user.id,
                },
            })
            const invitation = await auth.api.createInvitation({
                body: {
                    email: 'invitation-recipient@postbot.local',
                    role: 'viewer',
                    organizationId: organization.id,
                },
                headers: new Headers({ cookie: ownerCookie }),
            })

            expect(invitation.status).toBe('pending')
            expect(deliveries).toHaveLength(1)
            expect(deliveries[0]).toMatchObject({
                id: invitation.id,
                email: 'invitation-recipient@postbot.local',
                organizationId: organization.id,
                organizationName: 'Delivery Hook Project',
                inviterId: owner.user.id,
                inviterEmail: 'invitation-sender@postbot.local',
                inviterName: 'Invitation Sender',
                invitationURL: `https://app.example.test/invitations/${invitation.id}?organizationId=${organization.id}`,
            })
            expect(deliveries[0]?.expiresAt).toEqual(invitation.expiresAt)
        } finally {
            closeDatabase(database)
        }
    })

    it('forwards account verification and password reset delivery through deployment hooks', async () => {
        const verificationDeliveries: PostbotAuthVerificationEmail[] = []
        const resetDeliveries: PostbotAuthVerificationEmail[] = []
        const { auth, database } = createFixture({
            sendEmailVerificationOnSignUp: true,
            sendEmailVerification: delivery => {
                verificationDeliveries.push(delivery)
            },
            sendPasswordResetEmail: delivery => {
                resetDeliveries.push(delivery)
            },
        })
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
                        email: 'verification-recipient@postbot.local',
                        name: 'Verification Recipient',
                        password: 'correct-horse-battery-staple',
                    }),
                })
            )
            expect(signUpResponse.status).toBe(200)
            const signUp = (await signUpResponse.json()) as { user: { id: string } }
            expect(verificationDeliveries).toHaveLength(1)
            expect(verificationDeliveries[0]).toMatchObject({
                user: {
                    email: 'verification-recipient@postbot.local',
                    name: 'Verification Recipient',
                },
            })
            expect(verificationDeliveries[0]?.url).toContain('/api/auth/verify-email?')

            const resetResponse = await auth.handler(
                new Request(`${baseURL}/api/auth/request-password-reset`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        email: 'verification-recipient@postbot.local',
                        redirectTo: 'https://app.example.test/reset-password',
                    }),
                })
            )
            expect(resetResponse.status).toBe(200)
            expect(resetDeliveries).toHaveLength(1)
            expect(resetDeliveries[0]).toMatchObject({
                user: { email: 'verification-recipient@postbot.local' },
            })
            expect(resetDeliveries[0]?.url).toContain('/api/auth/reset-password/')
            expect(signUp.user.id).toBeTruthy()
        } finally {
            closeDatabase(database)
        }
    })

    it('returns the same reset response for known and unknown email addresses', async () => {
        const deliveries: PostbotAuthVerificationEmail[] = []
        const { auth, database } = createFixture({
            sendPasswordResetEmail: delivery => {
                deliveries.push(delivery)
            },
        })
        const headers = {
            'content-type': 'application/json',
            origin: baseURL,
        }

        try {
            const signup = await auth.handler(
                new Request(`${baseURL}/api/auth/sign-up/email`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        email: 'reset-owner@postbot.local',
                        name: 'Reset Owner',
                        password: 'correct-horse-battery-staple',
                    }),
                })
            )
            expect(signup.status).toBe(200)

            const requestReset = (email: string) =>
                auth.handler(
                    new Request(`${baseURL}/api/auth/request-password-reset`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                            email,
                            redirectTo: `${baseURL}/reset-password`,
                        }),
                    })
                )
            const knownResponse = await requestReset('reset-owner@postbot.local')
            const unknownResponse = await requestReset('unknown-reset@postbot.local')

            expect(knownResponse.status).toBe(200)
            expect(unknownResponse.status).toBe(200)
            expect(await knownResponse.json()).toEqual(await unknownResponse.json())
            expect(deliveries).toHaveLength(1)
            expect(deliveries[0]?.user.email).toBe('reset-owner@postbot.local')
        } finally {
            closeDatabase(database)
        }
    })

    it('keeps email reset unavailable when the instance has no mail transport', async () => {
        const { auth, database } = createFixture()
        const headers = {
            'content-type': 'application/json',
            origin: baseURL,
        }

        try {
            const signup = await auth.handler(
                new Request(`${baseURL}/api/auth/sign-up/email`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        email: 'offline-reset-owner@postbot.local',
                        name: 'Offline Reset Owner',
                        password: 'correct-horse-battery-staple',
                    }),
                })
            )
            expect(signup.status).toBe(200)

            const response = await auth.handler(
                new Request(`${baseURL}/api/auth/request-password-reset`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        email: 'offline-reset-owner@postbot.local',
                        redirectTo: `${baseURL}/reset-password`,
                    }),
                })
            )

            expect(response.status).toBe(400)
            expect(await response.json()).toMatchObject({ code: 'RESET_PASSWORD_DISABLED' })
        } finally {
            closeDatabase(database)
        }
    })

    it('turns a workspace project invitation into a Postbot project grant', async () => {
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
                        email: 'workspace-invitation-owner@postbot.local',
                        name: 'Workspace Invitation Owner',
                        password: 'correct-horse-battery-staple',
                    }),
                })
            )
            const memberSignup = await auth.handler(
                new Request(`${baseURL}/api/auth/sign-up/email`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        email: 'workspace-invitation-member@postbot.local',
                        name: 'Workspace Invitation Member',
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
            const workspace = access.getDefaultWorkspace()
            expect(workspace).not.toBeNull()
            if (workspace === null) throw new Error('The default workspace was not created')
            const project = manualStore.createProject({
                name: 'Workspace invitation project',
                subjectId: owner.user.id,
                displayName: 'Workspace Invitation Owner',
                workspaceId: workspace.id,
            })
            expect(
                access.ensureProjectOwnerMembership({
                    projectId: project.project.id,
                    userId: owner.user.id,
                })
            ).not.toBeNull()

            // The additional-signup fixture gives the second account a
            // default workspace membership. Remove it so this test exercises
            // the real invitation acceptance path.
            database.$client
                .query('delete from member where organization_id = ?1 and user_id = ?2')
                .run(workspace.organizationId, member.user.id)

            const invitation = await auth.api.createInvitation({
                body: {
                    email: 'workspace-invitation-member@postbot.local',
                    role: 'member',
                    organizationId: workspace.organizationId,
                    projectId: project.project.id,
                    projectRole: 'editor',
                },
                headers: new Headers({ cookie: ownerCookie }),
            })
            const accepted = await auth.api.acceptInvitation({
                body: { invitationId: invitation.id },
                headers: new Headers({ cookie: memberCookie }),
            })
            expect(accepted.member).toMatchObject({
                organizationId: workspace.organizationId,
                userId: member.user.id,
                role: 'member',
            })
            expect(access.canAccessProject(project.project.id, member.user.id, 'editor')).toBe(true)
            expect(manualStore.listProjects(member.user.id)).toEqual([
                expect.objectContaining({ id: project.project.id }),
            ])

            await auth.api.leaveOrganization({
                body: { organizationId: workspace.organizationId },
                headers: new Headers({ cookie: memberCookie }),
            })
            // The Postbot grant remains stored, but project access is scoped to
            // current workspace membership and therefore becomes unavailable.
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
                        email: 'first@postbot.local',
                        name: 'First Postbot Operator',
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
                        email: 'second@postbot.local',
                        name: 'Second Postbot Operator',
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
                        email: 'first@postbot.local',
                        password,
                    }),
                })
            )
            expect(signIn.status).toBe(200)
            expect(await signIn.json()).toMatchObject({
                user: { email: 'first@postbot.local' },
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
            expect(configured.options.emailAndPassword?.minPasswordLength).toBe(
                postbotPasswordPolicy.minimumLength
            )
            expect(configured.options.emailAndPassword?.maxPasswordLength).toBe(
                postbotPasswordPolicy.maximumLength
            )
            expect(Object.hasOwn(configured.options, 'socialProviders')).toBe(false)
        } finally {
            closeDatabase(database)
        }
    })
})
