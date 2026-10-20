import { openapi } from '@elysiajs/openapi'
import type { PostbotAuth } from '@postbot/auth'
import type { BlueskyFetcher, BlueskyThreadReader } from '@postbot/bluesky'
import { ChannelProfileCompiler } from '@postbot/core'
import type { NotificationEmailStore } from '@postbot/db'
import {
    createManualStore,
    createAnalyticsStore,
    createEventJournalStore,
    createNotificationStore,
    createProviderAnalyticsStore,
    createPublicationCommentStore,
    createAccessStore,
    createTaxonomyStore,
    type PostbotDatabase,
    type ManualStoreOptions,
    type MediaAssetStore,
    type NotificationStore,
    type AnalyticsStore,
    type AccessStore,
    type ProviderAnalyticsStore,
    type TaxonomyStore,
    type UserAvatarStore,
} from '@postbot/db'
import type { DevtoFetcher } from '@postbot/devto'
import type { DiscordFetcher } from '@postbot/discord'
import { facebookChannelProfileValidationAdapter } from '@postbot/facebook'
import type { TelegramFetcher } from '@postbot/telegram'
import { telegramChannelProfileValidationAdapter } from '@postbot/telegram'
import { xChannelProfileValidationAdapter } from '@postbot/x'
import type { Registry } from '@prometheus-io/client'
import { Elysia, setupTypebox } from 'elysia'
import { Type } from 'typebox'
import * as typeboxCompile from 'typebox/compile'
import * as typeboxSchema from 'typebox/schema'
import * as typeboxSystem from 'typebox/system'
import * as typeboxType from 'typebox/type'
import * as typeboxValue from 'typebox/value'

import type { PostbotLoggingConfig } from './config'
import { createPublicInstanceRoutes } from './modules/access/public-routes'
import { createAccountRoutes } from './modules/account/routes'
import type { EmailSettingsService } from './modules/email/settings'
import { createHealthRoutes, type HealthRoutesOptions } from './modules/health/routes'
import type { MediaPublicDelivery } from './modules/media/public-delivery'
import { createPublicMediaRoutes } from './modules/media/public-routes'
import type { MediaUrlImporter } from './modules/media/url-import'
import { createMetricsRoutes } from './modules/metrics/routes'
import { createProjectModule } from './modules/projects'
import type { ProjectRealtimeHub, UserRealtimeHub } from './modules/projects/realtime-runtime'
import { createBlueskyMetadataRoutes } from './modules/publishers/metadata-routes'
import type { PublisherRuntime } from './modules/publishers/runtime'
import { createAuthRoutes } from './plugins/auth'
import { createErrorHandler } from './plugins/error-handler'
import { createPostbotLogger, createRequestLogger } from './plugins/logger'
import { recoveryBlocksRequest, type RecoveryService } from './recovery'

export interface PostbotAppOptions {
    readonly auth: PostbotAuth
    readonly database: PostbotDatabase
    readonly publisher: PublisherRuntime
    readonly avatars?: UserAvatarStore
    readonly accountOrigins?: readonly string[]
    readonly media?: MediaAssetStore
    readonly mediaUrlImporter?: MediaUrlImporter
    readonly mediaPublicDelivery?: MediaPublicDelivery
    readonly manualStore?: ManualStoreOptions
    readonly logging?: PostbotLoggingConfig
    readonly metrics?: {
        readonly registry: Registry
        readonly bearerToken: string
    }
    readonly onWorkScheduled?: () => void
    /** Test-only escape hatch for independent browser fixtures. */
    readonly allowAdditionalSignups?: boolean
    readonly discordFetcher?: DiscordFetcher
    readonly telegramFetcher?: TelegramFetcher
    readonly devtoFetcher?: DevtoFetcher
    readonly runtime?: HealthRoutesOptions['runtime']
    /** The shared Postbot instance access store. */
    readonly access?: AccessStore
    readonly recovery?: RecoveryService
    readonly emailSettings?: EmailSettingsService
    readonly emailAlerts?: {
        store: NotificationEmailStore
        available: boolean | (() => boolean)
    }
    readonly notifications?: NotificationStore
    readonly analytics?: AnalyticsStore
    readonly providerAnalytics?: ProviderAnalyticsStore
    readonly taxonomy?: TaxonomyStore
    readonly blueskyCommentsReader?: BlueskyThreadReader
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
    avatars,
    accountOrigins,
    mediaUrlImporter,
    mediaPublicDelivery,
    manualStore: manualStoreOptions,
    logging,
    metrics,
    onWorkScheduled,
    allowAdditionalSignups,
    runtime,
    access,
    notifications,
    emailAlerts,
    emailSettings,
    recovery,
    analytics,
    providerAnalytics,
    taxonomy,
    blueskyCommentsReader,
    blueskyAnalyticsFetcher,
    blueskyAnalyticsTimeoutMs,
    blueskyAnalyticsNow,
    projectChanges,
    userChanges,
    discordFetcher,
    telegramFetcher,
    devtoFetcher,
}: PostbotAppOptions) {
    // Elysia compiles its routes at runtime and loads the TypeBox namespaces
    // through a dynamic require it cannot bundle. The production image carries
    // the bundle only, so those namespaces are wired statically here: the
    // bundler includes them and the image needs no node_modules.
    setupTypebox({
        typebox: {
            type: typeboxType,
            system: typeboxSystem,
            value: typeboxValue,
            schema: typeboxSchema,
            compile: typeboxCompile,
        },
    })
    const accessStore = access ?? createAccessStore(database)
    const manualStore = createManualStore(database, {
        ...manualStoreOptions,
        profileCompiler:
            manualStoreOptions?.profileCompiler ??
            new ChannelProfileCompiler({
                validationAdapters: [
                    xChannelProfileValidationAdapter,
                    telegramChannelProfileValidationAdapter,
                    facebookChannelProfileValidationAdapter,
                ],
            }),
        media,
        publicMediaUrlAvailable:
            media !== undefined &&
            (manualStoreOptions?.publicMediaUrlAvailable ?? mediaPublicDelivery !== undefined),
    })
    const publicMediaRoutes =
        media === undefined || mediaPublicDelivery === undefined
            ? new Elysia({ name: 'postbot-public-media-disabled' })
            : createPublicMediaRoutes(media, mediaPublicDelivery)
    const logger = logging?.enabled === true ? createPostbotLogger(logging) : undefined
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

    return new Elysia({ name: 'postbot-api' })
        .request(({ request }) => {
            if (recovery?.held() && recoveryBlocksRequest(request))
                return Response.json(
                    {
                        error: {
                            code: 'recovery_hold',
                            message:
                                'Postbot is in recovery mode; an administrator must authorize resumption',
                        },
                    },
                    { status: 503 }
                )
        })
        .get(
            '/api/recovery/status',
            {
                response: { 200: Type.Object({ held: Type.Boolean() }) },
                detail: { operationId: 'getRecoveryStatus', tags: ['System'] },
            },
            () => ({ held: recovery?.held() ?? false })
        )
        .use(createBlueskyMetadataRoutes(publisher))
        .use(
            openapi({
                documentation: {
                    info: {
                        title: 'Postbot API',
                        version: '0.1.0',
                        description:
                            'The HTTP API for the lightweight, self-hosted Postbot publication orchestrator.',
                    },
                    components: {
                        securitySchemes: {
                            bearerAuth: {
                                type: 'http',
                                scheme: 'bearer',
                                bearerFormat: 'Postbot API key',
                                description:
                                    'A user-owned Postbot API key sent as `Authorization: Bearer <token>`. Its project scope is limited by the creator’s current access.',
                            },
                            sessionCookie: {
                                type: 'apiKey',
                                in: 'cookie',
                                name: 'better-auth.session_token',
                                description:
                                    'The Better Auth email/password session cookie used by the web application.',
                            },
                            ...(metrics === undefined
                                ? {}
                                : {
                                      metricsBearerAuth: {
                                          type: 'http',
                                          scheme: 'bearer',
                                          bearerFormat: 'monitoring token',
                                          description:
                                              'A dedicated monitoring token configured with POSTBOT_METRICS_TOKEN. It is separate from Postbot user API keys.',
                                      },
                                  }),
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
        .use(createErrorHandler(logger))
        .use(createRequestLogger(logging, logger))
        .use(createHealthRoutes({ database, runtime }))
        .use(createAccountRoutes(auth, avatars, accountOrigins))
        .use(createMetricsRoutes(metrics))
        .use(createPublicInstanceRoutes(accessStore, { allowAdditionalSignups }))
        .use(
            createProjectModule({
                auth,
                emailAlerts,
                emailSettings,
                recovery,
                manualStore,
                publisher,
                media,
                mediaUrlImporter,
                logger,
                onWorkScheduled,
                now: manualStoreOptions?.now,
                discordFetcher,
                telegramFetcher,
                devtoFetcher,
                access: accessStore,
                notifications: notificationStore,
                analytics: analyticsStore,
                publicationComments: createPublicationCommentStore(database),
                providerAnalytics: providerAnalyticsStore,
                taxonomy: taxonomyStore,
                blueskyCommentsReader,
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
 * The Eden contract intentionally covers the typed Postbot API routes only.
 * Better Auth's mounted handler is dynamically routed and would otherwise
 * make `/api` ambiguous in Eden's generated path tree.
 */
export type PostbotApp = ReturnType<typeof createDomainApp>

export function createApp({
    auth,
    database,
    publisher,
    media,
    avatars,
    accountOrigins,
    mediaUrlImporter,
    mediaPublicDelivery,
    manualStore: manualStoreOptions,
    logging,
    metrics,
    onWorkScheduled,
    allowAdditionalSignups,
    runtime,
    access,
    notifications,
    emailAlerts,
    emailSettings,
    recovery,
    analytics,
    providerAnalytics,
    taxonomy,
    blueskyCommentsReader,
    blueskyAnalyticsFetcher,
    blueskyAnalyticsTimeoutMs,
    blueskyAnalyticsNow,
    projectChanges,
    userChanges,
    discordFetcher,
    telegramFetcher,
    devtoFetcher,
}: PostbotAppOptions) {
    return createDomainApp({
        auth,
        database,
        publisher,
        media,
        avatars,
        accountOrigins,
        mediaUrlImporter,
        mediaPublicDelivery,
        manualStore: manualStoreOptions,
        logging,
        metrics,
        onWorkScheduled,
        allowAdditionalSignups,
        runtime,
        access,
        notifications,
        emailAlerts,
        emailSettings,
        recovery,
        analytics,
        providerAnalytics,
        taxonomy,
        blueskyCommentsReader,
        blueskyAnalyticsFetcher,
        blueskyAnalyticsTimeoutMs,
        blueskyAnalyticsNow,
        projectChanges,
        userChanges,
        discordFetcher,
        telegramFetcher,
        devtoFetcher,
    }).use(createAuthRoutes(auth))
}
