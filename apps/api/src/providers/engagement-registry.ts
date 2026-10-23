import { blueskyEngagement } from './bluesky/engagement'
import type { ProviderEngagement } from './engagement-contract'
import { mastodonEngagement } from './mastodon/engagement'
const installedEngagement: readonly ProviderEngagement[] = [blueskyEngagement, mastodonEngagement]
export function providerEngagement(id: string) {
    return installedEngagement.find(provider => provider.id === id)
}
