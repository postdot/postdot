import { openapi } from '@elysiajs/openapi'
import type { HeraldAuth } from '@herald/auth'
import { createManualStore, type HeraldDatabase, type ManualStoreOptions } from '@herald/db'
import { Elysia } from 'elysia'

import type { HeraldLoggingConfig } from './config'
import { createHealthRoutes } from './modules/health/routes'
import { createProjectModule } from './modules/projects'
import type { PublisherRuntime } from './modules/publishers/runtime'
import { createAuthRoutes } from './plugins/auth'
import { createErrorHandler } from './plugins/error-handler'
import { createRequestLogger } from './plugins/logger'

export interface HeraldAppOptions {
    readonly auth: HeraldAuth
    readonly database: HeraldDatabase
    readonly publisher: PublisherRuntime
    readonly manualStore?: ManualStoreOptions
    readonly logging?: HeraldLoggingConfig
    readonly onWorkScheduled?: () => void
}

function createDomainApp({
    auth,
    database,
    publisher,
    manualStore: manualStoreOptions,
    logging,
    onWorkScheduled,
}: HeraldAppOptions) {
    const manualStore = createManualStore(database, manualStoreOptions)

    return new Elysia({ name: 'herald-api' })
        .use(createRequestLogger(logging))
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
                        { name: 'Audit', description: 'Project audit history.' },
                    ],
                },
                path: '/openapi',
                specPath: '/openapi/json',
            })
        )
        .use(createErrorHandler())
        .use(createHealthRoutes())
        .use(
            createProjectModule({
                auth,
                manualStore,
                publisher,
                onWorkScheduled,
            })
        )
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
    manualStore: manualStoreOptions,
    logging,
    onWorkScheduled,
}: HeraldAppOptions) {
    return createDomainApp({
        auth,
        database,
        publisher,
        manualStore: manualStoreOptions,
        logging,
        onWorkScheduled,
    }).use(createAuthRoutes(auth))
}
