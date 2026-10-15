import { describe, expect, it, spyOn } from 'bun:test'

import { exportOpenAPISchema } from './openapi-export'

describe('isolated OpenAPI export', () => {
    it('is reproducible without a network request or deployment origin', async () => {
        const network = spyOn(globalThis, 'fetch').mockRejectedValue(
            new Error('Schema generation must not contact a server')
        )
        try {
            const first = await exportOpenAPISchema()
            const second = await exportOpenAPISchema()
            expect(second).toEqual(first)
            expect(network).not.toHaveBeenCalled()
            expect(first.servers).toBeUndefined()
            expect(JSON.stringify(first)).not.toContain('postbot.invalid')
            expect(first.paths['/api/projects/{projectId}/posts']?.post?.operationId).toBe(
                'createPost'
            )
            expect(first.paths['/api/projects/{projectId}/media/uploads']?.post).toBeDefined()
            expect(first.paths['/health']?.get?.security).toEqual([])
            expect(first.security).toEqual([{ bearerAuth: [] }, { sessionCookie: [] }])
            expect(first.paths['/api/account/avatar']?.delete?.security).toEqual([
                { sessionCookie: [] },
            ])
            expect(first.paths['/api/account/avatar']?.delete?.responses.default).toEqual({
                description: 'Response schema is not declared for this operation.',
            })
        } finally {
            network.mockRestore()
        }
    })
})
