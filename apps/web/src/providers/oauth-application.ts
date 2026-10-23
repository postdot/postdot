import * as m from '@/paraglide/messages.js'

import type { ProviderApplicationDefinition } from './application-contract'
export const oauthApplicationRules: Pick<
    ProviderApplicationDefinition,
    'canSubmit' | 'input' | 'status'
> = {
    canSubmit: (form, saved) =>
        form.clientId.trim() !== '' &&
        (saved?.hasClientSecret === true || form.clientSecret.trim() !== ''),
    input: form => ({
        clientId: form.clientId.trim(),
        ...(form.clientSecret.trim() === '' ? {} : { clientSecret: form.clientSecret.trim() }),
    }),
    status: saved =>
        saved.hasClientSecret ? m.provider_apps_configured() : m.provider_apps_not_configured(),
}
