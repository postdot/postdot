import { linkedinChannelProfile } from '@postdot/linkedin'

import type { ProviderWorkerContext } from '../worker-context'
import { linkedinApplicationPolicy } from './application-policy'
import { linkedInPublisherConnectionPolicy } from './connection-policy'
import { createLinkedInProviderAdapter } from './worker'
export const linkedinModule = {
    id: 'linkedin',
    connection: linkedInPublisherConnectionPolicy,
    profile: linkedinChannelProfile,
    application: linkedinApplicationPolicy,
} as const
export const createLinkedinAdapters = ({ publisher }: ProviderWorkerContext) => [
    createLinkedInProviderAdapter({
        revision: 'member-post-v2',
        oauth: publisher.linkedin,
        resolveOAuth: publisher.resolveLinkedInOAuth,
    }),
    createLinkedInProviderAdapter({
        revision: 'member-post-v3',
        oauth: publisher.linkedin,
        resolveOAuth: publisher.resolveLinkedInOAuth,
    }),
    createLinkedInProviderAdapter({
        oauth: publisher.linkedin,
        resolveOAuth: publisher.resolveLinkedInOAuth,
    }),
]
