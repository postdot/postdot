import type { AccessStore } from '@postdot/db'
import { Type } from 'typebox'

import { errorResponse } from '../projects/models'
import type { AuthenticatedElysia } from '../projects/types'
import {
    emailSettingsInputSchema,
    emailSettingsSchema,
    type EmailSettingsService,
} from './settings'

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
                    400: errorResponse,
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
                            code: 'email_test_failed',
                            message: 'No email address is configured for the acting administrator',
                        },
                    })
                }
                try {
                    return await service.test(recipientEmail)
                } catch {
                    return status(400, {
                        error: {
                            code: 'email_test_failed',
                            message:
                                'SMTP did not confirm acceptance; check the configuration before trying again',
                        },
                    })
                }
            }
        )
}
