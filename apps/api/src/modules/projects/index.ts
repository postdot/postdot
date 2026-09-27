import { heraldUserApiKeyConfigId, type HeraldAuth } from '@herald/auth'
import type { BlueskyFetcher } from '@herald/bluesky'
import type {
    AnalyticsStore,
    AccessStore,
    EventJournalStore,
    MediaAssetStore,
    NotificationStore,
    ProviderAnalyticsStore,
    TaxonomyStore,
} from '@herald/db'
import type { DevtoFetcher } from '@herald/devto'
import type { DiscordFetcher } from '@herald/discord'
import type { Logger } from 'pino'

import { createAuthenticatedElysia } from '../../plugins/auth'
import { readUserApiKeyMetadata, registerUserApiKeyRoutes } from '../access/api-key-routes'
import { registerAccessRoutes } from '../access/routes'
import { registerWorkspaceRoutes } from '../access/workspace-routes'
import { registerMediaRoutes } from '../media/routes'
import type { MediaUrlImporter } from '../media/url-import'
import { registerProviderApplicationRoutes } from '../publishers/application-config-routes'
import { registerProjectAccessGrantRoutes } from './access-grant-routes'
import { registerAnalyticsRoutes } from './analytics-routes'
import { canApiKeyAccessRequest } from './api-key-permissions'
import { registerAuditEventRoutes } from './audit-event-routes'
import { createBlueskyAnalyticsService } from './bluesky-analytics-service'
import { registerChannelProfilePresetRoutes } from './channel-profile-preset-routes'
import { registerChannelProfileRoutes } from './channel-profile-routes'
import { registerChannelRoutes } from './channel-routes'
import { createDevtoAnalyticsService } from './devto-analytics-service'
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

function isProjectAccessPath(projectId: string, requestPath: string): boolean {
    const basePath = `/api/projects/${projectId}/`
    return ['members', 'user-grants', 'team-grants', 'invitations'].some(segment => {
        const path = `${basePath}${segment}`
        return requestPath === path || requestPath.startsWith(`${path}/`)
    })
}

export interface ProjectModuleOptions {
    readonly auth: HeraldAuth
    readonly manualStore: ManualStore
    readonly publisher: PublisherRuntime
    readonly media?: MediaAssetStore
    readonly mediaUrlImporter?: MediaUrlImporter
    readonly logger?: Logger
    readonly onWorkScheduled?: () => void
    readonly now?: () => number
    readonly discordFetcher?: DiscordFetcher
    readonly devtoFetcher?: DevtoFetcher
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
                const userVerified = await options.auth.api.verifyApiKey({
                    body: { configId: heraldUserApiKeyConfigId, key: token },
                })
                if (userVerified.valid && userVerified.key !== null) {
                    const metadata = readUserApiKeyMetadata(userVerified.key.metadata)
                    if (metadata !== null) {
                        return {
                            projectIds:
                                metadata.heraldProjectAccess === 'all'
                                    ? null
                                    : (metadata.heraldProjectIds ?? []),
                            ownerUserId: userVerified.key.referenceId,
                            displayName: `API key: ${userVerified.key.name ?? userVerified.key.id}`,
                            permissions: userVerified.key.permissions,
                        }
                    }
                }
                return null
            } catch {
                return null
            }
        },
        authorizeUserApiKeyRequest: canApiKeyAccessRequest,
        authorizeProjectSessionAccess: (projectId, userId, requestPath) => {
            if (options.access.canAccessProject(projectId, userId)) return true
            if (!isProjectAccessPath(projectId, requestPath)) return false
            const workspaceId = options.access.getProjectWorkspaceId(projectId)
            return workspaceId !== null && options.access.canManageWorkspace(workspaceId, userId)
        },
    })
    const accessRoutes = registerAccessRoutes(authenticated, options.access, options.auth)
    const userApiKeyRoutes = registerUserApiKeyRoutes(
        accessRoutes,
        options.auth,
        options.access,
        options.now
    )
    const workspaceRoutes = registerWorkspaceRoutes(userApiKeyRoutes, options.auth, options.access)
    const providerApplicationRoutes = registerProviderApplicationRoutes(
        workspaceRoutes,
        options.publisher,
        options.access
    )
    const channelProfilePresetRoutes = registerChannelProfilePresetRoutes(providerApplicationRoutes)
    const projectRoutes = registerProjectRoutes(
        channelProfilePresetRoutes,
        options.manualStore,
        options.access
    )
    const projectMemberRoutes = registerProjectMemberRoutes(
        projectRoutes,
        options.auth,
        options.access
    )
    const projectAccessGrantRoutes = registerProjectAccessGrantRoutes(
        projectMemberRoutes,
        options.access
    )
    const taxonomyRoutes = registerTaxonomyRoutes(
        projectAccessGrantRoutes,
        options.taxonomy,
        options.access
    )
    const channelRoutes = registerChannelRoutes(taxonomyRoutes, options.manualStore, options.access)
    const channelProfileRoutes = registerChannelProfileRoutes(
        channelRoutes,
        options.manualStore,
        options.access
    )
    const publisherRoutes = registerPublisherRoutes(channelProfileRoutes, options.publisher, {
        access: options.access,
        logger: options.logger,
        onWorkScheduled: options.onWorkScheduled,
        discordFetcher: options.discordFetcher,
        devtoFetcher: options.devtoFetcher,
    })
    const postRoutes = registerPostRoutes(publisherRoutes, options.manualStore, options.access, {
        onWorkScheduled: options.onWorkScheduled,
    })
    const publicationRoutes = registerPublicationRoutes(
        postRoutes,
        options.manualStore,
        options.access,
        {
            onWorkScheduled: options.onWorkScheduled,
        }
    )
    const mediaRoutes = registerMediaRoutes(publicationRoutes, options.media, options.access, {
        urlImporter: options.mediaUrlImporter,
    })
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
        }),
        createDevtoAnalyticsService({
            providerAnalytics: options.providerAnalytics,
            publisher: options.publisher,
            fetcher: options.devtoFetcher,
            now: options.now,
        }),
        options.access
    )
    const auditRoutes = registerAuditEventRoutes(providerAnalyticsRoutes, options.manualStore)
    return registerRealtimeRoutes(
        auditRoutes,
        options.eventJournal,
        options.notifications,
        options.access,
        options.auth,
        options.projectChanges,
        options.userChanges
    )
}
