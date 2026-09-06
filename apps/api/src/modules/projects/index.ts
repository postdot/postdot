import type { HeraldAuth } from '@herald/auth'
import type {
    AnalyticsStore,
    MediaAssetStore,
    NotificationStore,
    ProjectAccessTokenStore,
} from '@herald/db'
import type { Logger } from 'pino'

import { createAuthenticatedElysia } from '../../plugins/auth'
import { registerMediaRoutes } from '../media/routes'
import { registerProjectAccessTokenRoutes } from './access-token-routes'
import { registerAnalyticsRoutes } from './analytics-routes'
import { registerAuditEventRoutes } from './audit-event-routes'
import { registerChannelProfileRoutes } from './channel-profile-routes'
import { registerChannelRoutes } from './channel-routes'
import { registerNotificationRoutes } from './notification-routes'
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
    readonly logger?: Logger
    readonly onWorkScheduled?: () => void
    readonly accessTokens?: ProjectAccessTokenStore
    readonly notifications: NotificationStore
    readonly analytics: AnalyticsStore
}

export function createProjectModule(options: ProjectModuleOptions) {
    const authenticated = createAuthenticatedElysia(options.auth, {
        authenticateProjectAccessToken: options.accessTokens?.authenticate,
    })
    const projectRoutes = registerProjectRoutes(authenticated, options.manualStore)
    const accessTokenRoutes = registerProjectAccessTokenRoutes(projectRoutes, options.accessTokens)
    const channelRoutes = registerChannelRoutes(accessTokenRoutes, options.manualStore)
    const channelProfileRoutes = registerChannelProfileRoutes(channelRoutes, options.manualStore)
    const publisherRoutes = registerPublisherRoutes(channelProfileRoutes, options.publisher, {
        logger: options.logger,
        onWorkScheduled: options.onWorkScheduled,
    })
    const postRoutes = registerPostRoutes(publisherRoutes, options.manualStore, {
        onWorkScheduled: options.onWorkScheduled,
    })
    const publicationRoutes = registerPublicationRoutes(postRoutes, options.manualStore)
    const mediaRoutes = registerMediaRoutes(publicationRoutes, options.media)
    const notificationRoutes = registerNotificationRoutes(mediaRoutes, options.notifications)
    const analyticsRoutes = registerAnalyticsRoutes(notificationRoutes, options.analytics)
    return registerAuditEventRoutes(analyticsRoutes, options.manualStore)
}
