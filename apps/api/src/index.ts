import { createAuth } from '@herald/auth'
import { createCustomHttpTransport } from '@herald/custom-http'
import {
    closeDatabase,
    createDatabase,
    createMediaAssetStore,
    createNotificationStore,
    createProjectAccessTokenStore,
    runMigrations,
} from '@herald/db'

import { createApp } from './app'
import { createHeraldConfig, decodeHexKey } from './config'
import { runMaintenanceCommand } from './maintenance'
import { createMediaPublicDelivery } from './modules/media/public-delivery'
import {
    createConfiguredMediaStore,
    createMediaReconciliationRuntime,
} from './modules/media/runtime'
import { createNotificationProjectionRuntime } from './modules/notifications/runtime'
import { createPublisherRuntime } from './modules/publishers/runtime'
import { createBlueskyProviderAdapter } from './modules/workflow/providers/bluesky'
import { createLinkedInProviderAdapter } from './modules/workflow/providers/linkedin'
import { createMastodonProviderAdapter } from './modules/workflow/providers/mastodon'
import { createBuiltInProviderRegistry } from './modules/workflow/providers/registry'
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
} from './modules/projects/models'
export type {
    NotificationInboxResponse,
    NotificationPreferenceResponse,
    NotificationResponse,
} from './modules/projects/notification-models'

async function startServer(config = createHeraldConfig()) {
    const database = createDatabase(config.database.fileName)
    runMigrations(database, config.database.migrationsDirectory)
    const accessTokens = createProjectAccessTokenStore(database)
    const notifications = createNotificationStore(database)
    const notificationProjection = createNotificationProjectionRuntime(notifications)
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
    })
    const publisher = createPublisherRuntime(database, {
        apiOrigin: config.auth.baseURL,
        webOrigin: config.web.origin,
        publisherEncryptionKey: decodeHexKey(config.security.publisherEncryptionKey),
        publisherEncryptionKeyId: config.security.publisherEncryptionKeyId,
        linkedin: config.publishers.linkedin,
        bluesky: config.publishers.bluesky,
    })
    const customHttpTransport = createCustomHttpTransport({
        privateDestinations: config.customHttp.privateDestinations,
    })
    const builtInProviderRegistry = createBuiltInProviderRegistry([
        createBlueskyProviderAdapter({ oauth: publisher.bluesky }),
        createLinkedInProviderAdapter({ oauth: publisher.linkedin }),
        createMastodonProviderAdapter(),
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
    })
    const baseApp = createApp({
        auth,
        database,
        publisher,
        media,
        mediaPublicDelivery,
        logging: config.logging,
        onWorkScheduled: worker.replan,
        accessTokens,
        notifications,
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
