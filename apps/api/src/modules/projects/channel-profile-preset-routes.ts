import { Type } from 'typebox'

import { sessionSecurity, type AuthenticatedElysia } from '../../plugins/auth'
import { builtInChannelProfilePresets } from './channel-profile-presets'
import { channelProfilePresetsSchema } from './models'

const errorResponse = Type.Object({
    error: Type.Object({
        code: Type.String({ minLength: 1 }),
        message: Type.String({ minLength: 1 }),
    }),
})

export function registerChannelProfilePresetRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>
) {
    return app.get(
        '/api/channel-profile-presets',
        {
            auth: true,
            response: {
                200: channelProfilePresetsSchema,
                401: errorResponse,
            },
            detail: {
                operationId: 'listChannelProfilePresets',
                summary: 'List reusable built-in channel profile presets',
                tags: ['Channels'],
                security: sessionSecurity,
            },
        },
        () => ({ presets: [...builtInChannelProfilePresets] })
    )
}
