import { openapi } from '@elysiajs/openapi'
import type { HeraldAuth } from '@herald/auth'
import type { BlueskyFetcher } from '@herald/bluesky'
import {
    createManualStore,
    createAnalyticsStore,
    createEventJournalStore,
    createNotificationStore,
    createProviderAnalyticsStore,
    type HeraldDatabase,
    type ManualStoreOptions,
    type MediaAssetStore,
    type ProjectAccessTokenStore,
    type NotificationStore,
    type AnalyticsStore,
    type ProviderAnalyticsStore,
} from '@herald/db'
import type { DevtoFetcher } from '@herald/devto'
import type { DiscordFetcher } from '@herald/discord'
import { Elysia } from 'elysia'

import type { HeraldLoggingConfig } from './config'
import { createHealthRoutes, type HealthRoutesOptions } from './modules/health/routes'
import type { MediaPublicDelivery } from './modules/media/public-delivery'
import { createPublicMediaRoutes } from './modules/media/public-routes'
import { createProjectModule } from './modules/projects'
import type { ProjectRealtimeHub } from './modules/projects/realtime-runtime'
import { createBlueskyMetadataRoutes } from './modules/publishers/metadata-routes'
import type { PublisherRuntime } from './modules/publishers/runtime'
import { createAuthRoutes } from './plugins/auth'
import { createErrorHandler } from './plugins/error-handler'
import { createHeraldLogger, createRequestLogger } from './plugins/logger'

export interface HeraldAppOptions {
    readonly auth: HeraldAuth
    readonly database: HeraldDatabase
    readonly publisher: PublisherRuntime
    readonly media?: MediaAssetStore
    readonly mediaPublicDelivery?: MediaPublicDelivery
    readonly manualStore?: ManualStoreOptions
    readonly logging?: HeraldLoggingConfig
    readonly onWorkScheduled?: () => void
    readonly discordFetcher?: DiscordFetcher
    readonly devtoFetcher?: DevtoFetcher
    readonly runtime?: HealthRoutesOptions['runtime']
    readonly accessTokens?: ProjectAccessTokenStore
    readonly notifications?: NotificationStore
    readonly analytics?: AnalyticsStore
    readonly providerAnalytics?: ProviderAnalyticsStore
    readonly blueskyAnalyticsFetcher?: BlueskyFetcher
    readonly blueskyAnalyticsTimeoutMs?: number
    readonly blueskyAnalyticsNow?: () => number
    readonly projectChanges?: ProjectRealtimeHub
}

function createDomainApp({
    auth,
    database,
    publisher,
    media,
    mediaPublicDelivery,
    manualStore: manualStoreOptions,
    logging,
    onWorkScheduled,
    runtime,
    accessTokens,
    notifications,
    analytics,
    providerAnalytics,
    blueskyAnalyticsFetcher,
    blueskyAnalyticsTimeoutMs,
    blueskyAnalyticsNow,
    projectChanges,
    discordFetcher,
    devtoFetcher,
}: HeraldAppOptions) {
    const manualStore = createManualStore(database, {
        ...manualStoreOptions,
        media,
        publicMediaUrlAvailable:
            media !== undefined &&
            (manualStoreOptions?.publicMediaUrlAvailable ?? mediaPublicDelivery !== undefined),
    })
    const publicMediaRoutes =
        media === undefined || mediaPublicDelivery === undefined
            ? new Elysia({ name: 'herald-public-media-disabled' })
            : createPublicMediaRoutes(media, mediaPublicDelivery)
    const logger = logging?.enabled === true ? createHeraldLogger(logging) : undefined
    const notificationStore = notifications ?? createNotificationStore(database)
    const analyticsStore = analytics ?? createAnalyticsStore(database)
    const providerAnalyticsStore = providerAnalytics ?? createProviderAnalyticsStore(database)
    const eventJournal = createEventJournalStore(database)

    return new Elysia({ name: 'herald-api' })
        .use(createBlueskyMetadataRoutes(publisher))
        .use(createRequestLogger(logging, logger))
        .use(
            openapi({
                documentation: {
                    info: {
                        title: 'Herald API',
                        version: '0.1.0',
                        description:
                            'The HTTP API for the lightweight, self-hosted Herald publication orchestrator.',
                    },
                    components: {
                        securitySchemes: {
                            bearerAuth: {
                                type: 'http',
                                scheme: 'bearer',
                                bearerFormat: 'Herald project access token',
                                description:
                                    'A project-scoped machine token sent as Authorization: Bearer <token>.',
                            },
                            sessionCookie: {
                                type: 'apiKey',
                                in: 'cookie',
                                name: 'better-auth.session_token',
                                description:
                                    'The Better Auth email/password session cookie used by the web application.',
                            },
                        },
                    },
                    security: [{ bearerAuth: [] }, { sessionCookie: [] }],
                    tags: [
                        { name: 'System', description: 'Service health and runtime information.' },
                        { name: 'Projects', description: 'Project lifecycle and access.' },
                        { name: 'Channels', description: 'Project publication destinations.' },
                        { name: 'Posts', description: 'Source posts and publication creation.' },
                        { name: 'Publications', description: 'Publication workflow operations.' },
                        { name: 'Media', description: 'Project media assets and uploads.' },
                        {
                            name: 'Settings',
                            description: 'Instance-level runtime configuration.',
                        },
                        { name: 'Audit', description: 'Project audit history.' },
                        {
                            name: 'Notifications',
                            description:
                                'Signed-in user notification inboxes with optional project context.',
                        },
                        {
                            name: 'Analytics',
                            description: 'Provider-neutral publication and execution analytics.',
                        },
                        {
                            name: 'Provider Analytics',
                            description: 'Persisted provider-owned metric observations.',
                        },
                    ],
                },
                path: '/openapi',
                specPath: '/openapi/json',
            })
        )
        .use(createErrorHandler())
        .use(createHealthRoutes({ database, runtime }))
        .use(
            createProjectModule({
                auth,
                manualStore,
                publisher,
                media,
                logger,
                onWorkScheduled,
                discordFetcher,
                devtoFetcher,
                accessTokens,
                notifications: notificationStore,
                analytics: analyticsStore,
                providerAnalytics: providerAnalyticsStore,
                blueskyAnalyticsFetcher,
                blueskyAnalyticsTimeoutMs,
                blueskyAnalyticsNow,
                eventJournal,
                projectChanges,
            })
        )
        .use(publicMediaRoutes)
}

/**
 * The Eden contract intentionally covers the typed Herald API routes only.
 * Better Auth's mounted handler is dynamically routed and would otherwise
 * make `/api` ambiguous in Eden's generated path tree.
 */
export type HeraldApp = ReturnType<typeof createDomainApp>

export function createApp({
    auth,
    database,
    publisher,
    media,
    mediaPublicDelivery,
    manualStore: manualStoreOptions,
    logging,
    onWorkScheduled,
    runtime,
    accessTokens,
    notifications,
    analytics,
    providerAnalytics,
    blueskyAnalyticsFetcher,
    blueskyAnalyticsTimeoutMs,
    blueskyAnalyticsNow,
    projectChanges,
    discordFetcher,
    devtoFetcher,
}: HeraldAppOptions) {
    return createDomainApp({
        auth,
        database,
        publisher,
        media,
        mediaPublicDelivery,
        manualStore: manualStoreOptions,
        logging,
        onWorkScheduled,
        runtime,
        accessTokens,
        notifications,
        analytics,
        providerAnalytics,
        blueskyAnalyticsFetcher,
        blueskyAnalyticsTimeoutMs,
        blueskyAnalyticsNow,
        projectChanges,
        discordFetcher,
        devtoFetcher,
    }).use(createAuthRoutes(auth))
}
