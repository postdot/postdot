import { createAuth } from '@postdot/auth'
import {
    createCustomHttpTransport,
    createNetworkControlledBinaryFetcher,
    createNetworkControlledFetcher,
} from '@postdot/custom-http'
import {
    createNotificationEmailStore,
    createInstallationEmailSettingsStore,
    createSecretCipher,
} from '@postdot/db'
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
} from '@postdot/db'
import { createMastodonThreadReader, createMastodonAnalyticsReader } from '@postdot/mastodon'

import { createApp } from './app'
import { createPostbotConfig, createPostbotMaintenanceConfig, decodeHexKey } from './config'
import { printMaintenanceHelp, runMaintenanceCommand } from './maintenance'
import { createPostbotAuthEmailDelivery } from './modules/email/delivery'
import { createEmailSettingsService } from './modules/email/settings'
import { createMediaPublicDelivery } from './modules/media/public-delivery'
import {
    createConfiguredMediaStore,
    createMediaReconciliationRuntime,
} from './modules/media/runtime'
import { createMediaUrlImporter } from './modules/media/url-import'
import { createPostbotMetrics } from './modules/metrics/metrics'
import { createNotificationEmailRuntime } from './modules/notifications/email-runtime'
import { createNotificationProjectionRuntime } from './modules/notifications/runtime'
import { createPublicationFirstCommentService } from './modules/projects/publication-first-comment-service'
import { createPublicationRepliesService } from './modules/projects/publication-replies-service'
import { createProjectRealtimeRuntime } from './modules/projects/realtime-runtime'
import { createPublisherRuntime } from './modules/publishers/runtime'
import { createBuiltInProviderRegistry } from './modules/workflow/providers/registry'
import { createPublicationWorker } from './modules/workflow/worker'
import { createWebAssets } from './plugins/web-assets'
import { providerWorkerFactories } from './providers/registry'
import { createRecoveryService } from './recovery'
import { registerServingHandle } from './serving'
import {
    createShutdownDependencies,
    createShutdownHandler,
    type MutableShutdownDependencies,
} from './shutdown'
import { createVideoPosterExtractor, createVideoPosterRuntime } from './video-posters'

export type { EmailSettingsResponse, EmailSettingsInput } from './modules/email/settings'
export { createApp } from './app'
export type { PostbotApp } from './app'
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
export type { BlueskyAnalyticsCollectionResponse } from './providers/bluesky/analytics'
export type { DevtoAnalyticsCollectionResponse } from './providers/devto/analytics'
export type { ProviderAnalyticsObservation } from '@postdot/core'
export type { ProviderAnalyticsObservationPage } from '@postdot/db'
export type {
    EmailAlertPreferenceResponse,
    NotificationInboxResponse,
    NotificationPreferenceResponse,
    NotificationResponse,
} from './modules/projects/notification-models'

async function startServer(config = createPostbotConfig()) {
    // The process signals are handled before the runtime marker exists, so a
    // termination during startup runs the same drain as a running server
    // instead of the platform default disposition. The default disposition
    // would leave the marker behind and block the next start until an
    // operator removes it.
    let runtimeLock: ReturnType<typeof acquireRuntimeQuiescenceLock> | undefined
    let shutdownRequested = false
    const dependencies = createShutdownDependencies(
        () => (runtimeLock === undefined ? true : runtimeLock.release()),
        exitCode => process.exit(exitCode)
    )
    const handleShutdown = createShutdownHandler(dependencies)
    const requestShutdown = (signal: NodeJS.Signals) => {
        shutdownRequested = true
        void handleShutdown(signal)
    }
    process.once('SIGINT', () => requestShutdown('SIGINT'))
    process.once('SIGTERM', () => requestShutdown('SIGTERM'))
    process.once('SIGHUP', () => requestShutdown('SIGHUP'))

    const lock = acquireRuntimeQuiescenceLock(config.database.fileName, 'server')
    runtimeLock = lock
    try {
        await startServerWithRuntimeLock(config, dependencies, () => shutdownRequested)
    } catch (error) {
        lock.release()
        throw error
    }
}

async function startServerWithRuntimeLock(
    config: ReturnType<typeof createPostbotConfig>,
    dependencies: MutableShutdownDependencies,
    shutdownRequested: () => boolean
) {
    let resumeRuntimes: (() => void) | undefined
    const recovery = createRecoveryService(config.database.fileName, () => resumeRuntimes?.())
    const database = createDatabase(config.database.fileName)
    dependencies.closeDatabase = () => closeDatabase(database)
    runMigrations(database, config.database.migrationsDirectory)
    const access = createAccessStore(database)
    const notifications = createNotificationStore(database)
    const notificationProjection = createNotificationProjectionRuntime(notifications)
    dependencies.stopNotificationProjection = () => notificationProjection.stop()
    const emailStore = createNotificationEmailStore(database)
    let emailRuntime: ReturnType<typeof createNotificationEmailRuntime> | undefined
    const emailSettings = await createEmailSettingsService({
        store: createInstallationEmailSettingsStore(
            database,
            createSecretCipher({
                domain: 'postbot.installation-email',
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
        onError: error => console.error('[postbot-realtime] post-commit wakeup failed', error),
    })
    dependencies.stopRealtime = () => realtime.stop()
    const clearDatabaseCommitObserver = setDatabaseCommitObserver(
        database,
        projectIds => realtime.publish(projectIds),
        error => console.error('[postbot-realtime] post-commit observer failed', error)
    )
    dependencies.clearCommitObserver = () => clearDatabaseCommitObserver()
    const objectStorage = createConfiguredMediaStore(config.media)
    const avatars = createUserAvatarStore(database, objectStorage)
    const posterExtractor = createVideoPosterExtractor(objectStorage)
    let posterRuntime: ReturnType<typeof createVideoPosterRuntime> | undefined
    const media = createMediaAssetStore(database, objectStorage, {
        videoPoster: key => posterExtractor.extract(key),
        onVideoReady: (projectId, assetId) => {
            if (posterExtractor.available) posterRuntime?.enqueue(projectId, assetId)
        },
        uploadIntentTtlMs: config.media.uploadIntentTtlMs,
        deletionGracePeriodMs: config.media.deletionGracePeriodMs,
    })
    posterRuntime = createVideoPosterRuntime({
        pending: () => (posterExtractor.available ? media.listPendingVideoPreviews() : []),
        generate: (projectId, assetId) => media.generateVideoPreviews(projectId, assetId),
        cancel: () => posterExtractor.cancel(),
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
    dependencies.stopMediaMaintenance = async () => {
        await posterRuntime?.stop()
        await mediaMaintenance.stop()
    }
    const email = createPostbotAuthEmailDelivery({
        getSmtp: () => (recovery.held() ? undefined : emailSettings.current()),
        transport: emailSettings,
        webOrigin: config.web.origin,
        onDeliveryError: kind => {
            console.error(`[postbot-email] ${kind} delivery failed`)
        },
    })
    const allowAdditionalSignups =
        config.environment === 'test' && Bun.env.POSTBOT_E2E_ALLOW_ADDITIONAL_SIGNUPS === 'true'
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
        instagram: { fetcher: mastodonFetcher },
        x: config.publishers.x,
    })
    const customHttpTransport = createCustomHttpTransport({
        privateDestinations: config.network.privateDestinations,
    })
    const builtInProviderRegistry = createBuiltInProviderRegistry(
        providerWorkerFactories.flatMap(createAdapters =>
            createAdapters({ publisher, fetcher: mastodonFetcher })
        )
    )
    const metricsConfiguration = config.metrics
    const metrics = metricsConfiguration === undefined ? undefined : createPostbotMetrics()
    const publicationReplies = createPublicationRepliesService({ database, publisher })
    const publicationFirstComments = createPublicationFirstCommentService({ database, publisher })
    const worker = createPublicationWorker({
        replies: publicationReplies,
        firstComments: publicationFirstComments,
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
    dependencies.stopWorker = async () => {
        await worker.stop()
        await emailRuntime?.stop()
    }
    const baseApp = createApp({
        publicationReplies,
        publicationFirstComments,
        mastodonCommentsReader: createMastodonThreadReader({ fetcher: mastodonFetcher }),
        mastodonAnalyticsReader: createMastodonAnalyticsReader({ fetcher: mastodonFetcher }),
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
    dependencies.stopServer = () => app.stop()

    resumeRuntimes = () => {
        worker.start()
        mediaMaintenance.start()
        posterRuntime?.start()
        emailRuntime?.start()
    }
    // A termination received during startup must not start a runtime that is
    // already draining, and must not start serving. No signal can arrive
    // between this check and the listen call, because no await separates them.
    if (shutdownRequested()) return
    if (!recovery.held()) resumeRuntimes()
    notificationProjection.start()
    if (recovery.held())
        console.warn('[postbot-recovery] inspection only; resume from installation settings')
    app.listen(config.server.port)
    registerServingHandle(app.server)
}

if (import.meta.main) {
    const args = Bun.argv.slice(2)
    if (printMaintenanceHelp(args)) {
        // Help must not load configuration, open storage or start the server.
    } else if (args[0] === 'account') {
        try {
            await runMaintenanceCommand(args)
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Account recovery failed'
            console.error(`[postbot-maintenance] ${message}`)
            process.exitCode = 1
        }
    } else if (
        args[0] === 'backup' ||
        args[0] === 'restore' ||
        args[0] === 'recovery' ||
        args[0] === 'media-previews'
    ) {
        const config = createPostbotMaintenanceConfig()
        await runMaintenanceCommand(args, {
            databaseFileName: config.databaseFileName,
            ...(args.includes('--media') || args[0] === 'media-previews'
                ? { mediaStore: createConfiguredMediaStore(config.media) }
                : {}),
        })
    } else {
        await startServer()
    }
}

export type { SearchResponse } from './modules/projects/search-routes'

export type { PublicationCommentsResponse } from './modules/projects/publication-comments-models'

export type { PublicationRepliesResponse } from './modules/projects/publication-replies-routes'

export type { MastodonAnalyticsCollectionResponse } from './providers/mastodon/analytics'

export type {
    PublicationFirstCommentResponse,
    PublicationFirstCommentItem,
} from './modules/projects/publication-first-comment-models'
