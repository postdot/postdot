import { describe, expect, it } from 'bun:test'

import {
    canApiKeyAccessRequest,
    capabilitiesForPermissions,
    permissionsForCapabilities,
    requiredApiKeyCapability,
} from './api-key-permissions'

describe('user API-key capability policy', () => {
    it.each([
        ['GET', '/api/projects', 'project:read'],
        ['GET', '/api/projects/project-1/publications/publication-1/destination', 'project:read'],
        [
            'POST',
            '/api/projects/project-1/publications/publication-1/confirm-destination',
            'publication:dispatch',
        ],
        ['GET', '/api/projects/project-1/publications/publication-1/first-comment', 'project:read'],
        [
            'PUT',
            '/api/projects/project-1/publications/publication-1/first-comment',
            'publication:dispatch',
        ],
        [
            'POST',
            '/api/projects/project-1/publications/publication-1/first-comment/cancel',
            'publication:dispatch',
        ],
        ['GET', '/api/projects/project-1/channels', 'project:read'],
        ['PUT', '/api/projects/project-1/publication-composer-draft', 'publication:manage'],
        ['POST', '/api/projects/project-1/posts', 'publication:manage'],
        ['PATCH', '/api/projects/project-1/posts/post-1', 'publication:manage'],
        [
            'POST',
            '/api/projects/project-1/publications/publication-1/draft/promote',
            'publication:dispatch',
        ],
        ['PATCH', '/api/projects/project-1/publications/schedule', 'publication:dispatch'],
        ['PATCH', '/api/projects/project-1/publications/cancel', 'publication:dispatch'],
        [
            'POST',
            '/api/projects/project-1/publications/publication-1/retry',
            'publication:dispatch',
        ],
        ['POST', '/api/projects/project-1/channels', 'channel:manage'],
        ['GET', '/api/projects/project-1/channel-occupancy', 'project:read'],
        ['GET', '/api/projects/project-1/channels/channel-1/sharing', 'project:read'],
        ['POST', '/api/projects/project-1/channels/channel-1/attachments', 'channel:share'],
        [
            'POST',
            '/api/projects/project-1/channels/channel-1/attachments/project-2/withdraw',
            'channel:share',
        ],
        ['POST', '/api/projects/project-1/channels/channel-1/management', 'channel:share'],
        [
            'POST',
            '/api/projects/project-1/publications/publication-1/draft/adopt-profile',
            'publication:manage',
        ],
        [
            'POST',
            '/api/projects/project-1/publications/publication-1/draft/assess-adoption',
            'publication:manage',
        ],
        [
            'GET',
            '/api/projects/project-1/publications/publication-1/draft/adoptions',
            'project:read',
        ],
        [
            'POST',
            '/api/projects/project-1/channels/channel-1/publisher/custom-http/connect',
            'channel:manage',
        ],
        ['POST', '/api/projects/project-1/media/uploads', 'media:manage'],
        ['DELETE', '/api/projects/project-1/media/asset-1', 'media:manage'],
        ['POST', '/api/projects/project-1/media/asset-1/permanent', 'media:permanently_delete'],
        ['GET', '/api/projects/project-1/analytics/provider/devto', 'project:read'],
        ['GET', '/api/projects/project-1/analytics/provider/mastodon/latest', 'project:read'],
        [
            'POST',
            '/api/projects/project-1/analytics/provider/mastodon/collect',
            'analytics:refresh',
        ],
        ['POST', '/api/projects/project-1/analytics/provider/bluesky/collect', 'analytics:refresh'],
    ] as const)('maps %s %s to %s', (method, path, expected) => {
        expect(requiredApiKeyCapability(method, path)).toBe(expected)
    })

    it.each([
        ['PUT', '/api/projects/project-1/publications/publication-1/first-comment/extra'],
        ['POST', '/api/projects/project-1/publications/publication-1/first-comment'],
        ['POST', '/api/projects/project-1/publications/publication-1/first-comment/cancel/extra'],
        ['POST', '/api/projects'],
        ['PATCH', '/api/projects/project-1'],
        ['GET', '/api/projects/project-1/members'],
        ['GET', '/api/projects/project-1/notifications'],
        ['GET', '/api/projects/project-1/events'],
        ['GET', '/api/projects/project-1/audit-events'],
        ['POST', '/api/projects/project-1/channels/channel-1/publisher/x/connect'],
        ['GET', '/api/projects/project-1/channels/channel-1'],
        ['GET', '/api/projects/project-1'],
        ['GET', '/api/projects/project-1/publications/publication-1'],
        ['POST', '/api/projects/project-1/channels/channel-1/publisher/custom-http/connect/extra'],
        ['POST', '/api/projects/project-1/publications/publication-1/publish/extra'],
        ['POST', '/api/projects/project-1/publications/publication-1/draft/promote/extra'],
        ['POST', '/api/api-keys'],
        ['POST', '/api/projects/project-1/channel-occupancy'],
        ['GET', '/api/projects/project-1/channel-occupancy/extra'],
        ['GET', '/api/instance/users'],
        ['GET', '/api/unregistered-project-operation'],
    ] as const)('keeps %s %s outside API-key access', (method, path) => {
        expect(requiredApiKeyCapability(method, path)).toBeNull()
        expect(canApiKeyAccessRequest(method, path, null)).toBe(false)
    })

    it('lets an unrestricted key inherit mapped actions but enforces a limited key exactly', () => {
        expect(
            canApiKeyAccessRequest('POST', '/api/projects/project-1/media/asset-1/permanent', null)
        ).toBe(true)
        expect(
            canApiKeyAccessRequest('POST', '/api/projects/project-1/media/asset-1/permanent', {
                media: ['manage'],
            })
        ).toBe(false)
        expect(
            canApiKeyAccessRequest('GET', '/api/projects/project-1/channels', {
                project: ['read'],
            })
        ).toBe(true)
        expect(
            canApiKeyAccessRequest('POST', '/api/projects/project-1/channels', {
                project: ['read'],
            })
        ).toBe(false)
    })

    it('round-trips only the supported capability statements', () => {
        const permissions = permissionsForCapabilities([
            'project:read',
            'media:manage',
            'media:permanently_delete',
        ])
        expect(permissions).toEqual({
            project: ['read'],
            media: ['manage', 'permanently_delete'],
        })
        expect(capabilitiesForPermissions(permissions)).toEqual([
            'project:read',
            'media:manage',
            'media:permanently_delete',
        ])
        expect(capabilitiesForPermissions(null)).toBe('all')
        expect(capabilitiesForPermissions({ unknown: ['admin'] })).toEqual([])
    })
})
