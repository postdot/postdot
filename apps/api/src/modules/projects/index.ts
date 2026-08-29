import type { HeraldAuth } from '@herald/auth'

import { createAuthenticatedElysia } from '../../plugins/auth'
import { registerAuditEventRoutes } from './audit-event-routes'
import { registerChannelRoutes } from './channel-routes'
import { registerPostRoutes } from './post-routes'
import { registerPublicationRoutes } from './publication-routes'
import { registerPublisherRoutes } from './publisher-routes'
import { registerProjectRoutes } from './routes'
import type { ManualStore, PublisherStore } from './types'

export interface ProjectModuleOptions {
    readonly auth: HeraldAuth
    readonly manualStore: ManualStore
    readonly publisherStore: PublisherStore
    readonly webOrigin?: string
    readonly onWorkScheduled?: () => void
}

export function createProjectModule(options: ProjectModuleOptions) {
    const authenticated = createAuthenticatedElysia(options.auth)
    const projectRoutes = registerProjectRoutes(authenticated, options.manualStore)
    const channelRoutes = registerChannelRoutes(projectRoutes, options.manualStore)
    const publisherRoutes = registerPublisherRoutes(
        channelRoutes,
        options.auth,
        options.publisherStore,
        {
            webOrigin: options.webOrigin,
            onWorkScheduled: options.onWorkScheduled,
        }
    )
    const postRoutes = registerPostRoutes(publisherRoutes, options.manualStore, {
        onWorkScheduled: options.onWorkScheduled,
    })
    const publicationRoutes = registerPublicationRoutes(postRoutes, options.manualStore)
    return registerAuditEventRoutes(publicationRoutes, options.manualStore)
}
