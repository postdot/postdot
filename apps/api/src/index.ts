import { createAuth } from '@herald/auth'
import {
    createCustomHttpTransport,
    createNetworkControlledBinaryFetcher,
    createNetworkControlledFetcher,
} from '@herald/custom-http'
import {
    closeDatabase,
    createDatabase,
    createAccessStore,
    createMediaAssetStore,
    createNotificationStore,
    acquireRuntimeQuiescenceLock,
    setDatabaseCommitObserver,
    runMigrations,
} from '@herald/db'
import { createMastodonPublisher } from '@herald/mastodon'

import { createApp } from './app'
import { createHeraldConfig, createHeraldMaintenanceConfig, decodeHexKey } from './config'
import { runMaintenanceCommand } from './maintenance'
import { createHeraldAuthEmailDelivery } from './modules/email/delivery'
import { createMediaPublicDelivery } from './modules/media/public-delivery'
import {
    createConfiguredMediaStore,
    createMediaReconciliationRuntime,
} from './modules/media/runtime'
import { createMediaUrlImporter } from './modules/media/url-import'
import { createHeraldMetrics } from './modules/metrics/metrics'
import { createNotificationProjectionRuntime } from './modules/notifications/runtime'
import { createProjectRealtimeRuntime } from './modules/projects/realtime-runtime'
import { createPublisherRuntime } from './modules/publishers/runtime'
import { createBlueskyProviderAdapter } from './modules/workflow/providers/bluesky'
import { createDevtoProviderAdapter } from './modules/workflow/providers/devto'
import { createDiscordProviderAdapter } from './modules/workflow/providers/discord'
import { createLinkedInProviderAdapter } from './modules/workflow/providers/linkedin'
import { createMastodonProviderAdapter } from './modules/workflow/providers/mastodon'
import { createBuiltInProviderRegistry } from './modules/workflow/providers/registry'
import { createXProviderAdapter } from './modules/workflow/providers/x'
import { createPublicationWorker } from './modules/workflow/worker'
import { createWebAssets } from './plugins/web-assets'

export { createApp } from './app'
export type { HeraldApp } from './app'
export { createPublisherRuntime } from './modules/publishers/runtime'
export type { PublisherRuntimeOptions } from './modules/publishers/runtime'
export type {
    MediaAssetResponse,
    MediaAssetUsageResponse,
    MediaImportSourceResponse,
    MediaImportSourcesResponse,
    MediaDeletionResponse,
    MediaDeletionBatchResponse,
    MediaFinalizeResponse,
    MediaIntentResponse,
    MediaPendingResponse,
    MediaReferenceResponse,
    MediaRepresentationResponse,
    MediaReservationResponse,
    MediaUploadPolicyResponse,
    MediaUploadResponse,
    MediaUrlImportResponse,
} from './modules/media/routes'
export type {
    AuditEventResponse,
    ChannelResponse,
    ChannelProfileActivationResponse,
    ChannelProfileAssessmentResponse,
    ChannelProfilePresetResponse,
    ChannelProfilePresetsResponse,
    ChannelProfileStateResponse,
    ChannelProfileVersionResponse,
    DuePublicationResponse,
    PostResponse,
    PublicationEditorStateResponse,
    PublisherConnectionResponse,
    PublisherConnectionsResponse,
    ProjectResponse,
    PublicationResponse,
    PublicationSummaryResponse,
    PublicationSummaryPageResponse,
    PublicationListQuery,
    ProjectCategoryResponse,
    ProjectTagResponse,
} from './modules/projects/models'
export type { BlueskyAnalyticsCollectionResponse } from './modules/projects/bluesky-analytics-service'
export type { ProviderAnalyticsObservationPage } from '@herald/db'
export type {
    NotificationInboxResponse,
    NotificationPreferenceResponse,
    NotificationResponse,
} from './modules/projects/notification-models'

async function startServer(config = createHeraldConfig()) {
    const runtimeLock = acquireRuntimeQuiescenceLock(config.database.fileName, 'server')
    try {
        await startServerWithRuntimeLock(config, runtimeLock)
    } catch (error) {
        runtimeLock.release()
        throw error
    }
}

async function startServerWithRuntimeLock(
    config: ReturnType<typeof createHeraldConfig>,
    runtimeLock: ReturnType<typeof acquireRuntimeQuiescenceLock>
) {
    const database = createDatabase(config.database.fileName)
    runMigrations(database, config.database.migrationsDirectory)
    const access = createAccessStore(database)
    const notifications = createNotificationStore(database)
    const notificationProjection = createNotificationProjectionRuntime(notifications)
    const realtime = createProjectRealtimeRuntime({
        onProjectsChanged: projectIds => notificationProjection.runProjects(projectIds),
        resolveUserIdsForProjects: projectIds => notifications.listUserIdsForProjects(projectIds),
        onError: error => console.error('[herald-realtime] post-commit wakeup failed', error),
    })
    const clearDatabaseCommitObserver = setDatabaseCommitObserver(
        database,
        projectIds => realtime.publish(projectIds),
        error => console.error('[herald-realtime] post-commit observer failed', error)
    )
    const media = createMediaAssetStore(database, createConfiguredMediaStore(config.media), {
        uploadIntentTtlMs: config.media.uploadIntentTtlMs,
        deletionGracePeriodMs: config.media.deletionGracePeriodMs,
    })
    const mediaPublicDelivery = createMediaPublicDelivery({
        baseURL: config.auth.baseURL,
        signingSecret: config.security.mediaPublicUrlSecret,
        lifetimeMs: config.media.publicUrlLifetimeMs,
    })
    await media.reconcile()
    const mediaMaintenance = createMediaReconciliationRuntime(media)
    const email = createHeraldAuthEmailDelivery({
        smtp: config.email?.smtp,
        webOrigin: config.web.origin,
        onDeliveryError: (kind, error) => {
            const message = error instanceof Error ? error.message : 'unknown transport error'
            console.error(`[herald-email] ${kind} delivery failed: ${message}`)
        },
    })
    const allowAdditionalSignups =
        config.environment === 'test' && Bun.env.HERALD_E2E_ALLOW_ADDITIONAL_SIGNUPS === 'true'
    const auth = createAuth(database, {
        baseURL: config.auth.baseURL,
        secret: config.auth.secret,
        trustedOrigins: [config.web.origin],
        requireEmailVerificationOnInvitation: config.auth.requireEmailVerificationOnInvitation,
        ...email,
        access,
        allowAdditionalSignups,
    })
    const mastodonFetcher = createNetworkControlledFetcher({
        privateDestinations: config.network.privateDestinations,
    })
    const mediaUrlFetcher = createNetworkControlledBinaryFetcher({
        privateDestinations: config.network.privateDestinations,
        maxResponseBytes: config.media.maxObjectBytes + 1,
    })
    const mediaUrlImporter = createMediaUrlImporter({
        media,
        fetcher: mediaUrlFetcher,
    })
    const publisher = createPublisherRuntime(database, {
        apiOrigin: config.auth.baseURL,
        webOrigin: config.web.origin,
        publisherEncryptionKey: decodeHexKey(config.security.publisherEncryptionKey),
        publisherEncryptionKeyId: config.security.publisherEncryptionKeyId,
        linkedin: config.publishers.linkedin,
        bluesky: config.publishers.bluesky,
        mastodon: { fetcher: mastodonFetcher },
        x: config.publishers.x,
    })
    const customHttpTransport = createCustomHttpTransport({
        privateDestinations: config.network.privateDestinations,
    })
    const builtInProviderRegistry = createBuiltInProviderRegistry([
        createBlueskyProviderAdapter({
            oauth: publisher.bluesky,
            resolveOAuth: publisher.resolveBlueskyOAuth,
        }),
        createDiscordProviderAdapter(),
        createDevtoProviderAdapter(),
        createLinkedInProviderAdapter({
            oauth: publisher.linkedin,
            resolveOAuth: publisher.resolveLinkedInOAuth,
        }),
        createMastodonProviderAdapter({
            fetcher: mastodonFetcher,
            createPublisher: baseUrl =>
                createMastodonPublisher({ baseUrl, fetcher: mastodonFetcher }),
        }),
        createXProviderAdapter({
            oauth: publisher.x,
            resolveOAuth: publisher.resolveXOAuth,
        }),
    ])
    const metricsConfiguration = config.metrics
    const metrics = metricsConfiguration === undefined ? undefined : createHeraldMetrics()
    const worker = createPublicationWorker({
        database,
        publisherStore: publisher.publisherStore,
        publisherCredentialStore: publisher.credentialStore,
        builtInProviderRegistry,
        media,
        customHttpTransport,
        resolveCustomHttpMediaUrl: (mediaReference, context) =>
            mediaPublicDelivery.createUrl({
                projectId: context.projectId,
                assetId: mediaReference.assetId,
                representationId: mediaReference.representationId,
            }),
        resolveBuiltInMediaUrl: (mediaReference, context) =>
            mediaPublicDelivery.createUrl({
                projectId: context.projectId,
                assetId: mediaReference.assetId,
                representationId: mediaReference.representationId,
            }),
        onRunCompleted: metrics?.observeWorkerRun,
    })
    metrics?.bindScheduler(worker.scheduler)
    const baseApp = createApp({
        auth,
        database,
        publisher,
        media,
        mediaUrlImporter,
        mediaPublicDelivery,
        logging: config.logging,
        ...(metrics === undefined || metricsConfiguration === undefined
            ? {}
            : {
                  metrics: {
                      registry: metrics.registry,
                      bearerToken: metricsConfiguration.bearerToken,
                  },
              }),
        onWorkScheduled: worker.replan,
        access,
        allowAdditionalSignups,
        notifications,
        projectChanges: realtime.hub,
        userChanges: realtime.userHub,
        runtime: {
            scheduler: worker.scheduler,
            mediaMaintenance,
            notifications: notificationProjection,
        },
    })
    const app =
        config.environment === 'production'
            ? baseApp.use(await createWebAssets(config.web.assetsDirectory))
            : baseApp

    worker.start()
    mediaMaintenance.start()
    notificationProjection.start()
    app.listen(config.server.port)

    let shuttingDown = false
    const shutdown = async () => {
        if (shuttingDown) return
        shuttingDown = true

        try {
            await worker.stop()
            await mediaMaintenance.stop()
            notificationProjection.stop()
            realtime.stop()
            clearDatabaseCommitObserver()
            await app.stop()
        } finally {
            try {
                closeDatabase(database)
            } finally {
                runtimeLock.release()
            }
        }
    }

    process.once('SIGINT', () => void shutdown())
    process.once('SIGTERM', () => void shutdown())
}

if (import.meta.main) {
    const args = Bun.argv.slice(2)
    if (args[0] === 'account') {
        try {
            await runMaintenanceCommand(args)
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Account recovery failed'
            console.error(`[herald-maintenance] ${message}`)
            process.exitCode = 1
        }
    } else if (args[0] === 'backup' || args[0] === 'restore') {
        const config = createHeraldMaintenanceConfig()
        await runMaintenanceCommand(args, {
            databaseFileName: config.databaseFileName,
            ...(args.includes('--media')
                ? { mediaStore: createConfiguredMediaStore(config.media) }
                : {}),
        })
    } else {
        await startServer()
    }
}
