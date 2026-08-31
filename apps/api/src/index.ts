import { createAuth } from '@herald/auth'
import { createCustomHttpTransport } from '@herald/custom-http'
import { closeDatabase, createDatabase, createMediaAssetStore, runMigrations } from '@herald/db'

import { createApp } from './app'
import { createHeraldConfig, decodeHexKey } from './config'
import { runMaintenanceCommand } from './maintenance'
import {
    createConfiguredMediaStore,
    createMediaReconciliationRuntime,
} from './modules/media/runtime'
import { createPublisherRuntime } from './modules/publishers/runtime'
import { createPublicationWorker } from './modules/workflow/worker'
import { createWebAssets } from './plugins/web-assets'

export { createApp } from './app'
export type { HeraldApp } from './app'
export { createPublisherRuntime } from './modules/publishers/runtime'
export type { PublisherRuntimeOptions } from './modules/publishers/runtime'
export type {
    AuditEventResponse,
    ChannelResponse,
    ChannelProfileActivationResponse,
    ChannelProfileAssessmentResponse,
    ChannelProfileStateResponse,
    ChannelProfileVersionResponse,
    DuePublicationResponse,
    PostResponse,
    PublisherConnectionResponse,
    PublisherConnectionsResponse,
    ProjectResponse,
    PublicationResponse,
} from './modules/projects/models'

async function startServer(config = createHeraldConfig()) {
    const database = createDatabase(config.database.fileName)
    runMigrations(database, config.database.migrationsDirectory)
    const media = createMediaAssetStore(database, createConfiguredMediaStore(config.media), {
        uploadIntentTtlMs: config.media.uploadIntentTtlMs,
        deletionGracePeriodMs: config.media.deletionGracePeriodMs,
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
    })
    const customHttpTransport = createCustomHttpTransport({
        privateDestinations: config.customHttp.privateDestinations,
    })
    const worker = createPublicationWorker({
        database,
        publisherStore: publisher.publisherStore,
        publisherCredentialStore: publisher.credentialStore,
        media,
        customHttpTransport,
        linkedinOAuth: publisher.linkedin,
    })
    const baseApp = createApp({
        auth,
        database,
        publisher,
        media,
        logging: config.logging,
        onWorkScheduled: worker.replan,
    })
    const app =
        config.environment === 'production'
            ? baseApp.use(await createWebAssets(config.web.assetsDirectory))
            : baseApp

    app.listen(config.server.port)
    worker.start()
    mediaMaintenance.start()

    let shuttingDown = false
    const shutdown = async () => {
        if (shuttingDown) return
        shuttingDown = true

        worker.stop()
        mediaMaintenance.stop()
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
