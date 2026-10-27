export const postdotApiKeyCapabilities = [
    'project:read',
    'project:manage',
    'project:permanently_delete',
    'publication:manage',
    'publication:dispatch',
    'channel:manage',
    'channel:share',
    'media:manage',
    'analytics:refresh',
    'media:permanently_delete',
] as const

export type PostdotApiKeyCapability = (typeof postdotApiKeyCapabilities)[number]
export type PostdotApiKeyPermissions = Record<string, readonly string[]> | null

export function apiKeyHasCapability(
    permissions: PostdotApiKeyPermissions,
    capability: PostdotApiKeyCapability
): boolean {
    if (permissions === null) return true

    const [resource, action] = capabilityStatements[capability]
    return permissions[resource]?.includes(action) ?? false
}

const capabilityStatements: Record<PostdotApiKeyCapability, readonly [string, string]> = {
    'project:read': ['project', 'read'],
    'project:manage': ['project', 'manage'],
    'project:permanently_delete': ['project', 'permanently_delete'],
    'publication:manage': ['publication', 'manage'],
    'publication:dispatch': ['publication', 'dispatch'],
    'channel:manage': ['channel', 'manage'],
    'channel:share': ['channel', 'share'],
    'media:manage': ['media', 'manage'],
    'analytics:refresh': ['analytics', 'refresh'],
    'media:permanently_delete': ['media', 'permanently_delete'],
}

export function permissionsForCapabilities(
    capabilities: readonly PostdotApiKeyCapability[]
): Record<string, string[]>
export function permissionsForCapabilities(capabilities: null): null
export function permissionsForCapabilities(
    capabilities: readonly PostdotApiKeyCapability[] | null
): Record<string, string[]> | null {
    if (capabilities === null) return null

    const permissions: Record<string, string[]> = {}
    for (const capability of capabilities) {
        const [resource, action] = capabilityStatements[capability]
        const actions = permissions[resource] ?? []
        if (!actions.includes(action)) actions.push(action)
        permissions[resource] = actions
    }
    return permissions
}

export function capabilitiesForPermissions(
    permissions: PostdotApiKeyPermissions
): 'all' | PostdotApiKeyCapability[] {
    if (permissions === null) return 'all'

    return postdotApiKeyCapabilities.filter(capability => {
        const [resource, action] = capabilityStatements[capability]
        return permissions[resource]?.includes(action) ?? false
    })
}

/**
 * Translate an API request to one explicitly allowed capability. Unknown
 * and session-only routes return null and therefore fail closed for all keys.
 */
export function requiredApiKeyCapability(method: string, requestPath: string) {
    const normalizedMethod = method.toUpperCase()
    const segments = requestPath.split('?')[0]?.split('/').filter(Boolean) ?? []

    if (segments[0] === 'api' && segments[1] === 'workspaces' && segments[3] === 'channels') {
        if (segments.length === 4 && normalizedMethod === 'GET') return 'project:read'
        if (segments.length !== 6) return null
        if (segments[5] === 'cadence')
            return normalizedMethod === 'GET'
                ? 'project:read'
                : normalizedMethod === 'PUT'
                  ? 'channel:manage'
                  : null
        if (
            ['attachments', 'withdraw', 'management'].includes(segments[5]!) &&
            normalizedMethod === 'POST'
        )
            return 'channel:share'
        return null
    }
    if (segments[0] !== 'api' || segments[1] !== 'projects') return null
    if (segments.length === 2) {
        return normalizedMethod === 'GET' ? 'project:read' : null
    }
    if (segments.length < 3) return null

    const resource = segments[3]
    const detail = segments.slice(4)

    if (resource === undefined) return null

    if (resource === 'lifecycle') {
        if (
            (detail.length === 0 || (detail.length === 1 && detail[0] === 'state')) &&
            normalizedMethod === 'GET'
        )
            return 'project:read'
        if (detail.length === 0 && normalizedMethod === 'DELETE')
            return 'project:permanently_delete'
        if (
            detail.length === 1 &&
            ['archive', 'restore'].includes(detail[0]!) &&
            normalizedMethod === 'POST'
        )
            return 'project:manage'
        return null
    }

    if (resource === 'channels') {
        if (detail.length === 0) {
            if (normalizedMethod === 'GET') return 'project:read'
            return normalizedMethod === 'POST' ? 'channel:manage' : null
        }

        // Sharing is its own capability: it grants no connection management, dispatch or secret access.
        if (detail[1] === 'cadence' && detail.length === 2)
            return normalizedMethod === 'GET'
                ? 'project:read'
                : normalizedMethod === 'PUT'
                  ? 'channel:manage'
                  : null
        if (detail[1] === 'sharing' && detail.length === 2) {
            return normalizedMethod === 'GET' ? 'project:read' : null
        }
        if (detail[1] === 'attachments' && normalizedMethod === 'POST') {
            if (detail.length === 2) return 'channel:share'
            if (detail.length === 4 && detail[3] === 'withdraw') return 'channel:share'
            return null
        }
        if (detail[1] === 'management' && detail.length === 2) {
            return normalizedMethod === 'POST' ? 'channel:share' : null
        }

        if (detail[1] === 'publisher') {
            if (detail.length === 2 && normalizedMethod === 'GET') return 'project:read'
            if (detail.length === 2 && normalizedMethod === 'DELETE') return 'channel:manage'
            if (
                detail[2] === 'custom-http' &&
                detail[3] === 'connect' &&
                detail.length === 4 &&
                normalizedMethod === 'POST'
            ) {
                return 'channel:manage'
            }
            return null
        }

        if (detail.length === 2 && detail[1] === 'profile') {
            return normalizedMethod === 'GET' ? 'project:read' : null
        }
        if (detail.length === 2 && detail[1] === 'profile-drafts') {
            return normalizedMethod === 'POST' ? 'channel:manage' : null
        }
        if (
            detail.length === 4 &&
            detail[1] === 'profile-drafts' &&
            ['preview', 'activate'].includes(detail[3] ?? '') &&
            normalizedMethod === 'POST'
        ) {
            return 'channel:manage'
        }

        if (detail.length === 1 && ['PATCH', 'DELETE'].includes(normalizedMethod)) {
            return 'channel:manage'
        }
        if (
            detail.length === 2 &&
            ['archive', 'restore'].includes(detail[1] ?? '') &&
            normalizedMethod === 'POST'
        ) {
            return 'channel:manage'
        }
        return null
    }

    if (resource === 'channel-occupancy' && detail.length === 0 && normalizedMethod === 'GET') {
        return 'project:read'
    }

    if (resource === 'publishers' && detail.length === 0 && normalizedMethod === 'GET') {
        return 'project:read'
    }

    if (resource === 'publication-composer-draft' && detail.length === 0) {
        if (normalizedMethod === 'GET') return 'project:read'
        return ['PUT', 'DELETE'].includes(normalizedMethod) ? 'publication:manage' : null
    }

    if (resource === 'posts') {
        if (detail.length === 0 && normalizedMethod === 'POST') return 'publication:manage'
        if (detail.length === 1 && normalizedMethod === 'GET') return 'project:read'
        if (detail.length === 1 && normalizedMethod === 'PATCH') return 'publication:manage'
        if (detail.length === 2 && detail[1] === 'destinations' && normalizedMethod === 'POST')
            return 'publication:manage'
        return null
    }

    if (resource === 'publications') {
        if (detail.length === 2 && detail[1] === 'move' && normalizedMethod === 'POST')
            return 'publication:manage'
        if (detail.length === 2 && detail[1] === 'cadence' && normalizedMethod === 'GET')
            return 'project:read'
        if (detail.length === 2 && detail[1] === 'cadence-override' && normalizedMethod === 'POST')
            return 'publication:dispatch'
        if (detail.length === 2 && detail[1] === 'first-comment') {
            if (normalizedMethod === 'GET') return 'project:read'
            return normalizedMethod === 'PUT' ? 'publication:dispatch' : null
        }
        if (
            detail.length === 3 &&
            detail[1] === 'first-comment' &&
            detail[2] === 'cancel' &&
            normalizedMethod === 'POST'
        )
            return 'publication:dispatch'

        if (detail.length === 0 && normalizedMethod === 'GET') return 'project:read'
        if (detail.length === 1 && detail[0] === 'due' && normalizedMethod === 'GET') {
            return 'project:read'
        }
        if (
            detail.length === 2 &&
            detail[1] === 'approval-request' &&
            normalizedMethod === 'POST'
        ) {
            return 'publication:manage'
        }
        if (
            detail.length === 1 &&
            ['schedule', 'cancel'].includes(detail[0] ?? '') &&
            normalizedMethod === 'PATCH'
        ) {
            return 'publication:dispatch'
        }
        if (detail.length === 1 && normalizedMethod === 'DELETE') return 'publication:manage'
        if (detail[1] === 'tags' && detail.length === 2) {
            if (normalizedMethod === 'GET') return 'project:read'
            return normalizedMethod === 'PUT' ? 'publication:manage' : null
        }
        if (
            detail.length === 3 &&
            detail[1] === 'draft' &&
            detail[2] === 'adoptions' &&
            normalizedMethod === 'GET'
        )
            return 'project:read'
        if (
            detail.length === 2 &&
            ['editor', 'destination'].includes(detail[1] ?? '') &&
            normalizedMethod === 'GET'
        ) {
            return 'project:read'
        }
        if (detail.length === 2 && detail[1] === 'duplicate' && normalizedMethod === 'POST') {
            return 'publication:manage'
        }
        if (detail[1] === 'draft' && detail.length === 2 && normalizedMethod === 'PATCH') {
            return 'publication:manage'
        }
        if (detail[1] === 'draft' && detail.length === 3 && normalizedMethod === 'POST') {
            if (['rebase', 'adopt-profile', 'assess-adoption'].includes(detail[2] ?? ''))
                return 'publication:manage'
            if (detail[2] === 'promote') return 'publication:dispatch'
        }
        if (
            detail.length === 2 &&
            ['publish', 'retry', 'reconcile', 'confirm-destination'].includes(detail[1] ?? '') &&
            normalizedMethod === 'POST'
        ) {
            return 'publication:dispatch'
        }
        return null
    }

    if (resource === 'analytics') {
        if (detail.length === 0 && normalizedMethod === 'GET') return 'project:read'
        if (
            (detail.length === 2 || (detail.length === 3 && detail[2] === 'latest')) &&
            detail[0] === 'provider' &&
            ['bluesky', 'devto', 'mastodon'].includes(detail[1] ?? '') &&
            normalizedMethod === 'GET'
        ) {
            return 'project:read'
        }
        if (
            detail.length === 3 &&
            detail[0] === 'provider' &&
            ['bluesky', 'devto', 'mastodon'].includes(detail[1] ?? '') &&
            detail[2] === 'collect' &&
            normalizedMethod === 'POST'
        ) {
            return 'analytics:refresh'
        }
        return null
    }

    if (resource === 'media') {
        if (detail.length === 2 && detail[1] === 'permanent' && normalizedMethod === 'POST') {
            return 'media:permanently_delete'
        }
        if (detail.length === 0 && normalizedMethod === 'GET') return 'project:read'
        if (
            detail.length === 1 &&
            ['upload-policy', 'sources'].includes(detail[0] ?? '') &&
            normalizedMethod === 'GET'
        ) {
            return 'project:read'
        }
        if (detail[0] === 'uploads') {
            if (detail.length === 1 && normalizedMethod === 'POST') return 'media:manage'
            if (detail.length === 2 && normalizedMethod === 'PUT') return 'media:manage'
            if (detail.length === 3 && detail[2] === 'finalize' && normalizedMethod === 'POST') {
                return 'media:manage'
            }
            return null
        }
        if (
            detail.length === 2 &&
            detail[0] === 'imports' &&
            detail[1] === 'url' &&
            normalizedMethod === 'POST'
        ) {
            return 'media:manage'
        }
        if (detail.length === 1 && detail[0] === 'deletion-requests') {
            return normalizedMethod === 'POST' ? 'media:manage' : null
        }
        if (detail.length === 1) {
            if (normalizedMethod === 'GET') return 'project:read'
            if (normalizedMethod === 'DELETE') return 'media:manage'
            return null
        }
        if (detail.length === 2 && ['usage', 'content'].includes(detail[1] ?? '')) {
            return normalizedMethod === 'GET' ? 'project:read' : null
        }
        if (detail.length === 2 && detail[1] === 'restore') {
            return normalizedMethod === 'POST' ? 'media:manage' : null
        }
        return null
    }

    if (resource === 'category') {
        return normalizedMethod === 'PATCH' ? 'publication:manage' : null
    }

    if (resource === 'tags') {
        if (detail.length === 0 && normalizedMethod === 'GET') return 'project:read'
        if (detail.length === 0 && normalizedMethod === 'POST') return 'publication:manage'
        if (detail.length === 1 && normalizedMethod === 'PATCH') return 'publication:manage'
        if (
            detail.length === 2 &&
            ['archive', 'restore'].includes(detail[1] ?? '') &&
            normalizedMethod === 'POST'
        ) {
            return 'publication:manage'
        }
        return null
    }

    return null
}

export function canApiKeyAccessRequest(
    method: string,
    requestPath: string,
    permissions: PostdotApiKeyPermissions
): boolean {
    const required = requiredApiKeyCapability(method, requestPath)
    if (required === null) return false
    if (permissions === null) return true

    const [resource, action] = capabilityStatements[required]
    return permissions[resource]?.includes(action) ?? false
}
