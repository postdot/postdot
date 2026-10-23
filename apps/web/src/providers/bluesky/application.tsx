import * as m from '@/paraglide/messages.js'

import type { ProviderApplicationDefinition } from '../application-contract'
import Fields from './application-fields'
export const application: ProviderApplicationDefinition = {
    label: m.provider_apps_provider_bluesky,
    Fields,
    defaults: { handleResolver: 'https://bsky.social', blueskyOAuthMode: 'loopback' },
    canSubmit: form => form.blueskyOAuthMode === 'loopback' || form.clientMetadataUrl.trim() !== '',
    input: form => ({
        clientMetadataUrl:
            form.blueskyOAuthMode === 'loopback' ? null : form.clientMetadataUrl.trim(),
        handleResolver: form.handleResolver.trim() || 'https://bsky.social',
    }),
    status: saved =>
        saved.oauthMode === 'loopback'
            ? m.provider_apps_loopback_oauth()
            : m.provider_apps_public_metadata(),
}
