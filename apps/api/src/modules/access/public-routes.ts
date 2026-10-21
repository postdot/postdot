import type { AccessStore } from '@postdot/db'
import { Elysia } from 'elysia'
import { Type } from 'typebox'

const instanceSetupStatusSchema = Type.Object({
    setupAvailable: Type.Boolean(),
})
const invitationTokenParams = Type.Object({ token: Type.String({ minLength: 1 }) })
const invitationPreviewSchema = Type.Object({
    targetEmail: Type.String({ minLength: 1 }),
    expiresAt: Type.Integer({ minimum: 0 }),
})
const errorResponse = Type.Object({
    error: Type.Object({
        code: Type.String({ minLength: 1 }),
        message: Type.String({ minLength: 1 }),
    }),
})

/**
 * Public instance discovery is intentionally smaller than the authenticated
 * access summary. The browser only needs to know whether first-run setup is
 * available; instance ids, timestamps and ownership never leave the server.
 */
export function createPublicInstanceRoutes(
    access: AccessStore,
    options: { readonly allowAdditionalSignups?: boolean } = {}
) {
    return new Elysia({ name: 'postbot-public-instance' })
        .get(
            '/api/instance/status',
            {
                response: { 200: instanceSetupStatusSchema },
                detail: {
                    operationId: 'getInstanceSetupStatus',
                    summary: 'Check whether first-run instance setup is available',
                    tags: ['System'],
                    security: [],
                },
            },
            () => ({
                // The E2E runtime may explicitly allow additional isolated
                // accounts after bootstrap. Production never enables this
                // escape hatch, so first-run setup remains single-use there.
                setupAvailable: options.allowAdditionalSignups === true || access.isSignupAllowed(),
            })
        )
        .get(
            '/api/access/invitations/:token',
            {
                params: invitationTokenParams,
                response: {
                    200: invitationPreviewSchema,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'getAccessInvitationPreview',
                    summary: 'Preview a public instance invitation',
                    tags: ['Access'],
                    security: [],
                },
            },
            ({ params, status }) => {
                const invitation = access.getInvitationByToken(params.token)
                if (invitation === null || invitation.state !== 'pending') {
                    return status(404, {
                        error: {
                            code: 'invalid_invitation',
                            message: 'Invitation is invalid, expired, or no longer available',
                        },
                    })
                }
                return {
                    targetEmail: invitation.targetEmail,
                    expiresAt: invitation.expiresAt,
                }
            }
        )
}
