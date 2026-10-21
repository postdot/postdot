import type { PostbotAuth } from '@postdot/auth'
import { AvatarValidationError, avatarMaxBytes, type UserAvatarStore } from '@postdot/db'
import { Elysia } from 'elysia'
import { Type } from 'typebox'

export function createAccountRoutes(
    auth: PostbotAuth,
    avatars: UserAvatarStore | undefined,
    allowedOrigins: readonly string[] = []
) {
    return new Elysia({ name: 'postbot-personal-account', prefix: '/api/account' })
        .derive(async ({ request }) => {
            const headers = new Headers()
            headers.set('cookie', request.headers.get('cookie') ?? '')
            return { accountSession: await auth.api.getSession({ headers }) }
        })
        .beforeHandle(({ accountSession, request, status }) => {
            if (accountSession === null) {
                return status(401, {
                    error: { code: 'unauthorized', message: 'Authentication required' },
                })
            }
            if (request.method !== 'GET') {
                const origin = request.headers.get('origin')
                if (
                    origin === null ||
                    ![
                        new URL(request.url).origin,
                        ...allowedOrigins.map(value => new URL(value).origin),
                    ].includes(origin)
                ) {
                    return status(403, {
                        error: { code: 'invalid_origin', message: 'Origin is not allowed' },
                    })
                }
            }
            if (avatars === undefined) {
                return status(503, {
                    error: { code: 'avatar_unavailable', message: 'Avatar storage is unavailable' },
                })
            }
        })
        .post(
            '/avatar',
            {
                parse: 'none',
                detail: {
                    tags: ['Account'],
                    summary: 'Replace the signed-in user avatar',
                    security: [{ sessionCookie: [] }],
                    requestBody: {
                        required: true,
                        content: {
                            'application/octet-stream': {
                                schema: { type: 'string', format: 'binary' },
                            },
                        },
                    },
                    responses: {
                        '200': { description: 'Updated personal image URL' },
                        '400': { description: 'Unsupported image' },
                        '401': { description: 'Person session required' },
                        '403': { description: 'Untrusted mutation origin' },
                        '413': { description: 'Image exceeds 5 MB' },
                        '503': { description: 'Avatar storage unavailable' },
                    },
                },
            },
            async ({ accountSession, request, status }) => {
                if (accountSession === null || avatars === undefined) return status(401)
                const reader = request.body?.getReader()
                if (!reader)
                    return status(400, {
                        error: { code: 'avatar_format', message: 'An image is required' },
                    })
                const chunks: Uint8Array[] = []
                let size = 0
                try {
                    while (true) {
                        const result = await reader.read()
                        if (result.done) break
                        size += result.value.byteLength
                        if (size > avatarMaxBytes) {
                            await reader.cancel()
                            return status(413, {
                                error: {
                                    code: 'avatar_size',
                                    message: 'Image exceeds the upload limit',
                                },
                            })
                        }
                        chunks.push(result.value)
                    }
                } finally {
                    reader.releaseLock()
                }
                const bytes = new Uint8Array(size)
                let offset = 0
                for (const chunk of chunks) {
                    bytes.set(chunk, offset)
                    offset += chunk.byteLength
                }
                try {
                    const image = await avatars.replace(accountSession.user.id, bytes)
                    return { image }
                } catch (error) {
                    if (error instanceof AvatarValidationError) {
                        return status(400, {
                            error: { code: error.message, message: 'Image is not supported' },
                        })
                    }
                    throw error
                }
            }
        )
        .delete(
            '/avatar',
            {
                detail: {
                    tags: ['Account'],
                    summary: 'Remove the signed-in user avatar',
                    security: [{ sessionCookie: [] }],
                    responses: {
                        '200': {
                            description: 'Avatar removed; the account has no profile image.',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        required: ['success'],
                                        properties: { success: { type: 'boolean', enum: [true] } },
                                    },
                                    example: { success: true },
                                },
                            },
                        },
                        '401': { description: 'An authenticated human session is required.' },
                        '403': { description: 'The request origin is not allowed.' },
                        '503': { description: 'Avatar storage is unavailable.' },
                    },
                },
            },
            async ({ accountSession, status }) => {
                if (accountSession === null || avatars === undefined) return status(401)
                await avatars.remove(accountSession.user.id)
                return { success: true }
            }
        )
        .get(
            '/avatars/:id',
            {
                params: Type.Object({ id: Type.String({ minLength: 1, maxLength: 100 }) }),
                detail: {
                    tags: ['Account'],
                    summary: 'Read a personal avatar inside the authenticated app',
                    security: [{ sessionCookie: [] }],
                    responses: {
                        '200': {
                            description: 'Private PNG, JPEG or WebP image',
                            content: {
                                'application/octet-stream': {
                                    schema: { type: 'string', format: 'binary' },
                                },
                            },
                        },
                        '401': { description: 'Person session required' },
                        '404': { description: 'Image unavailable' },
                    },
                },
            },
            async ({ params, status }) => {
                const image = await avatars?.open(params.id)
                if (!image) return status(404)
                return new Response(image.stream, {
                    headers: {
                        'content-type': image.contentType,
                        'cache-control': 'private, no-store',
                        'x-content-type-options': 'nosniff',
                        'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
                    },
                })
            }
        )
}
