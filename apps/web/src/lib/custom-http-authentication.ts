import { isWebhookMode } from '@postdot/core'

import type { CustomHttpAuthentication } from '@/lib/api'

type AuthenticationKind = CustomHttpAuthentication['kind']

/** Mirror the connection boundary, not the request mapping compiler. */
export function customHttpAuthenticationKinds(execution: unknown): readonly AuthenticationKind[] {
    if (!record(execution) || execution.kind !== 'declarative_http') return []
    if (typeof execution.mode === 'string' && isWebhookMode(execution.mode))
        return ['none', 'bearer', 'header']
    if (execution.mode !== 'mapped_http' || !record(execution.request)) return []
    const path = execution.request.path
    if (!Array.isArray(path)) return []
    const secrets = path.filter(segment => record(segment) && segment.kind === 'secret').length
    return secrets === 1 ? ['path'] : secrets === 0 ? ['none', 'bearer', 'header'] : []
}

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
