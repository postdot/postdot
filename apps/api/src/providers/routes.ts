import type { createManualStore, AccessStore } from '@postdot/db'
import type { DevtoFetcher } from '@postdot/devto'
import type { DiscordFetcher } from '@postdot/discord'
import type { MastodonFetcher } from '@postdot/mastodon'
import type { TelegramFetcher } from '@postdot/telegram'
import type { Logger } from 'pino'

import type { PublisherRuntime } from '../modules/publishers/runtime'
import type { AuthenticatedElysia } from '../plugins/auth'
import { registerBlueskyPublisherRoutes } from './bluesky/routes'
import { registerDevtoPublisherRoutes } from './devto/routes'
import { registerDiscordPublisherRoutes } from './discord/routes'
import { registerFacebookPublisherRoutes } from './facebook/routes'
import { registerInstagramPublisherRoutes } from './instagram/routes'
import { registerLinkedInPublisherRoutes } from './linkedin/routes'
import { registerMastodonPublisherRoutes } from './mastodon/routes'
import { registerTelegramPublisherRoutes } from './telegram/routes'
import { registerXPublisherRoutes } from './x/routes'
export interface ProviderConnectionRouteOptions {
    readonly channels: Pick<ReturnType<typeof createManualStore>, 'listChannels'>
    readonly access: AccessStore
    readonly logger?: Logger
    readonly onWorkScheduled?: () => void
    readonly mastodonFetcher?: MastodonFetcher
    readonly discordFetcher?: DiscordFetcher
    readonly telegramFetcher?: TelegramFetcher
    readonly devtoFetcher?: DevtoFetcher
}
export function registerProviderPublisherRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    publisher: PublisherRuntime,
    options: ProviderConnectionRouteOptions
) {
    return registerXPublisherRoutes(
        registerMastodonPublisherRoutes(
            registerDiscordPublisherRoutes(
                registerDevtoPublisherRoutes(
                    registerBlueskyPublisherRoutes(
                        registerTelegramPublisherRoutes(
                            registerLinkedInPublisherRoutes(
                                registerInstagramPublisherRoutes(
                                    registerFacebookPublisherRoutes(app, publisher, options),
                                    publisher,
                                    options
                                ),
                                publisher,
                                options
                            ),
                            publisher,
                            options
                        ),
                        publisher,
                        options
                    ),
                    publisher,
                    options
                ),
                publisher,
                options
            ),
            publisher,
            options
        ),
        publisher,
        options
    )
}
