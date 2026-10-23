import {
    blueskyPostDid,
    blueskyReplyTextValid,
    createBlueskyReplyRecordKey,
} from '@postdot/bluesky'

import type { ProviderEngagement } from '../engagement-contract'
import { performBlueskyReply } from './reply'
export const blueskyEngagement = {
    id: 'bluesky',
    textValid: blueskyReplyTextValid,
    resolveReply: (externalId, _externalUrl) => {
        const did = blueskyPostDid(externalId)
        return did ? { rootUri: externalId, accountId: did, origin: null } : null
    },
    parentAllowed: () => true,
    recordKey: () => createBlueskyReplyRecordKey(),
    firstComment: (work, context) =>
        performBlueskyReply({
            ...context,
            work: {
                projectId: work.projectId,
                rootUri: work.rootUri,
                parentUri: work.rootUri,
                accountId: work.accountId,
                credentialId: work.credentialId,
                text: work.text,
                recordKey: work.recordKey,
                createdAt: context.now,
            },
        }),
    reply: (work, context) => performBlueskyReply({ ...context, work }),
} as const satisfies ProviderEngagement
