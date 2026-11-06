import { join } from 'node:path'

import { createApp, createPublisherRuntime } from '../apps/api/src/index'
import { createAuth } from '../packages/auth/src/index'
import {
    closeDatabase,
    createDatabase,
    createMediaAssetStore,
    runMigrations,
} from '../packages/db/src/index'
import { createLocalMediaStore } from '../packages/media/src/index'
import type { CliQualificationFixture } from './cli-qualification-fixture'

export async function createSourceCliFixture(
    directory: string,
    clock: number
): Promise<CliQualificationFixture> {
    const database = createDatabase(':memory:')
    await runMigrations(database)
    const media = createMediaAssetStore(
        database,
        createLocalMediaStore({
            rootDirectory: join(directory, 'objects'),
            storeId: 'cli-distribution',
            maxObjectBytes: 2_000_000,
        })
    )
    const app = createApp({
        manualStore: { now: () => clock },
        database,
        media,
        publisher: createPublisherRuntime(database, {
            apiOrigin: 'http://localhost:3000',
            webOrigin: 'http://localhost:5173',
            publisherEncryptionKey: new Uint8Array(32).fill(7),
            publisherEncryptionKeyId: 'cli-distribution',
        }),
        auth: createAuth(database, {
            baseURL: 'http://localhost:3000',
            secret: 'postdot-cli-distribution-secret-long-enough',
        }),
    })
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: request => app.handle(request),
    })

    return {
        url: server.url,
        handle: (request: Request) => app.handle(request),
        async stop() {
            await server.stop(true)
            closeDatabase(database)
        },
    }
}
