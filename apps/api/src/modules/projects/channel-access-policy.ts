import type { AccessStore, ChannelAccessPolicy } from '@postdot/db'

import type { PostbotAuthenticationMethod } from '../../plugins/auth'
import {
    apiKeyHasCapability,
    type PostbotApiKeyCapability,
    type PostbotApiKeyPermissions,
} from './api-key-permissions'

export interface ChannelAccessPolicyInput {
    readonly access: AccessStore
    readonly userId: string
    readonly authMethod: PostbotAuthenticationMethod
    /** `null` means every project the owner can reach; `undefined` for sessions. */
    readonly apiKeyProjectIds: readonly string[] | null | undefined
    readonly apiKeyPermissions: PostbotApiKeyPermissions | undefined
}

/**
 * One decision for sessions and user API keys. A key never exceeds its owner's live
 * role: it adds a capability and a project scope on top of the same role checks.
 * Workspace authority is not available to a key restricted to specific projects.
 */
export function createChannelAccessPolicy(input: ChannelAccessPolicyInput): ChannelAccessPolicy {
    const { access, userId } = input
    const isKey = input.authMethod === 'user_api_key'
    const scoped = isKey && input.apiKeyProjectIds != null
    const capable = (capability: PostbotApiKeyCapability) =>
        !isKey || apiKeyHasCapability(input.apiKeyPermissions ?? null, capability)
    const inScope = (projectId: string) =>
        !scoped || (input.apiKeyProjectIds?.includes(projectId) ?? false)

    return {
        authorizeProject(projectId, action) {
            if (!inScope(projectId)) return false
            switch (action) {
                case 'read_channels':
                    return capable('project:read') && access.canAccessProject(projectId, userId)
                case 'create_channels':
                case 'manage_channels':
                    return (
                        capable('channel:manage') &&
                        access.canAccessProject(projectId, userId, 'editor')
                    )
                case 'share_channels':
                case 'attach_channels':
                case 'accept_channel_management':
                    return (
                        capable('channel:share') &&
                        access.canAccessProject(projectId, userId, 'editor')
                    )
                case 'withdraw_channels':
                    return (
                        capable('channel:share') &&
                        access.canAccessProject(projectId, userId, 'owner')
                    )
            }
        },
        authorizeWorkspace(workspaceId, intent) {
            if (scoped) return false
            return (
                capable(intent === 'share_channels' ? 'channel:share' : 'channel:manage') &&
                access.canManageWorkspace(workspaceId, userId)
            )
        },
        authorizeSharing(projectIds) {
            return capable('channel:share') && projectIds.every(inScope)
        },
    }
}
