import { describe, expect, it } from 'bun:test'

import {
    canApiKeyAccessRequest,
    capabilitiesForPermissions,
    permissionsForCapabilities,
    requiredApiKeyCapability,
} from './api-key-permissions'

describe('user API-key capability policy', () => {
    it.each([
        ['GET', '/api/workspaces', 'project:read'],
        ['GET', '/api/projects', 'project:read'],
        ['POST', '/api/projects', 'project:manage'],
        ['PATCH', '/api/projects/project-1', 'project:manage'],
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
        ['POST', '/api/projects/project-1/publications/publication-1/move', 'publication:manage'],
        ['GET', '/api/workspaces/workspace-1/channels', 'project:read'],
        ['POST', '/api/workspaces/workspace-1/channels/channel-1/attachments', 'channel:share'],
        ['POST', '/api/workspaces/workspace-1/channels/channel-1/withdraw', 'channel:share'],
        ['POST', '/api/workspaces/workspace-1/channels/channel-1/management', 'channel:share'],
        ['GET', '/api/workspaces/workspace-1/channels/channel-1/cadence', 'project:read'],
        ['PUT', '/api/workspaces/workspace-1/channels/channel-1/cadence', 'channel:manage'],
        ['GET', '/api/projects/project-1/channels/channel-1/cadence', 'project:read'],
        ['PUT', '/api/projects/project-1/channels/channel-1/cadence', 'channel:manage'],
        ['GET', '/api/projects/project-1/publications/publication-1/cadence', 'project:read'],
        [
            'POST',
            '/api/projects/project-1/publications/publication-1/cadence-override',
            'publication:dispatch',
        ],
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
        ['GET', '/api/access', 'project:read'],
        ['GET', '/api/access/members', 'instance:admin'],
        ['POST', '/api/access/members', 'instance:admin'],
        ['PATCH', '/api/access/members/user-1', 'instance:admin'],
        ['GET', '/api/access/members/user-1/api-keys', 'instance:admin'],
        ['DELETE', '/api/access/members/user-1/api-keys/key-1', 'instance:admin'],
        ['GET', '/api/access/invitations', 'instance:admin'],
        ['POST', '/api/access/invitations', 'instance:admin'],
        ['DELETE', '/api/access/invitations/inv-1', 'instance:admin'],
        ['GET', '/api/api-keys', 'api_key:manage'],
        ['POST', '/api/api-keys', 'api_key:manage'],
        ['PATCH', '/api/api-keys/key-1', 'api_key:manage'],
        ['DELETE', '/api/api-keys/key-1', 'api_key:manage'],
        ['GET', '/api/categories', 'project:read'],
        ['POST', '/api/categories', 'instance:admin'],
        ['PATCH', '/api/categories/cat-1', 'instance:admin'],
        ['POST', '/api/categories/cat-1/archive', 'instance:admin'],
        ['POST', '/api/categories/cat-1/restore', 'instance:admin'],
        ['PATCH', '/api/projects/project-1/category', 'publication:manage'],
        ['GET', '/api/search', 'project:read'],
        ['GET', '/api/resource-removals', 'project:read'],
        ['GET', '/api/settings/email', 'instance:admin'],
        ['PUT', '/api/settings/email', 'instance:admin'],
        ['POST', '/api/settings/email/test', 'instance:admin'],
        ['GET', '/api/settings/recovery', 'instance:admin'],
        ['POST', '/api/settings/recovery/resume', 'instance:admin'],
        ['GET', '/api/settings/provider-applications', 'instance:admin'],
        ['POST', '/api/settings/provider-applications', 'instance:admin'],
        ['PATCH', '/api/settings/provider-applications/app-1', 'instance:admin'],
        ['POST', '/api/workspaces', 'workspace:manage'],
        ['GET', '/api/workspaces/workspace-1', 'project:read'],
        ['GET', '/api/workspaces/workspace-1/lifecycle', 'project:read'],
        ['DELETE', '/api/workspaces/workspace-1/lifecycle', 'project:permanently_delete'],
        ['POST', '/api/workspaces/workspace-1/lifecycle/archive', 'workspace:manage'],
        ['POST', '/api/workspaces/workspace-1/lifecycle/restore', 'workspace:manage'],
        ['PATCH', '/api/workspaces/workspace-1/members/member-1', 'workspace:manage'],
        ['DELETE', '/api/workspaces/workspace-1/members/member-1', 'workspace:manage'],
        ['POST', '/api/workspaces/workspace-1/teams', 'workspace:manage'],
        ['PATCH', '/api/workspaces/workspace-1/teams/team-1', 'workspace:manage'],
        ['GET', '/api/workspaces/workspace-1/teams/team-1/members', 'project:read'],
        ['POST', '/api/workspaces/workspace-1/teams/team-1/members', 'workspace:manage'],
        ['DELETE', '/api/workspaces/workspace-1/teams/team-1/members/user-1', 'workspace:manage'],
        ['GET', '/api/workspaces/workspace-1/invitations', 'workspace:manage'],
        ['POST', '/api/workspaces/workspace-1/invitations', 'workspace:manage'],
        ['DELETE', '/api/workspaces/workspace-1/invitations/inv-1', 'workspace:manage'],
        ['GET', '/api/projects/project-1/membership', 'project:read'],
        ['GET', '/api/projects/project-1/members', 'project:read'],
        ['PATCH', '/api/projects/project-1/members/member-1', 'project:access_manage'],
        ['DELETE', '/api/projects/project-1/members/member-1', 'project:access_manage'],
        ['GET', '/api/projects/project-1/user-grants', 'project:read'],
        ['POST', '/api/projects/project-1/user-grants', 'project:access_manage'],
        ['PATCH', '/api/projects/project-1/user-grants/user-1', 'project:access_manage'],
        ['DELETE', '/api/projects/project-1/user-grants/user-1', 'project:access_manage'],
        ['GET', '/api/projects/project-1/team-grants', 'project:read'],
        ['POST', '/api/projects/project-1/team-grants', 'project:access_manage'],
        ['PATCH', '/api/projects/project-1/team-grants/team-1', 'project:access_manage'],
        ['DELETE', '/api/projects/project-1/team-grants/team-1', 'project:access_manage'],
        ['GET', '/api/projects/project-1/invitations', 'project:access_manage'],
        ['POST', '/api/projects/project-1/invitations', 'project:access_manage'],
        ['DELETE', '/api/projects/project-1/invitations/inv-1', 'project:access_manage'],
        ['POST', '/api/projects/project-1/invitations/inv-1/resend', 'project:access_manage'],
        ['GET', '/api/projects/project-1/publications/approval-requests', 'project:read'],
        [
            'POST',
            '/api/projects/project-1/publications/publication-1/approval-request/approve',
            'publication:approve',
        ],
        [
            'POST',
            '/api/projects/project-1/publications/publication-1/approval-request/reject',
            'publication:approve',
        ],
        [
            'POST',
            '/api/projects/project-1/channels/channel-1/publisher/devto/connect',
            'channel:manage',
        ],
        [
            'POST',
            '/api/projects/project-1/channels/channel-1/publisher/discord/connect',
            'channel:manage',
        ],
        [
            'POST',
            '/api/projects/project-1/channels/channel-1/publisher/telegram/connect',
            'channel:manage',
        ],
    ] as const)('maps %s %s to %s', (method, path, expected) => {
        expect(requiredApiKeyCapability(method, path)).toBe(expected)
    })

    it.each([
        ['PUT', '/api/projects/project-1/publications/publication-1/first-comment/extra'],
        ['POST', '/api/projects/project-1/publications/publication-1/first-comment'],
        ['POST', '/api/projects/project-1/publications/publication-1/first-comment/cancel/extra'],
        ['POST', '/api/access/invitations/accept'],
        ['POST', '/api/workspaces/workspace-1/invitations/inv-1/accept'],
        ['DELETE', '/api/projects'],
        ['DELETE', '/api/projects/project-1'],
        ['GET', '/api/projects/project-1/notifications'],
        ['GET', '/api/projects/project-1/events'],
        ['GET', '/api/projects/project-1/audit-events'],
        ['POST', '/api/projects/project-1/channels/channel-1/publisher/x/connect'],
        ['POST', '/api/projects/project-1/channels/channel-1/publisher/bluesky/connect'],
        ['POST', '/api/projects/project-1/channels/channel-1/publisher/linkedin/connect'],
        ['POST', '/api/projects/project-1/channels/channel-1/publisher/facebook/connect'],
        ['POST', '/api/projects/project-1/channels/channel-1/publisher/instagram/connect'],
        ['POST', '/api/projects/project-1/channels/channel-1/publisher/mastodon/connect'],
        ['GET', '/api/projects/project-1/channels/channel-1'],
        ['GET', '/api/projects/project-1'],
        ['GET', '/api/projects/project-1/publications/publication-1'],
        ['POST', '/api/projects/project-1/channels/channel-1/publisher/custom-http/connect/extra'],
        ['POST', '/api/projects/project-1/publications/publication-1/publish/extra'],
        ['POST', '/api/projects/project-1/publications/publication-1/draft/promote/extra'],
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
        expect(canApiKeyAccessRequest('POST', '/api/access/members', null, null)).toBe(true)
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

    it('blocks project-scoped keys from instance-wide and workspace administration routes', () => {
        const projectScoped = ['project-1']

        expect(canApiKeyAccessRequest('GET', '/api/access', null, projectScoped)).toBe(true)
        expect(canApiKeyAccessRequest('GET', '/api/categories', null, projectScoped)).toBe(true)
        expect(canApiKeyAccessRequest('GET', '/api/search', null, projectScoped)).toBe(true)
        expect(canApiKeyAccessRequest('GET', '/api/resource-removals', null, projectScoped)).toBe(
            true
        )
        expect(canApiKeyAccessRequest('POST', '/api/api-keys', null, projectScoped)).toBe(true)
        expect(
            canApiKeyAccessRequest('GET', '/api/workspaces/ws-1/channels', null, projectScoped)
        ).toBe(true)

        expect(canApiKeyAccessRequest('GET', '/api/access/members', null, projectScoped)).toBe(
            false
        )
        expect(canApiKeyAccessRequest('POST', '/api/categories', null, projectScoped)).toBe(false)
        expect(
            canApiKeyAccessRequest(
                'GET',
                '/api/settings/provider-applications',
                null,
                projectScoped
            )
        ).toBe(false)
        expect(canApiKeyAccessRequest('POST', '/api/workspaces', null, projectScoped)).toBe(false)
        expect(canApiKeyAccessRequest('GET', '/api/workspaces/ws-1', null, projectScoped)).toBe(
            false
        )
        expect(
            canApiKeyAccessRequest('POST', '/api/workspaces/ws-1/teams', null, projectScoped)
        ).toBe(false)
        expect(
            canApiKeyAccessRequest(
                'POST',
                '/api/workspaces/ws-1/lifecycle/archive',
                null,
                projectScoped
            )
        ).toBe(false)

        expect(canApiKeyAccessRequest('GET', '/api/access/members', null, null)).toBe(true)
        expect(canApiKeyAccessRequest('POST', '/api/workspaces', null, null)).toBe(true)
        expect(canApiKeyAccessRequest('GET', '/api/workspaces/ws-1', null, null)).toBe(true)
    })

    it('round-trips only the supported capability statements', () => {
        const permissions = permissionsForCapabilities([
            'project:read',
            'media:manage',
            'media:permanently_delete',
            'project:access_manage',
            'publication:approve',
            'workspace:manage',
            'api_key:manage',
            'instance:admin',
        ])
        expect(permissions).toEqual({
            project: ['read', 'access_manage'],
            media: ['manage', 'permanently_delete'],
            publication: ['approve'],
            workspace: ['manage'],
            api_key: ['manage'],
            instance: ['admin'],
        })
        expect(capabilitiesForPermissions(permissions)).toEqual([
            'project:read',
            'media:manage',
            'media:permanently_delete',
            'project:access_manage',
            'publication:approve',
            'workspace:manage',
            'api_key:manage',
            'instance:admin',
        ])
        expect(capabilitiesForPermissions(null)).toBe('all')
        expect(capabilitiesForPermissions({ unknown: ['admin'] })).toEqual([])
    })
})
