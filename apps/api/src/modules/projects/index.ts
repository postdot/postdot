import type { HeraldAuth } from '@herald/auth'
import type { BlueskyFetcher } from '@herald/bluesky'
import type {
    AnalyticsStore,
    AccessStore,
    EventJournalStore,
    MediaAssetStore,
    NotificationStore,
    ProviderAnalyticsStore,
    ProjectApiKeyActorStore,
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
import { registerChannelProfilePresetRoutes } from './channel-profile-preset-routes'
import { registerChannelProfileRoutes } from './channel-profile-routes'
import { registerChannelRoutes } from './channel-routes'
import { registerProjectMemberRoutes } from './member-routes'
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
    readonly now?: () => number
    readonly discordFetcher?: DiscordFetcher
    readonly devtoFetcher?: DevtoFetcher
    readonly apiKeyActors: ProjectApiKeyActorStore
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
        authenticateBetterAuthProjectApiKey: async token => {
            if (!token.startsWith('herald_pat_')) return null

            try {
                const verified = await options.auth.api.verifyApiKey({ body: { key: token } })
                if (!verified.valid || verified.key === null) return null

                const metadata = verified.key.metadata
                if (typeof metadata !== 'object' || metadata === null) return null
                const projectId = (metadata as { heraldProjectId?: unknown }).heraldProjectId
                if (typeof projectId !== 'string' || projectId.length === 0) return null

                const organizationId = options.access.getProjectOrganizationId(projectId)
                if (organizationId === null || organizationId !== verified.key.referenceId) {
                    return null
                }

                return {
                    id: verified.key.id,
                    projectId,
                    actorId: `api-key:${verified.key.id}`,
                    subjectId: `api-key:${verified.key.id}`,
                    displayName: `API key: ${verified.key.name ?? verified.key.id}`,
                }
            } catch {
                return null
            }
        },
        authorizeProjectSessionAccess: (projectId, userId) => {
            return options.access.canAccessProject(projectId, userId)
        },
    })
    const accessRoutes = registerAccessRoutes(authenticated, options.access, options.auth)
    const providerApplicationRoutes = registerProviderApplicationRoutes(
        accessRoutes,
        options.publisher,
        options.access
    )
    const channelProfilePresetRoutes = registerChannelProfilePresetRoutes(providerApplicationRoutes)
    const projectRoutes = registerProjectRoutes(
        channelProfilePresetRoutes,
        options.manualStore,
        options.access,
        options.auth
    )
    const projectMemberRoutes = registerProjectMemberRoutes(
        projectRoutes,
        options.auth,
        options.access
    )
    const taxonomyRoutes = registerTaxonomyRoutes(
        projectMemberRoutes,
        options.taxonomy,
        options.access
    )
    const accessTokenRoutes = registerProjectAccessTokenRoutes(
        taxonomyRoutes,
        options.auth,
        options.access,
        options.apiKeyActors,
        options.now
    )
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
    const publicationRoutes = registerPublicationRoutes(postRoutes, options.manualStore, {
        onWorkScheduled: options.onWorkScheduled,
    })
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
