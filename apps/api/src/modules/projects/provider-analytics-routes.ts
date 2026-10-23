import type { AccessStore, ProviderAnalyticsStore } from '@postdot/db'

import type { BlueskyAnalyticsService } from '../../providers/bluesky/analytics'
import { registerBlueskyAnalyticsRoutes } from '../../providers/bluesky/analytics-routes'
import type { DevtoAnalyticsService } from '../../providers/devto/analytics'
import { registerDevtoAnalyticsRoutes } from '../../providers/devto/analytics-routes'
import type { AuthenticatedElysia } from './types'
export function registerProviderAnalyticsRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    store: ProviderAnalyticsStore,
    bluesky: BlueskyAnalyticsService,
    devto: DevtoAnalyticsService,
    access: AccessStore
) {
    return registerDevtoAnalyticsRoutes(
        registerBlueskyAnalyticsRoutes(app, store, bluesky, access),
        store,
        devto,
        access
    )
}
