import { postdotUserApiKeyConfigId, type PostdotAuth } from '@postdot/auth'
import type { BlueskyFetcher, BlueskyThreadReader } from '@postdot/bluesky'
import type { ResourceLifecycleStore } from '@postdot/db'
import type { NotificationEmailStore } from '@postdot/db'
import type {
    AnalyticsStore,
    AccessStore,
    EventJournalStore,
    MediaAssetStore,
    NotificationStore,
    ProviderAnalyticsStore,
    PublicationCommentStore,
    TaxonomyStore,
} from '@postdot/db'
import type { DevtoFetcher } from '@postdot/devto'
import type { DiscordFetcher } from '@postdot/discord'
import type { MastodonThreadReader, MastodonAnalyticsReader } from '@postdot/mastodon'
import type { TelegramFetcher } from '@postdot/telegram'
import type { Logger } from 'pino'

import { createAuthenticatedElysia } from '../../plugins/auth'
import { createBlueskyAnalyticsService } from '../../providers/bluesky/analytics'
import { createDevtoAnalyticsService } from '../../providers/devto/analytics'
import { createMastodonAnalyticsService } from '../../providers/mastodon/analytics'
import type { RecoveryService } from '../../recovery'
import { readUserApiKeyMetadata, registerUserApiKeyRoutes } from '../access/api-key-routes'
import { registerAccessRoutes } from '../access/routes'
import { registerWorkspaceRoutes } from '../access/workspace-routes'
import type { EmailSettingsService } from '../email/settings'
import { registerEmailSettingsRoutes } from '../email/settings-routes'
import { registerMediaRoutes } from '../media/routes'
import type { MediaUrlImporter } from '../media/url-import'
import { registerProviderApplicationRoutes } from '../publishers/application-config-routes'
import { registerRecoveryRoutes } from '../recovery/routes'
import { registerProjectAccessGrantRoutes } from './access-grant-routes'
import { registerAnalyticsRoutes } from './analytics-routes'
import { canApiKeyAccessRequest, requiredApiKeyCapability } from './api-key-permissions'
import { registerAuditEventRoutes } from './audit-event-routes'
import { createChannelAccessPolicy } from './channel-access-policy'
import { registerChannelProfilePresetRoutes } from './channel-profile-preset-routes'
import { registerChannelProfileRoutes } from './channel-profile-routes'
import { registerChannelRoutes } from './channel-routes'
import { registerMastodonAnalyticsRoutes } from './mastodon-analytics-routes'
import { registerProjectMemberRoutes } from './member-routes'
import { registerNotificationRoutes } from './notification-routes'
import { registerPostRoutes } from './post-routes'
import { registerProviderAnalyticsRoutes } from './provider-analytics-routes'
import { registerPublicationCommentsRoutes } from './publication-comments-routes'
import { registerPublicationFirstCommentRoutes } from './publication-first-comment-routes'
import type { PublicationFirstCommentService } from './publication-first-comment-service'
import { registerPublicationRepliesRoutes } from './publication-replies-routes'
import type { PublicationRepliesService } from './publication-replies-service'
import { registerPublicationRoutes } from './publication-routes'
import { registerPublisherRoutes } from './publisher-routes'
import { registerRealtimeRoutes } from './realtime-routes'
import type { ProjectRealtimeHub, UserRealtimeHub } from './realtime-runtime'
import { registerResourceLifecycleRoutes } from './resource-lifecycle-routes'
import { registerProjectRoutes } from './routes'
import { registerSearchRoutes } from './search-routes'
import { registerTaxonomyRoutes } from './taxonomy-routes'
import type { ManualStore, PublisherRuntime } from './types'
import { registerWorkspaceChannelRoutes } from './workspace-channel-routes'

function isProjectAccessPath(projectId: string, requestPath: string): boolean {
    const basePath = `/api/projects/${projectId}/`
    return ['members', 'user-grants', 'team-grants', 'invitations', 'lifecycle'].some(segment => {
        const path = `${basePath}${segment}`
        return requestPath === path || requestPath.startsWith(`${path}/`)
    })
}

export interface ProjectModuleOptions {
    readonly resourceLifecycle: ResourceLifecycleStore
    readonly auth: PostdotAuth
    readonly manualStore: ManualStore
    readonly publisher: PublisherRuntime
    readonly media?: MediaAssetStore
    readonly mediaUrlImporter?: MediaUrlImporter
    readonly logger?: Logger
    readonly onWorkScheduled?: () => void
    readonly now?: () => number
    readonly discordFetcher?: DiscordFetcher
    readonly telegramFetcher?: TelegramFetcher
    readonly devtoFetcher?: DevtoFetcher
    readonly access: AccessStore
    readonly recovery?: RecoveryService
    readonly emailSettings?: EmailSettingsService
    readonly emailAlerts?: {
        store: NotificationEmailStore
        available: boolean | (() => boolean)
    }
    readonly notifications: NotificationStore
    readonly analytics: AnalyticsStore
    readonly publicationFirstComments: PublicationFirstCommentService
    readonly publicationReplies: PublicationRepliesService
    readonly publicationComments: PublicationCommentStore
    readonly blueskyCommentsReader?: BlueskyThreadReader
    readonly mastodonCommentsReader?: MastodonThreadReader
    readonly mastodonAnalyticsReader?: MastodonAnalyticsReader
    readonly providerAnalytics: ProviderAnalyticsStore
    readonly taxonomy: TaxonomyStore
    readonly blueskyAnalyticsFetcher?: BlueskyFetcher
    readonly blueskyAnalyticsTimeoutMs?: number
    readonly blueskyAnalyticsNow?: () => number
    readonly eventJournal: EventJournalStore
    readonly projectChanges?: ProjectRealtimeHub
    readonly userChanges?: UserRealtimeHub
}

/** Keys issued before the Postdot rename keep their original prefix; new keys use the first one. */
const userApiKeyPrefixes = ['postdot_pat_', 'postbot_pat_'] as const

export function createProjectModule(options: ProjectModuleOptions) {
    const authenticated = createAuthenticatedElysia(options.auth, {
        resourceLifecycle: options.resourceLifecycle,
        authorizeRetirementReceipt: (projectId, userId, path) =>
            path === `/api/projects/${projectId}/lifecycle` &&
            options.resourceLifecycle.canReadReceipt('project', projectId, userId),
        authenticateBetterAuthProjectApiKey: async token => {
            if (!userApiKeyPrefixes.some(prefix => token.startsWith(prefix))) return null

            try {
                const userVerified = await options.auth.api.verifyApiKey({
                    body: { configId: postdotUserApiKeyConfigId, key: token },
                })
                if (userVerified.valid && userVerified.key !== null) {
                    const metadata = readUserApiKeyMetadata(userVerified.key.metadata)
                    if (metadata !== null) {
                        return {
                            projectIds:
                                metadata.postdotProjectAccess === 'all'
                                    ? null
                                    : (metadata.postdotProjectIds ?? []),
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
        // One shared decision for sessions and API keys: live project access
        // first, then the documented workspace-manager reach limited to the
        // project access surface.
        authorizeProjectAccess: (projectId, userId, requestPath, requestContext) => {
            if (options.access.canAccessProject(projectId, userId)) {
                const channelId = requestPath.match(
                    /^\/api\/projects\/[^/]+\/channels\/([^/]+)/
                )?.[1]
                const managementWrite =
                    requestContext &&
                    (requiredApiKeyCapability(requestContext.method, requestPath) ===
                        'channel:manage' ||
                        requestPath.includes('/publisher/'))
                if (
                    channelId &&
                    managementWrite &&
                    (!options.resourceLifecycle ||
                        options.resourceLifecycle.projectState(projectId) === 'active')
                ) {
                    const ctx = options.manualStore.sharedChannels.contextFor({
                        contextProjectId: projectId,
                        subjectId: userId,
                        authorization: createChannelAccessPolicy({
                            access: options.access,
                            userId,
                            authMethod: requestContext.authMethod,
                            apiKeyProjectIds: requestContext.apiKeyProjectIds,
                            apiKeyPermissions: requestContext.apiKeyPermissions,
                        }),
                    })
                    return (
                        ctx !== null &&
                        options.manualStore.sharedChannels.getCadence(ctx, channelId)?.canManage ===
                            true
                    )
                }
                return true
            }
            if (!isProjectAccessPath(projectId, requestPath)) return false
            const workspaceId = options.access.getProjectWorkspaceId(projectId)
            return workspaceId !== null && options.access.canManageWorkspace(workspaceId, userId)
        },
    })
    const emailSettingsRoutes = registerEmailSettingsRoutes(
        registerRecoveryRoutes(authenticated, options.access, options.recovery),
        options.access,
        options.emailSettings
    )
    const accessRoutes = registerAccessRoutes(emailSettingsRoutes, options.access, options.auth)
    const userApiKeyRoutes = registerUserApiKeyRoutes(
        accessRoutes,
        options.auth,
        options.access,
        options.now
    )
    const workspaceRoutes = registerWorkspaceRoutes(
        userApiKeyRoutes,
        options.auth,
        options.access,
        options.resourceLifecycle
    )
    const providerApplicationRoutes = registerProviderApplicationRoutes(
        registerWorkspaceChannelRoutes(
            workspaceRoutes,
            options.manualStore,
            options.access,
            options.onWorkScheduled
        ),
        options.publisher,
        options.access
    )
    const channelProfilePresetRoutes = registerChannelProfilePresetRoutes(providerApplicationRoutes)
    const projectRoutes = registerProjectRoutes(
        registerResourceLifecycleRoutes(
            channelProfilePresetRoutes,
            options.access,
            options.resourceLifecycle
        ),
        options.manualStore,
        options.access,
        options.resourceLifecycle
    )
    const searchRoutes = registerSearchRoutes(projectRoutes, options.manualStore, options.access)
    const projectMemberRoutes = registerProjectMemberRoutes(
        searchRoutes,
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
    const channelRoutes = registerChannelRoutes(
        taxonomyRoutes,
        options.manualStore,
        options.access,
        options.onWorkScheduled
    )
    const channelProfileRoutes = registerChannelProfileRoutes(
        channelRoutes,
        options.manualStore,
        options.access
    )
    const publisherRoutes = registerPublisherRoutes(channelProfileRoutes, options.publisher, {
        channels: options.manualStore,
        access: options.access,
        logger: options.logger,
        onWorkScheduled: options.onWorkScheduled,
        discordFetcher: options.discordFetcher,
        telegramFetcher: options.telegramFetcher,
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
            projectChanges: options.projectChanges,
        }
    )
    const mediaRoutes = registerMediaRoutes(publicationRoutes, options.media, options.access, {
        urlImporter: options.mediaUrlImporter,
    })
    const notificationRoutes = registerNotificationRoutes(
        mediaRoutes,
        options.notifications,
        options.emailAlerts
    )
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
    const mastodonAnalyticsRoutes = registerMastodonAnalyticsRoutes(
        providerAnalyticsRoutes,
        options.providerAnalytics,
        createMastodonAnalyticsService({
            providerAnalytics: options.providerAnalytics,
            manual: options.manualStore,
            access: options.access,
            reader: options.mastodonAnalyticsReader,
            now: options.now,
        }),
        options.access
    )
    const commentRoutes = registerPublicationCommentsRoutes(mastodonAnalyticsRoutes, {
        store: options.publicationComments,
        manual: options.manualStore,
        access: options.access,
        reader: options.blueskyCommentsReader,
        mastodonReader: options.mastodonCommentsReader,
        now: options.now,
    })
    const replyRoutes = registerPublicationRepliesRoutes(commentRoutes, {
        replies: options.publicationReplies,
        access: options.access,
        onWorkScheduled: options.onWorkScheduled,
    })
    const firstCommentRoutes = registerPublicationFirstCommentRoutes(replyRoutes, {
        firstComments: options.publicationFirstComments,
        access: options.access,
        onWorkScheduled: options.onWorkScheduled,
    })
    const auditRoutes = registerAuditEventRoutes(firstCommentRoutes, options.manualStore)
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
