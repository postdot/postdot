import { describe, expect, it, spyOn } from 'bun:test'

import { Check } from 'typebox/value'

import { createPostBody } from './modules/projects/models'
import { exportOpenAPISchema } from './openapi-export'

describe('isolated OpenAPI export', () => {
    it('is reproducible without a network request or deployment origin', async () => {
        const network = spyOn(globalThis, 'fetch').mockRejectedValue(
            new Error('Schema generation must not contact a server')
        )
        try {
            const first = await exportOpenAPISchema()
            const second = await exportOpenAPISchema()
            expect(Check(createPostBody, Reflect.get(createPostBody, 'example'))).toBe(true)
            expect(second).toEqual(first)
            expect(network).not.toHaveBeenCalled()
            expect(first.servers).toBeUndefined()
            expect(JSON.stringify(first)).not.toContain('postdot.invalid')
            expect(first.paths['/api/projects/{projectId}/posts']?.post?.operationId).toBe(
                'createPost'
            )
            expect(first.paths['/api/projects/{projectId}/media/uploads']?.post).toBeDefined()
            expect(
                first.paths[
                    '/api/projects/{projectId}/channels/{channelId}/publisher/discord/connect'
                ]?.post?.security
            ).toEqual([{ sessionCookie: [] }])
            expect(first.paths['/health']?.get?.security).toEqual([])
            expect(first.security).toEqual([{ bearerAuth: [] }, { sessionCookie: [] }])
            expect(first.paths['/api/account/avatar']?.delete?.security).toEqual([
                { sessionCookie: [] },
            ])
            expect(first.paths['/api/account/avatar']?.delete?.responses).toMatchObject({
                '200': { content: { 'application/json': { example: { success: true } } } },
                '401': {},
                '403': {},
                '503': {},
            })
            expect(first.paths['/api/projects/{projectId}/posts']?.post?.requestBody).toMatchObject(
                {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                example: {
                                    publications: [{ deliveryMode: 'manual' }],
                                    sourceContent: { body: { format: 'plain_text' } },
                                },
                            },
                        },
                    },
                }
            )
        } finally {
            network.mockRestore()
        }
    })
})
