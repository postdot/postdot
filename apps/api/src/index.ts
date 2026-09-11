import { createAuth } from '@herald/auth'
import { createCustomHttpTransport, createNetworkControlledFetcher } from '@herald/custom-http'
import {
    closeDatabase,
    createDatabase,
    createAccessStore,
    createMediaAssetStore,
    createNotificationStore,
    setDatabaseCommitObserver,
    runMigrations,
} from '@herald/db'
import { createMastodonPublisher } from '@herald/mastodon'

import { createApp } from './app'
import { createHeraldConfig, decodeHexKey } from './config'
import { runMaintenanceCommand } from './maintenance'
import { createMediaPublicDelivery } from './modules/media/public-delivery'
import {
    createConfiguredMediaStore,
    createMediaReconciliationRuntime,
} from './modules/media/runtime'
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
    MediaDeletionResponse,
    MediaFinalizeResponse,
    MediaIntentResponse,
    MediaPendingResponse,
    MediaReferenceResponse,
    MediaRepresentationResponse,
    MediaReservationResponse,
    MediaUploadResponse,
} from './modules/media/routes'
export type {
    AuditEventResponse,
    CreatedProjectAccessTokenResponse,
    ChannelResponse,
    ChannelProfileActivationResponse,
    ChannelProfileAssessmentResponse,
    ChannelProfileStateResponse,
    ChannelProfileVersionResponse,
    DuePublicationResponse,
    PostResponse,
    PublicationEditorStateResponse,
    PublisherConnectionResponse,
    PublisherConnectionsResponse,
    ProjectAccessTokenResponse,
    ProjectAccessTokensResponse,
    ProjectResponse,
    PublicationResponse,
    PublicationSummaryResponse,
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
    const auth = createAuth(database, {
        baseURL: config.auth.baseURL,
        secret: config.auth.secret,
        trustedOrigins: [config.web.origin],
        access,
        allowAdditionalSignups:
            Bun.env.NODE_ENV === 'test' && Bun.env.HERALD_E2E_ALLOW_ADDITIONAL_SIGNUPS === 'true',
    })
    const mastodonFetcher = createNetworkControlledFetcher({
        privateDestinations: config.network.privateDestinations,
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
    })
    const baseApp = createApp({
        auth,
        database,
        publisher,
        media,
        mediaPublicDelivery,
        logging: config.logging,
        onWorkScheduled: worker.replan,
        access,
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

        worker.stop()
        mediaMaintenance.stop()
        notificationProjection.stop()
        realtime.stop()
        clearDatabaseCommitObserver()
        await app.stop()
        closeDatabase(database)
    }

    process.once('SIGINT', () => void shutdown())
    process.once('SIGTERM', () => void shutdown())
}

if (import.meta.main) {
    const args = Bun.argv.slice(2)
    if (args.includes('--media')) {
        const config = createHeraldConfig()
        const handled = await runMaintenanceCommand(args, {
            mediaStore: createConfiguredMediaStore(config.media),
        })
        if (!handled) await startServer(config)
    } else if (!(await runMaintenanceCommand(args))) {
        await startServer()
    }
}
