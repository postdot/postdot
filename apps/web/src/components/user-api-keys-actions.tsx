import { Badge } from '@postdot/ui/components/badge'
import type { Dispatch, SetStateAction } from 'react'

import type { UserApiKeyCapability } from '@/lib/api'
import * as m from '@/paraglide/messages.js'

export type KeyScope = 'all' | 'selected'
export type ActionScope = 'all' | 'selected'

const projectCapabilities: readonly UserApiKeyCapability[] = [
    'project:read',
    'project:manage',
    'project:access_manage',
    'project:permanently_delete',
    'publication:manage',
    'publication:approve',
    'publication:dispatch',
    'channel:manage',
    'channel:share',
    'media:manage',
    'media:permanently_delete',
    'analytics:refresh',
]

const adminCapabilities: readonly UserApiKeyCapability[] = [
    'workspace:manage',
    'api_key:manage',
    'instance:admin',
]

export const editableCapabilities: readonly UserApiKeyCapability[] = [
    ...projectCapabilities,
    ...adminCapabilities,
]

export const elevatedCapabilities = new Set<UserApiKeyCapability>([
    'project:access_manage',
    'project:permanently_delete',
    'media:permanently_delete',
    'workspace:manage',
    'api_key:manage',
    'instance:admin',
])

export function capabilityLabel(capability: UserApiKeyCapability) {
    switch (capability) {
        case 'project:manage':
            return m.lifecycle_api_manage()
        case 'project:permanently_delete':
            return m.lifecycle_api_delete()
        case 'project:read':
            return m.api_keys_action_read_project()
        case 'project:access_manage':
            return m.api_keys_action_manage_project_access()
        case 'publication:manage':
            return m.api_keys_action_manage_publications()
        case 'publication:approve':
            return m.api_keys_action_approve_publications()
        case 'publication:dispatch':
            return m.api_keys_action_dispatch_publications()
        case 'channel:manage':
            return m.api_keys_action_manage_channels()
        case 'channel:share':
            return m.api_keys_action_share_channels()
        case 'media:manage':
            return m.api_keys_action_manage_media()
        case 'analytics:refresh':
            return m.api_keys_action_refresh_analytics()
        case 'media:permanently_delete':
            return m.api_keys_action_delete_media()
        case 'workspace:manage':
            return m.api_keys_action_manage_workspaces()
        case 'api_key:manage':
            return m.api_keys_action_manage_api_keys()
        case 'instance:admin':
            return m.api_keys_action_administer_instance()
    }
}

export function ApiKeyActionAccessFieldset({
    isInstanceAdmin,
    name,
    projectScope,
    scope,
    selectedCapabilities,
    onScopeChange,
    onCapabilitiesChange,
}: {
    readonly isInstanceAdmin: boolean
    readonly name: string
    readonly projectScope: KeyScope
    readonly scope: ActionScope
    readonly selectedCapabilities: readonly UserApiKeyCapability[]
    readonly onScopeChange: (scope: ActionScope) => void
    readonly onCapabilitiesChange: Dispatch<SetStateAction<UserApiKeyCapability[]>>
}) {
    const showAllProjectsNotice =
        scope === 'selected' &&
        projectScope === 'selected' &&
        (selectedCapabilities.includes('workspace:manage') ||
            selectedCapabilities.includes('instance:admin'))
    const showAntiEscalationNotice =
        scope === 'all' || selectedCapabilities.includes('api_key:manage')

    function renderCapabilityRow(capability: UserApiKeyCapability) {
        const checked = selectedCapabilities.includes(capability)
        const disabled = capability === 'instance:admin' && !isInstanceAdmin && !checked
        return (
            <label
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors focus-within:ring-3 focus-within:ring-ring/50 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-muted'}`}
                key={capability}>
                <input
                    checked={checked}
                    className="size-4 shrink-0 accent-primary"
                    disabled={disabled}
                    onChange={() =>
                        onCapabilitiesChange(current =>
                            current.includes(capability)
                                ? current.filter(item => item !== capability)
                                : [...current, capability]
                        )
                    }
                    type="checkbox"
                    value={capability}
                />
                <span className="min-w-0 flex-1">
                    {capabilityLabel(capability)}
                    {capability === 'instance:admin' && !isInstanceAdmin ? (
                        <span className="block text-xs text-muted-foreground">
                            {m.api_keys_admin_role_required()}
                        </span>
                    ) : null}
                </span>
                {elevatedCapabilities.has(capability) ? (
                    <Badge className="shrink-0" variant="outline">
                        {m.api_keys_elevated_badge()}
                    </Badge>
                ) : null}
            </label>
        )
    }

    return (
        <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">{m.api_keys_action_access()}</legend>
            <label
                className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors focus-within:ring-3 focus-within:ring-ring/50 ${scope === 'all' ? 'bg-secondary' : 'bg-surface-control hover:bg-muted'}`}>
                <input
                    checked={scope === 'all'}
                    className="size-4 accent-primary"
                    name={`user-api-key-actions-${name}`}
                    onChange={() => onScopeChange('all')}
                    type="radio"
                    value="all"
                />
                <span className="min-w-0 truncate font-medium">
                    {m.api_keys_action_access_all()}
                </span>
            </label>
            <label
                className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors focus-within:ring-3 focus-within:ring-ring/50 ${scope === 'selected' ? 'bg-secondary' : 'bg-surface-control hover:bg-muted'}`}>
                <input
                    checked={scope === 'selected'}
                    className="size-4 accent-primary"
                    name={`user-api-key-actions-${name}`}
                    onChange={() => onScopeChange('selected')}
                    type="radio"
                    value="selected"
                />
                <span className="min-w-0 truncate font-medium">
                    {m.api_keys_action_access_selected()}
                </span>
            </label>
            {scope === 'selected' ? (
                <div className="grid max-h-60 gap-2 overflow-y-auto rounded-md bg-surface-inset/45 p-2">
                    <div className="grid gap-1">
                        <p className="px-2 pt-1 text-xs font-medium text-muted-foreground">
                            {m.api_keys_actions_project_group()}
                        </p>
                        {projectCapabilities.map(renderCapabilityRow)}
                    </div>
                    <div className="grid gap-1 border-t border-border/40 pt-2">
                        <p className="px-2 text-xs font-medium text-muted-foreground">
                            {m.api_keys_actions_admin_group()}
                        </p>
                        {adminCapabilities.map(renderCapabilityRow)}
                    </div>
                </div>
            ) : null}
            {showAllProjectsNotice ? (
                <p className="text-xs text-muted-foreground" role="note">
                    {m.api_keys_all_projects_required_notice()}
                </p>
            ) : null}
            {showAntiEscalationNotice ? (
                <p className="text-xs text-muted-foreground" role="note">
                    {m.api_keys_anti_escalation_notice()}
                </p>
            ) : null}
        </fieldset>
    )
}
