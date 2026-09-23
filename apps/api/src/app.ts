import { openapi } from '@elysiajs/openapi'
import type { HeraldAuth } from '@herald/auth'
import type { BlueskyFetcher } from '@herald/bluesky'
import {
    createManualStore,
    createAnalyticsStore,
    createEventJournalStore,
    createNotificationStore,
    createProviderAnalyticsStore,
    createAccessStore,
    createTaxonomyStore,
    type HeraldDatabase,
    type ManualStoreOptions,
    type MediaAssetStore,
    type NotificationStore,
    type AnalyticsStore,
    type AccessStore,
    type ProviderAnalyticsStore,
    type TaxonomyStore,
} from '@herald/db'
import type { DevtoFetcher } from '@herald/devto'
import type { DiscordFetcher } from '@herald/discord'
import { Elysia } from 'elysia'

import type { HeraldLoggingConfig } from './config'
import { createPublicInstanceRoutes } from './modules/access/public-routes'
import { createHealthRoutes, type HealthRoutesOptions } from './modules/health/routes'
import type { MediaPublicDelivery } from './modules/media/public-delivery'
import { createPublicMediaRoutes } from './modules/media/public-routes'
import type { MediaUrlImporter } from './modules/media/url-import'
import { createProjectModule } from './modules/projects'
import type { ProjectRealtimeHub, UserRealtimeHub } from './modules/projects/realtime-runtime'
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
    readonly mediaUrlImporter?: MediaUrlImporter
    readonly mediaPublicDelivery?: MediaPublicDelivery
    readonly manualStore?: ManualStoreOptions
    readonly logging?: HeraldLoggingConfig
    readonly onWorkScheduled?: () => void
    /** Test-only escape hatch for independent browser fixtures. */
    readonly allowAdditionalSignups?: boolean
    readonly discordFetcher?: DiscordFetcher
    readonly devtoFetcher?: DevtoFetcher
    readonly runtime?: HealthRoutesOptions['runtime']
    /** The shared Herald instance access store. */
    readonly access?: AccessStore
    readonly notifications?: NotificationStore
    readonly analytics?: AnalyticsStore
    readonly providerAnalytics?: ProviderAnalyticsStore
    readonly taxonomy?: TaxonomyStore
    readonly blueskyAnalyticsFetcher?: BlueskyFetcher
    readonly blueskyAnalyticsTimeoutMs?: number
    readonly blueskyAnalyticsNow?: () => number
    readonly projectChanges?: ProjectRealtimeHub
    readonly userChanges?: UserRealtimeHub
}

function createDomainApp({
    auth,
    database,
    publisher,
    media,
    mediaUrlImporter,
    mediaPublicDelivery,
    manualStore: manualStoreOptions,
    logging,
    onWorkScheduled,
    allowAdditionalSignups,
    runtime,
    access,
    notifications,
    analytics,
    providerAnalytics,
    taxonomy,
    blueskyAnalyticsFetcher,
    blueskyAnalyticsTimeoutMs,
    blueskyAnalyticsNow,
    projectChanges,
    userChanges,
    discordFetcher,
    devtoFetcher,
}: HeraldAppOptions) {
    const accessStore = access ?? createAccessStore(database)
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
    const taxonomyStore =
        taxonomy ??
        createTaxonomyStore(database, {
            now: manualStoreOptions?.now,
            createId: manualStoreOptions?.createId,
        })
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
                                bearerFormat: 'Herald API key',
                                description:
                                    'A user-owned Herald API key sent as Authorization: Bearer <token>. Its project scope is limited by the creator’s current access.',
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
                        { name: 'Access', description: 'Instance membership and invitations.' },
                        { name: 'Projects', description: 'Project lifecycle and access.' },
                        { name: 'Channels', description: 'Project publication destinations.' },
                        { name: 'Posts', description: 'Source posts and publication creation.' },
                        { name: 'Publications', description: 'Publication workflow operations.' },
                        {
                            name: 'Taxonomy',
                            description: 'Project categories and publication tags.',
                        },
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
        .use(createPublicInstanceRoutes(accessStore, { allowAdditionalSignups }))
        .use(
            createProjectModule({
                auth,
                manualStore,
                publisher,
                media,
                mediaUrlImporter,
                logger,
                onWorkScheduled,
                now: manualStoreOptions?.now,
                discordFetcher,
                devtoFetcher,
                access: accessStore,
                notifications: notificationStore,
                analytics: analyticsStore,
                providerAnalytics: providerAnalyticsStore,
                taxonomy: taxonomyStore,
                blueskyAnalyticsFetcher,
                blueskyAnalyticsTimeoutMs,
                blueskyAnalyticsNow,
                eventJournal,
                projectChanges,
                userChanges,
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
    mediaUrlImporter,
    mediaPublicDelivery,
    manualStore: manualStoreOptions,
    logging,
    onWorkScheduled,
    allowAdditionalSignups,
    runtime,
    access,
    notifications,
    analytics,
    providerAnalytics,
    taxonomy,
    blueskyAnalyticsFetcher,
    blueskyAnalyticsTimeoutMs,
    blueskyAnalyticsNow,
    projectChanges,
    userChanges,
    discordFetcher,
    devtoFetcher,
}: HeraldAppOptions) {
    return createDomainApp({
        auth,
        database,
        publisher,
        media,
        mediaUrlImporter,
        mediaPublicDelivery,
        manualStore: manualStoreOptions,
        logging,
        onWorkScheduled,
        allowAdditionalSignups,
        runtime,
        access,
        notifications,
        analytics,
        providerAnalytics,
        taxonomy,
        blueskyAnalyticsFetcher,
        blueskyAnalyticsTimeoutMs,
        blueskyAnalyticsNow,
        projectChanges,
        userChanges,
        discordFetcher,
        devtoFetcher,
    }).use(createAuthRoutes(auth))
}
