import type { AccessStore } from '@postdot/db'
import { Type } from 'typebox'

import { errorResponse } from '../projects/models'
import type { AuthenticatedElysia } from '../projects/types'
import {
    emailSettingsInputSchema,
    emailSettingsSchema,
    type EmailSettingsService,
} from './settings'
import { describeSmtpFailure } from './smtp-failure'

// The test names the step that failed and repeats the server's reply, so a person can tell a
// blocked port from a rejected login without reading server logs.
const emailTestFailure = Type.Object({
    error: Type.Object({
        code: Type.Literal('email_test_failed'),
        message: Type.String(),
        reason: Type.Union([
            Type.Literal('no_recipient'),
            Type.Literal('dns'),
            Type.Literal('refused'),
            Type.Literal('timeout'),
            Type.Literal('tls'),
            Type.Literal('authentication'),
            Type.Literal('sender_rejected'),
            Type.Literal('recipient_rejected'),
            Type.Literal('unknown'),
        ]),
        serverReply: Type.Optional(Type.String()),
    }),
})

const denied = {
    error: { code: 'forbidden', message: 'An instance administrator role is required' },
}
const unavailable = {
    error: { code: 'unavailable', message: 'Email configuration is unavailable' },
}

export function registerEmailSettingsRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    access: AccessStore,
    service?: EmailSettingsService
) {
    return app
        .get(
            '/api/settings/email',
            {
                auth: true,
                response: {
                    200: emailSettingsSchema,
                    401: errorResponse,
                    403: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'getEmailSettings',
                    summary: 'Read installation SMTP settings',
                    tags: ['Configuration'],
                },
            },
            async ({ user, status }) => {
                if (!(await access.isInstanceAdmin(user.id))) return status(403, denied)
                if (!service) return status(503, unavailable)
                return service.view()
            }
        )
        .put(
            '/api/settings/email',
            {
                auth: true,
                body: emailSettingsInputSchema,
                response: {
                    200: emailSettingsSchema,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'saveEmailSettings',
                    summary: 'Save encrypted installation SMTP settings',
                    tags: ['Configuration'],
                },
            },
            async ({ user, body, status }) => {
                if (!(await access.isInstanceAdmin(user.id))) return status(403, denied)
                if (!service) return status(503, unavailable)
                try {
                    return await service.save(body)
                } catch {
                    return status(400, {
                        error: {
                            code: 'invalid_input',
                            message:
                                'SMTP settings could not be saved; check the configuration and credentials',
                        },
                    })
                }
            }
        )
        .post(
            '/api/settings/email/test',
            {
                auth: true,
                response: {
                    200: Type.Object({ accepted: Type.Literal(true) }),
                    400: emailTestFailure,
                    401: errorResponse,
                    403: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'testEmailSettings',
                    summary: 'Send a test email to the current administrator',
                    tags: ['Configuration'],
                },
            },
            async ({ user, status }) => {
                if (!(await access.isInstanceAdmin(user.id))) return status(403, denied)
                if (!service) return status(503, unavailable)
                const recipientEmail =
                    user.email ?? (await access.getInstanceMembership(user.id))?.email ?? null
                if (recipientEmail === null) {
                    return status(400, {
                        error: {
                            code: 'email_test_failed' as const,
                            message: 'No email address is configured for the acting administrator',
                            reason: 'no_recipient' as const,
                        },
                    })
                }
                try {
                    return await service.test(recipientEmail)
                } catch (error) {
                    const failure = describeSmtpFailure(error)
                    console.warn('[postdot-email] SMTP test failed', {
                        reason: failure.reason,
                        code: failure.code,
                        command: failure.command,
                        responseCode: failure.responseCode,
                        serverReply: failure.serverReply,
                    })
                    return status(400, {
                        error: {
                            code: 'email_test_failed' as const,
                            message: `SMTP test failed at step: ${failure.reason}`,
                            reason: failure.reason,
                            ...(failure.serverReply === undefined
                                ? {}
                                : { serverReply: failure.serverReply }),
                        },
                    })
                }
            }
        )
}
