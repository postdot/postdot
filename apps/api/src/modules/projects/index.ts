import type { HeraldAuth } from '@herald/auth'
import type { BlueskyFetcher } from '@herald/bluesky'
import type {
    AnalyticsStore,
    AccessStore,
    EventJournalStore,
    MediaAssetStore,
    NotificationStore,
    ProviderAnalyticsStore,
    ProjectAccessTokenStore,
    TaxonomyStore,
} from '@herald/db'
import type { DevtoFetcher } from '@herald/devto'
import type { DiscordFetcher } from '@herald/discord'
import type { Logger } from 'pino'

import { createAuthenticatedElysia } from '../../plugins/auth'
import { registerAccessRoutes } from '../access/routes'
import { registerMediaRoutes } from '../media/routes'
import { registerProviderApplicationRoutes } from '../publishers/application-config-routes'
import { registerProjectAccessTokenRoutes } from './access-token-routes'
import { registerAnalyticsRoutes } from './analytics-routes'
import { registerAuditEventRoutes } from './audit-event-routes'
import { createBlueskyAnalyticsService } from './bluesky-analytics-service'
import { registerChannelProfileRoutes } from './channel-profile-routes'
import { registerChannelRoutes } from './channel-routes'
import { registerNotificationRoutes } from './notification-routes'
import { registerPostRoutes } from './post-routes'
import { registerProviderAnalyticsRoutes } from './provider-analytics-routes'
import { registerPublicationRoutes } from './publication-routes'
import { registerPublisherRoutes } from './publisher-routes'
import { registerRealtimeRoutes } from './realtime-routes'
import type { ProjectRealtimeHub, UserRealtimeHub } from './realtime-runtime'
import { registerProjectRoutes } from './routes'
import { registerTaxonomyRoutes } from './taxonomy-routes'
import type { ManualStore, PublisherRuntime } from './types'

export interface ProjectModuleOptions {
    readonly auth: HeraldAuth
    readonly manualStore: ManualStore
    readonly publisher: PublisherRuntime
    readonly media?: MediaAssetStore
    readonly logger?: Logger
    readonly onWorkScheduled?: () => void
    readonly discordFetcher?: DiscordFetcher
    readonly devtoFetcher?: DevtoFetcher
    readonly accessTokens?: ProjectAccessTokenStore
    readonly access: AccessStore
    readonly notifications: NotificationStore
    readonly analytics: AnalyticsStore
    readonly providerAnalytics: ProviderAnalyticsStore
    readonly taxonomy: TaxonomyStore
    readonly blueskyAnalyticsFetcher?: BlueskyFetcher
    readonly blueskyAnalyticsTimeoutMs?: number
    readonly blueskyAnalyticsNow?: () => number
    readonly eventJournal: EventJournalStore
    readonly projectChanges?: ProjectRealtimeHub
    readonly userChanges?: UserRealtimeHub
}

export function createProjectModule(options: ProjectModuleOptions) {
    const authenticated = createAuthenticatedElysia(options.auth, {
        authenticateProjectAccessToken: options.accessTokens?.authenticate,
        authorizeProjectSessionAccess: (projectId, userId) =>
            // A project with no membership rows is a legacy fixture/data set;
            // its existing actor-backed store remains the compatibility guard
            // until the membership backfill has been applied. Once any durable
            // membership exists, it becomes authoritative.
            options.access.listProjectMemberships(projectId).length === 0 ||
            options.access.canAccessProject(projectId, userId),
    })
    const accessRoutes = registerAccessRoutes(authenticated, options.access)
    const providerApplicationRoutes = registerProviderApplicationRoutes(
        accessRoutes,
        options.publisher,
        options.access
    )
    const projectRoutes = registerProjectRoutes(
        providerApplicationRoutes,
        options.manualStore,
        options.access
    )
    const taxonomyRoutes = registerTaxonomyRoutes(projectRoutes, options.taxonomy, options.access)
    const accessTokenRoutes = registerProjectAccessTokenRoutes(taxonomyRoutes, options.accessTokens)
    const channelRoutes = registerChannelRoutes(accessTokenRoutes, options.manualStore)
    const channelProfileRoutes = registerChannelProfileRoutes(channelRoutes, options.manualStore)
    const publisherRoutes = registerPublisherRoutes(channelProfileRoutes, options.publisher, {
        logger: options.logger,
        onWorkScheduled: options.onWorkScheduled,
        discordFetcher: options.discordFetcher,
        devtoFetcher: options.devtoFetcher,
    })
    const postRoutes = registerPostRoutes(publisherRoutes, options.manualStore, {
        onWorkScheduled: options.onWorkScheduled,
    })
    const publicationRoutes = registerPublicationRoutes(postRoutes, options.manualStore)
    const mediaRoutes = registerMediaRoutes(publicationRoutes, options.media)
    const notificationRoutes = registerNotificationRoutes(mediaRoutes, options.notifications)
    const analyticsRoutes = registerAnalyticsRoutes(notificationRoutes, options.analytics)
    const providerAnalyticsRoutes = registerProviderAnalyticsRoutes(
        analyticsRoutes,
        options.providerAnalytics,
        createBlueskyAnalyticsService({
            providerAnalytics: options.providerAnalytics,
            publisher: options.publisher,
            fetcher: options.blueskyAnalyticsFetcher,
            timeoutMs: options.blueskyAnalyticsTimeoutMs,
            now: options.blueskyAnalyticsNow,
        })
    )
    const auditRoutes = registerAuditEventRoutes(providerAnalyticsRoutes, options.manualStore)
    return registerRealtimeRoutes(
        auditRoutes,
        options.eventJournal,
        options.notifications,
        options.projectChanges,
        options.userChanges
    )
}
