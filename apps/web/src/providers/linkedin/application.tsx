import * as m from '@/paraglide/messages.js'

import type { ProviderApplicationDefinition } from '../application-contract'
import { oauthApplicationRules } from '../oauth-application'
import { OAuthApplicationFields } from '../oauth-application-fields'
export const application: ProviderApplicationDefinition = {
    ...oauthApplicationRules,
    label: m.provider_apps_provider_linkedin,
    Fields: props => <OAuthApplicationFields {...props} fields={{}} />,
}
