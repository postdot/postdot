import { createAuth } from '@herald/auth'
import { closeDatabase, createDatabase, runMigrations } from '@herald/db'

import { createApp } from './app'
import { createHeraldConfig } from './config'
import { runMaintenanceCommand } from './maintenance'
import { createPublicationWorker } from './modules/workflow/worker'
import { createWebAssets } from './plugins/web-assets'

export { createApp } from './app'
export type { HeraldApp } from './app'
export type {
    AuditEventResponse,
    ChannelResponse,
    DuePublicationResponse,
    PostResponse,
    PublisherConnectionResponse,
    PublisherConnectionsResponse,
    ProjectResponse,
    PublicationResponse,
} from './modules/projects/models'

async function startServer() {
    const config = createHeraldConfig()
    const database = createDatabase(config.database.fileName)
    runMigrations(database, config.database.migrationsDirectory)
    const auth = createAuth(database, {
        baseURL: config.auth.baseURL,
        secret: config.auth.secret,
        trustedOrigins: [config.web.origin],
        linkedin: config.auth.linkedin,
    })
    const worker = createPublicationWorker({ auth, database })
    const baseApp = createApp({
        auth,
        database,
        webOrigin: config.web.origin,
        logging: config.logging,
        onWorkScheduled: worker.replan,
    })
    const app =
        config.environment === 'production'
            ? baseApp.use(await createWebAssets(config.web.assetsDirectory))
            : baseApp

    app.listen(config.server.port)
    worker.start()

    let shuttingDown = false
    const shutdown = async () => {
        if (shuttingDown) return
        shuttingDown = true

        worker.stop()
        await app.stop()
        closeDatabase(database)
    }

    process.once('SIGINT', () => void shutdown())
    process.once('SIGTERM', () => void shutdown())
}

if (import.meta.main) {
    if (!(await runMaintenanceCommand(Bun.argv.slice(2)))) await startServer()
}
