import { createFileRoute } from '@tanstack/react-router'

import { UserApiKeysPage } from '@/components/user-api-keys-page'

export interface UserApiKeysSearch {
    workspaceId?: string
}

export const Route = createFileRoute('/dashboard/preferences/api-keys')({
    validateSearch: (search: Record<string, unknown>): UserApiKeysSearch => {
        const validated: UserApiKeysSearch = {}
        if (typeof search.workspaceId === 'string' && search.workspaceId.length > 0) {
            validated.workspaceId = search.workspaceId
        }
        return validated
    },
    component: UserApiKeysPage,
})
