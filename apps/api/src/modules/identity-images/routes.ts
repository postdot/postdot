import type { AuthenticatedElysia } from '../projects/types'
import { registerChannelIdentityRoutes } from './channel-routes'
import { registerDownloadIdentityRoutes } from './download-routes'
import { registerProjectIdentityRoutes } from './project-routes'
import type { IdentityImageRoutesOptions } from './shared'
import { registerWorkspaceIdentityRoutes } from './workspace-routes'
export type { IdentityImageRoutesOptions } from './shared'

export function registerIdentityImageRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    options: IdentityImageRoutesOptions
) {
    const downloads = registerDownloadIdentityRoutes(app, options)
    const projects = registerProjectIdentityRoutes(downloads, options)
    const workspaces = registerWorkspaceIdentityRoutes(projects, options)
    return registerChannelIdentityRoutes(workspaces, options)
}
