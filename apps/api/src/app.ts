import { openapi } from '@elysiajs/openapi'
import type { HeraldAuth } from '@herald/auth'
import {
    createManualStore,
    type HeraldDatabase,
    type ManualStoreOptions,
    type MediaAssetStore,
} from '@herald/db'
import { Elysia } from 'elysia'

import type { HeraldLoggingConfig } from './config'
import { createHealthRoutes, type HealthRoutesOptions } from './modules/health/routes'
import type { MediaPublicDelivery } from './modules/media/public-delivery'
import { createPublicMediaRoutes } from './modules/media/public-routes'
import { createProjectModule } from './modules/projects'
import type { PublisherRuntime } from './modules/publishers/runtime'
import { createAuthRoutes } from './plugins/auth'
import { createErrorHandler } from './plugins/error-handler'
import { createHeraldLogger, createRequestLogger } from './plugins/logger'

export interface HeraldAppOptions {
    readonly auth: HeraldAuth
    readonly database: HeraldDatabase
    readonly publisher: PublisherRuntime
    readonly media?: MediaAssetStore
    readonly mediaPublicDelivery?: MediaPublicDelivery
    readonly manualStore?: ManualStoreOptions
    readonly logging?: HeraldLoggingConfig
    readonly onWorkScheduled?: () => void
    readonly runtime?: HealthRoutesOptions['runtime']
}

function createDomainApp({
    auth,
    database,
    publisher,
    media,
    mediaPublicDelivery,
    manualStore: manualStoreOptions,
    logging,
    onWorkScheduled,
    runtime,
}: HeraldAppOptions) {
    const manualStore = createManualStore(database, {
        ...manualStoreOptions,
        media,
        publicMediaUrlAvailable:
            media !== undefined &&
            (manualStoreOptions?.publicMediaUrlAvailable ?? mediaPublicDelivery !== undefined),
    })
    const publicMediaRoutes =
        media === undefined || mediaPublicDelivery === undefined
            ? new Elysia({ name: 'herald-public-media-disabled' })
            : createPublicMediaRoutes(media, mediaPublicDelivery)
    const logger = logging?.enabled === true ? createHeraldLogger(logging) : undefined

    return new Elysia({ name: 'herald-api' })
        .use(createRequestLogger(logging, logger))
        .use(
            openapi({
                documentation: {
                    info: {
                        title: 'Herald API',
                        version: '0.1.0',
                        description:
                            'The HTTP API for the lightweight, self-hosted Herald publication orchestrator.',
                    },
                    tags: [
                        { name: 'System', description: 'Service health and runtime information.' },
                        { name: 'Projects', description: 'Project lifecycle and access.' },
                        { name: 'Channels', description: 'Project publication destinations.' },
                        { name: 'Posts', description: 'Source posts and publication creation.' },
                        { name: 'Publications', description: 'Publication workflow operations.' },
                        { name: 'Media', description: 'Project media assets and uploads.' },
                        { name: 'Audit', description: 'Project audit history.' },
                    ],
                },
                path: '/openapi',
                specPath: '/openapi/json',
            })
        )
        .use(createErrorHandler())
        .use(createHealthRoutes({ database, runtime }))
        .use(
            createProjectModule({
                auth,
                manualStore,
                publisher,
                media,
                logger,
                onWorkScheduled,
            })
        )
        .use(publicMediaRoutes)
}

/**
 * The Eden contract intentionally covers the typed Herald API routes only.
 * Better Auth's mounted handler is dynamically routed and would otherwise
 * make `/api` ambiguous in Eden's generated path tree.
 */
export type HeraldApp = ReturnType<typeof createDomainApp>

export function createApp({
    auth,
    database,
    publisher,
    media,
    mediaPublicDelivery,
    manualStore: manualStoreOptions,
    logging,
    onWorkScheduled,
    runtime,
}: HeraldAppOptions) {
    return createDomainApp({
        auth,
        database,
        publisher,
        media,
        mediaPublicDelivery,
        manualStore: manualStoreOptions,
        logging,
        onWorkScheduled,
        runtime,
    }).use(createAuthRoutes(auth))
}
