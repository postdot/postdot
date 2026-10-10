import { createAuth } from '@herald/auth'
import {
    createCustomHttpTransport,
    createNetworkControlledBinaryFetcher,
    createNetworkControlledFetcher,
} from '@herald/custom-http'
import {
    createNotificationEmailStore,
    createInstallationEmailSettingsStore,
    createSecretCipher,
} from '@herald/db'
import {
    closeDatabase,
    createDatabase,
    createAccessStore,
    createMediaAssetStore,
    createUserAvatarStore,
    createNotificationStore,
    acquireRuntimeQuiescenceLock,
    setDatabaseCommitObserver,
    runMigrations,
} from '@herald/db'
import { DISCORD_IMAGE_EXECUTION_CONTRACT_REVISION } from '@herald/discord'
import {
    createMastodonPublisher,
    MASTODON_IMAGE_EXECUTION_CONTRACT_REVISION,
} from '@herald/mastodon'

import { createApp } from './app'
import { createHeraldConfig, createHeraldMaintenanceConfig, decodeHexKey } from './config'
import { runMaintenanceCommand } from './maintenance'
import { createHeraldAuthEmailDelivery } from './modules/email/delivery'
import { createEmailSettingsService } from './modules/email/settings'
import { createMediaPublicDelivery } from './modules/media/public-delivery'
import {
    createConfiguredMediaStore,
    createMediaReconciliationRuntime,
} from './modules/media/runtime'
import { createMediaUrlImporter } from './modules/media/url-import'
import { createHeraldMetrics } from './modules/metrics/metrics'
import { createNotificationEmailRuntime } from './modules/notifications/email-runtime'
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
import { createRecoveryService } from './recovery'
import { registerServingHandle } from './serving'
import { createShutdownHandler } from './shutdown'

export type { EmailSettingsResponse, EmailSettingsInput } from './modules/email/settings'
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
    ChannelListItemResponse,
    ChannelProfileActivationResponse,
    ChannelProfileAssessmentResponse,
    ChannelProfilePresetResponse,
    ChannelProfilePresetsResponse,
    ChannelProfileStateResponse,
    ChannelProfileVersionResponse,
    DuePublicationResponse,
    PublicationApprovalRequestResponse,
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
export type { DevtoAnalyticsCollectionResponse } from './modules/projects/devto-analytics-service'
export type { ProviderAnalyticsObservation } from '@herald/core'
export type { ProviderAnalyticsObservationPage } from '@herald/db'
export type {
    EmailAlertPreferenceResponse,
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
    let resumeRuntimes: (() => void) | undefined
    const recovery = createRecoveryService(config.database.fileName, () => resumeRuntimes?.())
    const database = createDatabase(config.database.fileName)
    runMigrations(database, config.database.migrationsDirectory)
    const access = createAccessStore(database)
    const notifications = createNotificationStore(database)
    const notificationProjection = createNotificationProjectionRuntime(notifications)
    const emailStore = createNotificationEmailStore(database)
    let emailRuntime: ReturnType<typeof createNotificationEmailRuntime> | undefined
    const emailSettings = await createEmailSettingsService({
        store: createInstallationEmailSettingsStore(
            database,
            createSecretCipher({
                domain: 'herald.installation-email',
                keyId: config.security.publisherEncryptionKeyId,
                key: decodeHexKey(config.security.publisherEncryptionKey),
            })
        ),
        initial: config.email?.smtp,
        onChange: () => emailRuntime?.replan(),
        deliveryAllowed: () => !recovery.held(),
    })
    emailRuntime = createNotificationEmailRuntime({
        store: emailStore,
        getSmtp: () => (recovery.held() ? undefined : emailSettings.current()),
        transport: emailSettings,
        webOrigin: config.web.origin,
    })
    const realtime = createProjectRealtimeRuntime({
        onProjectsChanged: projectIds => {
            notificationProjection.runProjects(projectIds)
            emailRuntime?.runProjects(projectIds)
        },
        resolveUserIdsForProjects: projectIds => notifications.listUserIdsForProjects(projectIds),
        onError: error => console.error('[herald-realtime] post-commit wakeup failed', error),
    })
    const clearDatabaseCommitObserver = setDatabaseCommitObserver(
        database,
        projectIds => realtime.publish(projectIds),
        error => console.error('[herald-realtime] post-commit observer failed', error)
    )
    const objectStorage = createConfiguredMediaStore(config.media)
    const avatars = createUserAvatarStore(database, objectStorage)
    const media = createMediaAssetStore(database, objectStorage, {
        uploadIntentTtlMs: config.media.uploadIntentTtlMs,
        deletionGracePeriodMs: config.media.deletionGracePeriodMs,
    })
    const mediaPublicDelivery = createMediaPublicDelivery({
        baseURL: config.auth.baseURL,
        signingSecret: config.security.mediaPublicUrlSecret,
        lifetimeMs: config.media.publicUrlLifetimeMs,
    })
    if (!recovery.held()) await media.reconcile()
    const mediaMaintenance = createMediaReconciliationRuntime({
        reconcile: async () => {
            const result = await media.reconcile()
            await avatars.reconcile()
            return result
        },
    })
    const email = createHeraldAuthEmailDelivery({
        getSmtp: () => (recovery.held() ? undefined : emailSettings.current()),
        transport: emailSettings,
        webOrigin: config.web.origin,
        onDeliveryError: kind => {
            console.error(`[herald-email] ${kind} delivery failed`)
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
            revision: 'post-v1',
            oauth: publisher.bluesky,
            resolveOAuth: publisher.resolveBlueskyOAuth,
        }),
        createBlueskyProviderAdapter({
            oauth: publisher.bluesky,
            resolveOAuth: publisher.resolveBlueskyOAuth,
        }),
        createDiscordProviderAdapter({ revision: DISCORD_IMAGE_EXECUTION_CONTRACT_REVISION }),
        createDiscordProviderAdapter(),
        createDevtoProviderAdapter(),
        createLinkedInProviderAdapter({
            revision: 'member-post-v2',
            oauth: publisher.linkedin,
            resolveOAuth: publisher.resolveLinkedInOAuth,
        }),
        createLinkedInProviderAdapter({
            revision: 'member-post-v3',
            oauth: publisher.linkedin,
            resolveOAuth: publisher.resolveLinkedInOAuth,
        }),
        createLinkedInProviderAdapter({
            oauth: publisher.linkedin,
            resolveOAuth: publisher.resolveLinkedInOAuth,
        }),
        createMastodonProviderAdapter({
            revision: MASTODON_IMAGE_EXECUTION_CONTRACT_REVISION,
            fetcher: mastodonFetcher,
            createPublisher: baseUrl =>
                createMastodonPublisher({ baseUrl, fetcher: mastodonFetcher }),
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
        recovery,
        auth,
        database,
        publisher,
        media,
        avatars,
        accountOrigins: [config.web.origin, config.auth.baseURL],
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
        emailSettings,
        emailAlerts: { store: emailStore, available: () => emailSettings.current() !== undefined },
        projectChanges: realtime.hub,
        userChanges: realtime.userHub,
        runtime: {
            recovery,
            scheduler: worker.scheduler,
            mediaMaintenance,
            notifications: notificationProjection,
        },
    })
    const app =
        config.environment === 'production'
            ? baseApp.use(await createWebAssets(config.web.assetsDirectory))
            : baseApp

    resumeRuntimes = () => {
        worker.start()
        mediaMaintenance.start()
        emailRuntime?.start()
    }
    if (!recovery.held()) resumeRuntimes()
    notificationProjection.start()
    if (recovery.held())
        console.warn('[herald-recovery] inspection only; resume from installation settings')
    app.listen(config.server.port)
    registerServingHandle(app.server)

    const handleShutdown = createShutdownHandler({
        stopWorker: async () => {
            await worker.stop()
            await emailRuntime?.stop()
        },
        stopMediaMaintenance: () => mediaMaintenance.stop(),
        stopNotificationProjection: () => notificationProjection.stop(),
        stopRealtime: () => realtime.stop(),
        clearCommitObserver: () => clearDatabaseCommitObserver(),
        stopServer: () => app.stop(),
        closeDatabase: () => closeDatabase(database),
        releaseRuntimeLock: () => runtimeLock.release(),
        exit: exitCode => process.exit(exitCode),
    })

    process.once('SIGINT', () => void handleShutdown('SIGINT'))
    process.once('SIGTERM', () => void handleShutdown('SIGTERM'))
    process.once('SIGHUP', () => void handleShutdown('SIGHUP'))
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
    } else if (args[0] === 'backup' || args[0] === 'restore' || args[0] === 'recovery') {
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
