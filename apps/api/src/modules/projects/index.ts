import type { HeraldAuth } from '@herald/auth'
import type { MediaAssetStore } from '@herald/db'

import { createAuthenticatedElysia } from '../../plugins/auth'
import { registerMediaRoutes } from '../media/routes'
import { registerAuditEventRoutes } from './audit-event-routes'
import { registerChannelProfileRoutes } from './channel-profile-routes'
import { registerChannelRoutes } from './channel-routes'
import { registerPostRoutes } from './post-routes'
import { registerPublicationRoutes } from './publication-routes'
import { registerPublisherRoutes } from './publisher-routes'
import { registerProjectRoutes } from './routes'
import type { ManualStore, PublisherRuntime } from './types'

export interface ProjectModuleOptions {
    readonly auth: HeraldAuth
    readonly manualStore: ManualStore
    readonly publisher: PublisherRuntime
    readonly media?: MediaAssetStore
    readonly onWorkScheduled?: () => void
}

export function createProjectModule(options: ProjectModuleOptions) {
    const authenticated = createAuthenticatedElysia(options.auth)
    const projectRoutes = registerProjectRoutes(authenticated, options.manualStore)
    const channelRoutes = registerChannelRoutes(projectRoutes, options.manualStore)
    const channelProfileRoutes = registerChannelProfileRoutes(channelRoutes, options.manualStore)
    const publisherRoutes = registerPublisherRoutes(channelProfileRoutes, options.publisher, {
        onWorkScheduled: options.onWorkScheduled,
    })
    const postRoutes = registerPostRoutes(publisherRoutes, options.manualStore, {
        onWorkScheduled: options.onWorkScheduled,
    })
    const publicationRoutes = registerPublicationRoutes(postRoutes, options.manualStore)
    const mediaRoutes =
        options.media === undefined
            ? publicationRoutes
            : registerMediaRoutes(publicationRoutes, options.media)
    return registerAuditEventRoutes(mediaRoutes, options.manualStore)
}
