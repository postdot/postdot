import { blueskyApi } from './bluesky/api'
import { devtoApi } from './devto/api'
import { discordApi } from './discord/api'
import { facebookApi } from './facebook/api'
import { instagramApi } from './instagram/api'
import { linkedinApi } from './linkedin/api'
import { mastodonApi } from './mastodon/api'
import { telegramApi } from './telegram/api'
import { xApi } from './x/api'
export const providerApi = {
    ...devtoApi,
    ...telegramApi,
    ...discordApi,
    ...mastodonApi,
    ...xApi,
    ...blueskyApi,
    ...linkedinApi,
    ...facebookApi,
    ...instagramApi,
}
