import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createAuth } from '@postdot/auth'
import { closeDatabase, createDatabase, createMediaAssetStore, runMigrations } from '@postdot/db'
import { createLocalMediaStore } from '@postdot/media'
import type { OpenAPIV3 } from 'openapi-types'

import { createApp } from './app'
import { createMediaPublicDelivery } from './modules/media/public-delivery'
import { createPublisherRuntime } from './modules/publishers/runtime'

/** Assemble route contracts without a listener, scheduler, worker or persistent data. */
export async function exportOpenAPISchema(): Promise<OpenAPIV3.Document> {
    const directory = await mkdtemp(join(tmpdir(), 'postbot-openapi-'))
    const database = createDatabase(':memory:')
    try {
        runMigrations(database)
        const origin = 'http://postbot.invalid'
        const auth = createAuth(database, {
            baseURL: origin,
            secret: 'postbot-documentation-only-secret-not-for-runtime-use',
        })
        const publisher = createPublisherRuntime(database, {
            apiOrigin: origin,
            webOrigin: origin,
            publisherEncryptionKey: new Uint8Array(32).fill(1),
            publisherEncryptionKeyId: 'documentation-only',
        })
        const media = createMediaAssetStore(
            database,
            createLocalMediaStore({
                storeId: 'documentation',
                rootDirectory: directory,
                maxObjectBytes: 1024 * 1024,
            })
        )
        const mediaPublicDelivery = createMediaPublicDelivery({
            baseURL: origin,
            signingSecret: 'documentation-only-media-signing-secret',
        })
        const app = createApp({ auth, database, publisher, media, mediaPublicDelivery })
        const response = await app.handle(new Request(`${origin}/openapi/json`))
        if (!response.ok) throw new Error(`OpenAPI export failed: ${response.status}`)
        const schema = (await response.json()) as OpenAPIV3.Document
        // No deployment origin is appropriate for a portable reference artifact.
        delete schema.servers
        const ids = new Set<string>()
        for (const [path, item] of Object.entries(schema.paths)) {
            for (const method of [
                'get',
                'post',
                'put',
                'patch',
                'delete',
                'head',
                'options',
            ] as const) {
                const operation = item?.[method]
                if (!operation) continue
                if (!operation.operationId || ids.has(operation.operationId))
                    throw new Error(`Missing or duplicate operation ID: ${method} ${path}`)
                ids.add(operation.operationId)
                if (!operation.tags?.length) throw new Error(`Missing tag: ${method} ${path}`)
                // Preserve the distinction between an unspecified response and a typed one.
                if (!operation.responses || Object.keys(operation.responses).length === 0)
                    operation.responses = {
                        default: {
                            description: 'Response schema is not declared for this operation.',
                        },
                    }
            }
        }
        return schema
    } finally {
        closeDatabase(database)
        await rm(directory, { recursive: true, force: true })
    }
}

if (import.meta.main) {
    const output = process.argv[2]
    if (!output) throw new Error('Usage: bun src/openapi-export.ts <output.json>')
    const schema = await exportOpenAPISchema()
    await Bun.write(output, `${JSON.stringify(schema, null, 2)}\n`)
}
