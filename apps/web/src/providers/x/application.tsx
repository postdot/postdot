import * as m from '@/paraglide/messages.js'

import type { ProviderApplicationDefinition } from '../application-contract'
import { oauthApplicationRules } from '../oauth-application'
import { OAuthApplicationFields } from '../oauth-application-fields'
export const application: ProviderApplicationDefinition = {
    ...oauthApplicationRules,
    label: m.provider_apps_provider_x,
    Fields: props => (
        <OAuthApplicationFields
            {...props}
            fields={{
                callback: 'x',
                callbackLabel: m.provider_apps_x_callback_uri,
                callbackHelp: m.provider_apps_x_callback_help,
            }}
        />
    ),
}
