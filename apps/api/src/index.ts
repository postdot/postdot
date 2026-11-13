import { createAuth } from '@postdot/auth'
import {
    createCustomHttpTransport,
    createNetworkControlledBinaryFetcher,
    createNetworkControlledFetcher,
} from '@postdot/custom-http'
import { createResourceLifecycleStore } from '@postdot/db'
import {
    createNotificationEmailStore,
    createInstallationEmailSettingsStore,
    createSecretCipher,
} from '@postdot/db'
import {
    createLocalCoordination,
    createPostgresCoordination,
    type InstanceCoordination,
    acquirePostgresInstanceLock,
    closeDatabase,
    closePostgresDatabase,
    createDatabase,
    createPostgresDatabase,
    createAccessStore,
    createMediaAssetStore,
    createUserAvatarStore,
    createNotificationStore,
    acquireRuntimeQuiescenceLock,
    setDatabaseCommitObserver,
    runMigrations,
    type DatabaseHandle,
} from '@postdot/db'
import { createMastodonThreadReader, createMastodonAnalyticsReader } from '@postdot/mastodon'

import { createApp } from './app'
import {
    createPostdotConfig,
    createPostdotMaintenanceConfig,
    createPostdotTransferConfig,
    decodeHexKey,
    type PostdotConfig,
} from './config'
import { printMaintenanceHelp, runMaintenanceCommand } from './maintenance'
import { createPostdotAuthEmailDelivery } from './modules/email/delivery'
import { createEmailSettingsService } from './modules/email/settings'
import type { InstanceTopology } from './modules/health/routes'
import { createMediaPublicDelivery } from './modules/media/public-delivery'
import {
    createConfiguredMediaStore,
    createMediaReconciliationRuntime,
} from './modules/media/runtime'
import { createMediaUrlImporter } from './modules/media/url-import'
import { createPostdotMetrics } from './modules/metrics/metrics'
import { createNotificationEmailRuntime } from './modules/notifications/email-runtime'
import { createNotificationProjectionRuntime } from './modules/notifications/runtime'
import { createPublicationFirstCommentService } from './modules/projects/publication-first-comment-service'
import { createPublicationRepliesService } from './modules/projects/publication-replies-service'
import {
    createProjectRealtimeRuntime,
    type DraftChangeSignal,
} from './modules/projects/realtime-runtime'
import { createPublisherRuntime } from './modules/publishers/runtime'
import { createBuiltInProviderRegistry } from './modules/workflow/providers/registry'
import { createPublicationWorker } from './modules/workflow/worker'
import { createWebAssets } from './plugins/web-assets'
import { providerWorkerFactories } from './providers/registry'
import { createRecoveryService } from './recovery'
import { printReleaseVersion } from './release'
import { registerServingHandle } from './serving'
import {
    createShutdownDependencies,
    createShutdownHandler,
    type MutableShutdownDependencies,
} from './shutdown'
import { isTransferCommand, runTransferCommand } from './transfer'
import { createVideoPosterExtractor, createVideoPosterRuntime } from './video-posters'

export type { EmailSettingsResponse, EmailSettingsInput } from './modules/email/settings'
export { createApp } from './app'
export type { PostdotApp } from './app'
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

async function startServer(config = createPostdotConfig()) {
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

    // A lost topology lock (connection gone) drains and exits non-zero, so a
    // supervisor restarts this server as a follower instead of letting it run
    // beside the instance that took over.
    const lose = (what: string) => {
        console.error(`[postdot-topology] ${what} lost; stopping this server`)
        shutdownRequested = true
        void handleShutdown('SIGTERM', 1)
    }
    const media = config.media.driver
    if (config.database.engine === 'sqlite') {
        const lock = acquireRuntimeQuiescenceLock(config.database.fileName, 'server')
        runtimeLock = lock
        try {
            await startServerWithRuntimeLock(config, dependencies, () => shutdownRequested, {
                coordination: createLocalCoordination(),
                topology: { engine: 'sqlite', media, instances: 'single' },
                lose,
            })
        } catch (error) {
            lock.release()
            throw error
        }
        return
    }
    if (media === 'local') {
        // Local media keeps state on this server: one server per database.
        const lock = await acquirePostgresInstanceLock(config.database.url, {
            onLost: () => lose('The single-server lock'),
        })
        try {
            await startServerWithRuntimeLock(config, dependencies, () => shutdownRequested, {
                coordination: createLocalCoordination(),
                topology: { engine: 'postgres', media, instances: 'single' },
                lose,
                closeTopology: () => lock.close(),
            })
        } catch (error) {
            await lock.close()
            throw error
        }
        return
    }
    // PostgreSQL and S3: several servers; one elected leader runs the runtimes.
    const coordination = createPostgresCoordination(config.database.url)
    try {
        await startServerWithRuntimeLock(config, dependencies, () => shutdownRequested, {
            coordination,
            topology: { engine: 'postgres', media, instances: 'multiple' },
            lose,
            closeTopology: () => coordination.close(),
        })
    } catch (error) {
        await coordination.close()
        throw error
    }
}

interface ServerTopology {
    readonly coordination: InstanceCoordination
    readonly topology: Omit<InstanceTopology, 'role'>
    readonly lose: (what: string) => void
    /** Ends the topology lock or coordination after the database pool closes. */
    readonly closeTopology?: () => Promise<void>
}

async function openConfiguredDatabase(
    database: PostdotConfig['database'],
    closeTopology: (() => Promise<void>) | undefined
): Promise<{ readonly database: DatabaseHandle; readonly close: () => Promise<void> | void }> {
    if (database.engine === 'sqlite') {
        const opened = createDatabase(database.fileName)
        return { database: opened, close: () => closeDatabase(opened) }
    }
    const opened = createPostgresDatabase(database.url, { max: database.poolSize })
    return {
        database: opened,
        close: async () => {
            await closePostgresDatabase(opened)
            await closeTopology?.()
        },
    }
}

async function startServerWithRuntimeLock(
    config: ReturnType<typeof createPostdotConfig>,
    dependencies: MutableShutdownDependencies,
    shutdownRequested: () => boolean,
    server: ServerTopology
) {
    const { coordination } = server
    let resumeRuntimes: (() => Promise<void>) | undefined
    // Recovery holds are written by the SQLite restore command; PostgreSQL is
    // restored with its own tooling and never starts in a recovery hold.
    const recovery = createRecoveryService(
        config.database.engine === 'sqlite' ? config.database.fileName : null,
        () => {
            void resumeRuntimes?.().catch(error =>
                console.error('[postdot-recovery] runtime resume failed', error)
            )
        }
    )
    const opened = await openConfiguredDatabase(config.database, server.closeTopology)
    const database = opened.database
    dependencies.closeDatabase = opened.close
    const migrations = await runMigrations(database, config.database.migrationsDirectory)
    if (migrations.newer.length > 0) {
        // Expand/contract: an older server keeps running on an expanded schema.
        console.warn(
            `[postdot-migrations] the database has migrations from a newer release: ${migrations.newer.join(', ')}`
        )
    }
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
                domain: 'postdot.installation-email',
                keyId: config.security.publisherEncryptionKeyId,
                key: decodeHexKey(config.security.publisherEncryptionKey),
            })
        ),
        initial: config.email?.smtp,
        // Every instance rereads the settings; the leader replans delivery.
        onChange: () => coordination.publish({ kind: 'email-settings' }),
        deliveryAllowed: () => !recovery.held(),
    })
    emailRuntime = createNotificationEmailRuntime({
        store: emailStore,
        getSmtp: () => (recovery.held() ? undefined : emailSettings.current()),
        transport: emailSettings,
        webOrigin: config.web.origin,
    })
    const realtime = createProjectRealtimeRuntime({
        // Both projections are independent wakeups and never reject.
        onProjectsChanged: projectIds => {
            // Projection and email delivery are background runtimes: leader only.
            if (!coordination.isLeader()) return
            void notificationProjection.runProjects(projectIds)
            void emailRuntime?.runProjects(projectIds)
        },
        resolveUserIdsForProjects: projectIds => notifications.listUserIdsForProjects(projectIds),
        onError: error => console.error('[postdot-realtime] post-commit wakeup failed', error),
    })
    dependencies.stopRealtime = () => realtime.stop()
    const clearDatabaseCommitObserver = setDatabaseCommitObserver(
        database,
        // Every instance's streams reread the journal after this signal.
        projectIds => coordination.publish({ kind: 'projects', projectIds }),
        error => console.error('[postdot-realtime] post-commit observer failed', error)
    )
    dependencies.clearCommitObserver = () => clearDatabaseCommitObserver()
    const resourceLifecycle = createResourceLifecycleStore(database, {
        // Writes in flight on another server are not visible here: wait out an upload.
        cleanupGraceMs:
            server.topology.instances === 'multiple' ? config.media.uploadIntentTtlMs : 0,
    })
    const objectStorage = resourceLifecycle.wrapMedia(createConfiguredMediaStore(config.media))
    const avatars = createUserAvatarStore(database, objectStorage)
    const posterExtractor = createVideoPosterExtractor(objectStorage)
    let posterRuntime: ReturnType<typeof createVideoPosterRuntime> | undefined
    const media = createMediaAssetStore(database, objectStorage, {
        videoPoster: key => posterExtractor.extract(key),
        onVideoReady: (projectId, assetId) => {
            if (!posterExtractor.available) return
            if (coordination.isLeader()) posterRuntime?.enqueue(projectId, assetId)
            else coordination.publish({ kind: 'media' })
        },
        uploadIntentTtlMs: config.media.uploadIntentTtlMs,
        deletionGracePeriodMs: config.media.deletionGracePeriodMs,
    })
    posterRuntime = createVideoPosterRuntime({
        pending: async () =>
            await (posterExtractor.available ? await media.listPendingVideoPreviews() : []),
        generate: (projectId, assetId) => media.generateVideoPreviews(projectId, assetId),
        cancel: () => posterExtractor.cancel(),
    })
    const mediaPublicDelivery = createMediaPublicDelivery({
        baseURL: config.auth.baseURL,
        signingSecret: config.security.mediaPublicUrlSecret,
        lifetimeMs: config.media.publicUrlLifetimeMs,
    })
    // Startup maintenance belongs to the runtime leader (at once when single).
    const reconcileAtStart = async () => {
        if (recovery.held()) return
        await media.reconcile()
        await resourceLifecycle.reconcile(objectStorage)
    }
    if (coordination.mode === 'single') await reconcileAtStart()
    const mediaMaintenance = createMediaReconciliationRuntime({
        reconcile: async () => {
            const result = await media.reconcile()
            await avatars.reconcile()
            await resourceLifecycle.reconcile(objectStorage)
            return result
        },
    })
    dependencies.stopMediaMaintenance = async () => {
        await posterRuntime?.stop()
        await mediaMaintenance.stop()
    }
    const email = createPostdotAuthEmailDelivery({
        getSmtp: () => (recovery.held() ? undefined : emailSettings.current()),
        transport: emailSettings,
        webOrigin: config.web.origin,
        onDeliveryError: kind => {
            console.error(`[postdot-email] ${kind} delivery failed`)
        },
    })
    const allowAdditionalSignups =
        config.environment === 'test' && Bun.env.POSTDOT_E2E_ALLOW_ADDITIONAL_SIGNUPS === 'true'
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
        instagram: { ...config.publishers.instagram, fetcher: mastodonFetcher },
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
    const metrics = metricsConfiguration === undefined ? undefined : createPostdotMetrics()
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
        mcp: { enabled: config.mcp.enabled },
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
        onWorkScheduled: () => coordination.publish({ kind: 'work' }),
        access,
        allowAdditionalSignups,
        notifications,
        emailSettings,
        emailAlerts: { store: emailStore, available: () => emailSettings.current() !== undefined },
        projectChanges: {
            ...realtime.hub,
            // Draft viewers may be connected to another instance.
            publishDraftChange: change =>
                coordination.publish({
                    kind: 'draft',
                    change: change as unknown as Readonly<Record<string, unknown>>,
                }),
        },
        userChanges: realtime.userHub,
        runtime: {
            recovery,
            topology: () => ({
                ...server.topology,
                role: coordination.isLeader() ? ('leader' as const) : ('follower' as const),
            }),
            scheduler: worker.scheduler,
            mediaMaintenance,
            notifications: notificationProjection,
        },
    })
    const app =
        config.environment === 'production' && config.web.enabled
            ? baseApp.use(await createWebAssets(config.web.assetsDirectory))
            : baseApp
    dependencies.stopServer = () => app.stop()

    // Start runtimes together, then recheck shutdown after their async setup.
    resumeRuntimes = async () => {
        await Promise.all([
            worker.start(),
            mediaMaintenance.start(),
            posterRuntime?.start(),
            emailRuntime?.start(),
        ])
    }
    await coordination.subscribe({
        signal: signal => {
            const leader = coordination.isLeader()
            switch (signal.kind) {
                case 'projects':
                    void realtime.publish(signal.projectIds)
                    break
                case 'work':
                    if (leader) void worker.replan()
                    break
                case 'media':
                    if (leader) void posterRuntime?.rescan()
                    break
                case 'email-settings':
                    void emailSettings
                        .reload()
                        .then(() => (coordination.isLeader() ? emailRuntime?.replan() : undefined))
                        .catch(error =>
                            console.error('[postdot-email] settings reload failed', error)
                        )
                    break
                case 'draft':
                    realtime.hub.publishDraftChange?.(signal.change as unknown as DraftChangeSignal)
                    break
            }
        },
        // Reconnects and the periodic safety pass recover missed notifications.
        resync: async () => {
            if (shutdownRequested()) return
            realtime.wakeAll()
            const work: Promise<unknown>[] = [
                emailSettings.reload().then(() => {
                    if (coordination.isLeader() && !shutdownRequested())
                        return emailRuntime?.replan()
                }),
            ]
            if (coordination.isLeader()) {
                work.push(notificationProjection.runNow(), worker.replan())
                if (posterRuntime !== undefined) work.push(posterRuntime.rescan())
            }
            const results = await Promise.allSettled(work)
            const failures = results.flatMap(result =>
                result.status === 'rejected' ? [result.reason] : []
            )
            if (failures.length) throw new AggregateError(failures, 'Coordination recovery failed')
        },
    })
    console.info(
        `[postdot-topology] ${server.topology.engine} database, ${server.topology.media} media, ` +
            `${server.topology.instances === 'single' ? 'single instance' : 'several instances (leader-elected runtimes)'}`
    )
    if (coordination.mode === 'single') {
        // One server: it leads at once, and runtimes start before serving.
        coordination.lead({ acquired: () => {}, lost: () => server.lose('Runtime leadership') })
        // A termination received during startup must not start a runtime that is
        // already draining, and must not start serving. No signal can arrive
        // between this check and the listen call, because no await separates them.
        if (shutdownRequested()) return
        if (!recovery.held()) {
            await resumeRuntimes().catch(error =>
                console.error('[postdot-runtime] start failed', error)
            )
        }
        if (shutdownRequested()) return
        notificationProjection.start()
        if (recovery.held())
            console.warn('[postdot-recovery] inspection only; resume from installation settings')
    } else {
        // Several servers: every one serves; the elected leader runs the runtimes.
        coordination.lead({
            acquired: () => {
                console.info('[postdot-topology] this instance now leads the background runtimes')
                void (async () => {
                    if (shutdownRequested()) return
                    await reconcileAtStart()
                    await resumeRuntimes?.()
                    if (shutdownRequested()) return
                    notificationProjection.start()
                })().catch(error => console.error('[postdot-runtime] start failed', error))
            },
            lost: () => server.lose('Runtime leadership'),
        })
        if (shutdownRequested()) return
    }
    app.listen(config.server.port)
    registerServingHandle(app.server)
}

if (import.meta.main) {
    const args = Bun.argv.slice(2)
    if (printReleaseVersion(args) || printMaintenanceHelp(args)) {
        // Help must not load configuration, open storage or start the server.
    } else if (args[0] === 'account') {
        try {
            await runMaintenanceCommand(args)
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Account recovery failed'
            console.error(`[postdot-maintenance] ${message}`)
            process.exitCode = 1
        }
    } else if (isTransferCommand(args)) {
        try {
            await runTransferCommand(args, createPostdotTransferConfig())
        } catch (error) {
            const message = error instanceof Error ? error.message : 'The transfer failed'
            console.error(`[postdot-transfer] ${message}`)
            process.exitCode = 1
        }
    } else if (
        args[0] === 'backup' ||
        args[0] === 'restore' ||
        args[0] === 'recovery' ||
        args[0] === 'media-previews'
    ) {
        const config = createPostdotMaintenanceConfig()
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
