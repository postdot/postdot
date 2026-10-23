import {
    resolveMastodonStatusReference,
    mastodonReplyStatusId,
    mastodonReplyTextValid,
} from '@postdot/mastodon'

import type { ProviderEngagement } from '../engagement-contract'
import { performMastodonFirstComment } from './first-comment'
import { performMastodonReply } from './reply'
export const mastodonEngagement = {
    id: 'mastodon',
    textValid: mastodonReplyTextValid,
    resolveReply: (externalId, externalUrl) => {
        const ref = resolveMastodonStatusReference(externalId, externalUrl)
        return ref ? { rootUri: ref.rootUri, accountId: null, origin: ref.origin } : null
    },
    parentAllowed: (parentUri, origin) =>
        origin !== null && Boolean(mastodonReplyStatusId(parentUri, origin)),
    recordKey: requestId => requestId,
    firstComment: (work, context) => performMastodonFirstComment({ ...context, work }),
    reply: (work, context) => performMastodonReply({ ...context, work }),
} as const satisfies ProviderEngagement
