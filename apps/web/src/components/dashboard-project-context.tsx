import {
    Combobox,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxItemIndicator,
    ComboboxLabel,
    ComboboxList,
    ComboboxPopup,
    ComboboxPortal,
    ComboboxPositioner,
    ComboboxTrigger,
    ComboboxValue,
} from '@postbot/ui/components/combobox'
import { Field, FieldLabel } from '@postbot/ui/components/field'
import { Kbd } from '@postbot/ui/components/kbd'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@postbot/ui/components/select'
import { useSidebar } from '@postbot/ui/components/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@postbot/ui/components/tooltip'
import { cn } from '@postbot/ui/lib/utils'
import { AddIcon } from '@solar-icons/react/linear/add'
import { MagnifierIcon } from '@solar-icons/react/linear/magnifier'
import { SettingsIcon } from '@solar-icons/react/linear/settings'
import { UsersGroupTwoRoundedIcon } from '@solar-icons/react/linear/users-group-two-rounded'
import { Widget2Icon } from '@solar-icons/react/linear/widget-2'
import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'

import { ResourceAvatar } from '@/components/identity-visuals'
import { ResourceCreationDialog } from '@/components/resource-creation-dialog'
import type { Project, ProjectCategory, WorkspaceListItem } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

interface ContextSelectorItem {
    readonly description?: string
    readonly icon: ReactNode
    readonly id: string
    readonly kind: 'resource' | 'none'
    readonly label: string
}

interface ContextSelectorProps {
    readonly ariaLabel: string
    readonly createLabel?: string
    readonly emptyLabel: string
    readonly footerAction?: (close: () => void) => ReactNode
    readonly items: readonly ContextSelectorItem[]
    readonly onCreate?: () => void
    readonly onValueChange: (value: string | null) => void
    readonly placeholder: string
    readonly searchPlaceholder: string
    readonly value: string | null
    readonly compact?: 'workspace' | 'project'
}

function ContextSelector({
    ariaLabel,
    createLabel,
    emptyLabel,
    footerAction,
    items,
    onCreate,
    onValueChange,
    placeholder,
    searchPlaceholder,
    value,
    compact,
}: ContextSelectorProps) {
    const [open, setOpen] = useState(false)
    const { isMobile } = useSidebar()
    const selectedItem =
        (value === null
            ? items.find(item => item.kind === 'none')
            : items.find(item => item.id === value)) ?? null

    return (
        <Combobox
            autoHighlight
            items={items}
            itemToStringLabel={item => item.label}
            onOpenChange={setOpen}
            onValueChange={item => {
                if (item === null) {
                    onValueChange(null)
                    return
                }
                onValueChange(item.kind === 'none' ? null : item.id)
            }}
            open={open}
            value={selectedItem}>
            <ComboboxLabel className="sr-only">{ariaLabel}</ComboboxLabel>
            <Tooltip disabled={isMobile}>
                <TooltipTrigger
                    render={
                        <ComboboxTrigger
                            aria-label={ariaLabel}
                            aria-description={
                                compact ? (selectedItem?.label ?? placeholder) : undefined
                            }
                            data-context-selector="true"
                            data-context-kind={compact}
                            className={cn(
                                compact &&
                                    'h-8 w-auto min-w-0 max-w-40 gap-1.5 overflow-hidden bg-surface-control p-0 pr-2 shadow-control hover:bg-surface-control-hover [&_[data-context-empty-icon]]:!h-full [&_[data-context-empty-icon]]:!w-8 [&_[data-context-empty-icon]]:!rounded-none [&_[data-resource-avatar]]:!h-full [&_[data-resource-avatar]]:!w-8 [&_[data-resource-avatar]]:!rounded-none',
                                compact === 'workspace' &&
                                    'max-w-36 max-sm:size-8 max-sm:flex-none max-sm:pr-0 max-sm:[&>svg]:hidden',
                                compact === 'project' &&
                                    'max-sm:max-w-32 max-sm:flex-1 max-sm:[&>svg]:hidden'
                            )}
                        />
                    }>
                    <ComboboxValue placeholder={placeholder}>
                        {(item: ContextSelectorItem | null) =>
                            item ? (
                                <ContextOptionContent
                                    option={item}
                                    hideDescription={compact !== undefined}
                                    hideMobileLabel={compact === 'workspace'}
                                />
                            ) : (
                                <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">
                                    {placeholder}
                                </span>
                            )
                        }
                    </ComboboxValue>
                </TooltipTrigger>
                {compact ? (
                    <TooltipContent>{selectedItem?.label ?? placeholder}</TooltipContent>
                ) : null}
            </Tooltip>

            <ComboboxPortal>
                <ComboboxPositioner align="start" sideOffset={4}>
                    <ComboboxPopup>
                        <div className="relative p-2 pb-1">
                            <MagnifierIcon
                                aria-hidden="true"
                                className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground"
                            />
                            <ComboboxInput
                                aria-label={searchPlaceholder}
                                className="pr-10 pl-8"
                                placeholder={searchPlaceholder}
                            />
                            <Kbd className="absolute top-1/2 right-4 -translate-y-1/2">Esc</Kbd>
                        </div>
                        <ComboboxList className="pt-0">
                            {(item, index) => {
                                const option = item as ContextSelectorItem
                                return (
                                    <ComboboxItem key={option.id} index={index} value={option}>
                                        <ContextOptionContent option={option} />
                                        <ComboboxItemIndicator />
                                    </ComboboxItem>
                                )
                            }}
                        </ComboboxList>
                        <ComboboxEmpty>
                            <div className="px-3 py-6 text-center">{emptyLabel}</div>
                        </ComboboxEmpty>
                        {footerAction || (onCreate && createLabel) ? (
                            <div className="mt-1 space-y-0.5 p-1">
                                {footerAction?.(() => setOpen(false))}
                                {onCreate && createLabel ? (
                                    <button
                                        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
                                        onClick={() => {
                                            setOpen(false)
                                            onCreate()
                                        }}
                                        type="button">
                                        <AddIcon aria-hidden="true" className="size-4 shrink-0" />
                                        {createLabel}
                                    </button>
                                ) : null}
                            </div>
                        ) : null}
                    </ComboboxPopup>
                </ComboboxPositioner>
            </ComboboxPortal>
        </Combobox>
    )
}

function ContextOptionContent({
    option,
    hideDescription = false,
    hideMobileLabel = false,
}: {
    readonly option: ContextSelectorItem
    readonly hideDescription?: boolean
    readonly hideMobileLabel?: boolean
}) {
    return (
        <>
            {option.icon}
            <span className={cn('min-w-0 flex-1 text-left', hideMobileLabel && 'max-sm:hidden')}>
                <span className="block truncate font-medium">{option.label}</span>
                {option.description && !hideDescription ? (
                    <span className="block truncate text-xs text-muted-foreground">
                        {option.description}
                    </span>
                ) : null}
            </span>
        </>
    )
}

function EmptyContextIcon() {
    return (
        <span
            data-context-empty-icon="true"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-inset text-muted-foreground">
            <Widget2Icon aria-hidden="true" className="size-4" />
        </span>
    )
}

interface DashboardProjectContextProps {
    readonly canCreateWorkspace: boolean
    readonly categories: readonly ProjectCategory[]
    readonly onCreateProject: (event: FormEvent<HTMLFormElement>) => void
    readonly onCreateWorkspace: (event: FormEvent<HTMLFormElement>) => void
    readonly onProjectChange: (projectId: string | null) => void
    readonly onProjectNameChange: (value: string) => void
    readonly onWorkspaceChange: (workspaceId: string) => void
    readonly onWorkspaceNameChange: (value: string) => void
    readonly pending: boolean
    readonly projectName: string
    readonly projects: readonly Project[]
    readonly selectedProjectId: string | null
    readonly selectedWorkspaceId: string | null
    readonly workspaceName: string
    readonly workspaces: readonly WorkspaceListItem[]
}

export function DashboardProjectContext({
    canCreateWorkspace,
    categories,
    onCreateProject,
    onCreateWorkspace,
    onProjectChange,
    onProjectNameChange,
    onWorkspaceChange,
    onWorkspaceNameChange,
    pending,
    projectName,
    projects,
    selectedProjectId,
    selectedWorkspaceId,
    workspaceName,
    workspaces,
}: DashboardProjectContextProps) {
    useLanguage()
    const [createProjectOpen, setCreateProjectOpen] = useState(false)
    const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false)
    const previousSelectedProjectId = useRef(selectedProjectId)
    const noProject = m.nav_no_project_selected()
    const workspaceProjects =
        selectedWorkspaceId === null
            ? projects
            : projects.filter(project => project.workspaceId === selectedWorkspaceId)
    const selectedProject =
        workspaceProjects.find(project => project.id === selectedProjectId) ?? null
    const selectedWorkspace =
        workspaces.find(workspace => workspace.id === selectedWorkspaceId) ?? null
    const canManageSelectedWorkspace =
        selectedWorkspace?.role === 'owner' || selectedWorkspace?.role === 'admin'
    const workspaceOptions = workspaces.map<ContextSelectorItem>(workspace => ({
        description: workspaceRoleLabel(workspace.role),
        icon: <ResourceAvatar kind="workspace" name={workspace.name} seed={workspace.id} />,
        id: workspace.id,
        kind: 'resource',
        label: workspace.name,
    }))
    const projectOptions = workspaceProjects.map<ContextSelectorItem>(project => ({
        description: categories.find(category => category.id === project.primaryCategoryId)?.name,
        icon: <ResourceAvatar kind="project" name={project.name} seed={project.id} />,
        id: project.id,
        kind: 'resource',
        label: project.name,
    }))
    const noProjectOption: ContextSelectorItem = {
        icon: <EmptyContextIcon />,
        id: '__none__',
        kind: 'none',
        label: noProject,
    }

    function handleProjectChange(projectId: string | null) {
        setCreateProjectOpen(false)
        onProjectChange(projectId)
    }

    function handleCreateProjectDialogChange(open: boolean) {
        setCreateProjectOpen(open)
        if (!open) onProjectNameChange('')
    }

    function handleCreateWorkspaceDialogChange(open: boolean) {
        setCreateWorkspaceOpen(open)
        if (!open) onWorkspaceNameChange('')
    }

    useEffect(() => {
        if (previousSelectedProjectId.current !== selectedProjectId) {
            setCreateProjectOpen(false)
        }
        previousSelectedProjectId.current = selectedProjectId
    }, [selectedProjectId])

    return (
        <div className="flex min-w-0 items-center gap-1.5" data-header-context="true">
            {workspaces.length > 0 ? (
                <ContextSelector
                    ariaLabel={m.nav_select_workspace()}
                    compact="workspace"
                    createLabel={m.nav_create_workspace()}
                    emptyLabel={m.nav_no_matching_workspaces()}
                    footerAction={close =>
                        canManageSelectedWorkspace ? (
                            <Link
                                onClick={close}
                                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
                                search={{
                                    projectId: selectedProjectId ?? 'none',
                                    workspaceId: selectedWorkspaceId ?? undefined,
                                }}
                                to="/dashboard/settings/workspace">
                                <UsersGroupTwoRoundedIcon
                                    aria-hidden="true"
                                    className="size-4 shrink-0"
                                />
                                {m.nav_workspace_administration()}
                            </Link>
                        ) : null
                    }
                    items={workspaceOptions}
                    onCreate={canCreateWorkspace ? () => setCreateWorkspaceOpen(true) : undefined}
                    onValueChange={value => {
                        if (value !== null) onWorkspaceChange(value)
                    }}
                    placeholder={m.nav_select_workspace()}
                    searchPlaceholder={m.nav_search_workspace()}
                    value={selectedWorkspaceId}
                />
            ) : null}

            <ResourceCreationDialog
                id="new-workspace"
                label={m.nav_new_workspace()}
                maxLength={80}
                onOpenChange={handleCreateWorkspaceDialogChange}
                onSubmit={onCreateWorkspace}
                onValueChange={onWorkspaceNameChange}
                open={createWorkspaceOpen}
                pending={pending}
                placeholder={m.nav_workspace_name()}
                submitLabel={m.nav_add_workspace()}
                title={m.nav_create_workspace()}
                value={workspaceName}
            />

            <ContextSelector
                ariaLabel={m.nav_select_project()}
                compact="project"
                createLabel={m.nav_create_project()}
                emptyLabel={m.nav_no_matching_projects()}
                footerAction={close =>
                    selectedProject === null ? null : (
                        <Link
                            onClick={close}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
                            params={{ projectId: selectedProject.id }}
                            search={{}}
                            to="/dashboard/projects/$projectId/access">
                            <SettingsIcon aria-hidden="true" className="size-4 shrink-0" />
                            {m.nav_project_configuration()}
                        </Link>
                    )
                }
                items={[noProjectOption, ...projectOptions]}
                onCreate={() => setCreateProjectOpen(true)}
                onValueChange={value => handleProjectChange(value)}
                placeholder={noProject}
                searchPlaceholder={m.nav_search_project()}
                value={selectedProjectId}
            />

            <ResourceCreationDialog
                id="new-project"
                label={m.nav_new_project()}
                maxLength={120}
                onOpenChange={handleCreateProjectDialogChange}
                onSubmit={onCreateProject}
                onValueChange={onProjectNameChange}
                open={createProjectOpen}
                pending={pending}
                placeholder={m.nav_project_name()}
                submitLabel={m.nav_add_project()}
                title={m.nav_create_project()}
                value={projectName}
            />
        </div>
    )
}

export function DashboardProjectCategory({
    categories,
    onProjectCategoryChange,
    pending,
    selectedProject,
}: {
    readonly categories: readonly ProjectCategory[]
    readonly onProjectCategoryChange: (projectId: string, categoryId: string | null) => void
    readonly pending: boolean
    readonly selectedProject: Project | null
}) {
    useLanguage()
    if (selectedProject === null || categories.length === 0) return null
    const selectedCategory = categories.find(
        category => category.id === selectedProject.primaryCategoryId
    )
    const categoryOptions = categories.filter(
        category => category.state === 'active' || category.id === selectedCategory?.id
    )

    return (
        <Field className="min-w-0 gap-1.5">
            <FieldLabel className="text-xs font-medium text-muted-foreground">
                {m.nav_category()}
            </FieldLabel>
            <Select
                items={Object.fromEntries([
                    ['__none__', m.nav_no_category()],
                    ...categoryOptions.map(category => [category.id, category.name]),
                ])}
                value={selectedProject.primaryCategoryId ?? '__none__'}
                onValueChange={value =>
                    onProjectCategoryChange(selectedProject.id, value === '__none__' ? null : value)
                }>
                <SelectTrigger
                    aria-label={m.nav_category()}
                    className="h-8 w-full border-0 bg-sidebar-accent/25 px-2.5 text-xs shadow-none hover:bg-sidebar-accent focus-visible:ring-2"
                    disabled={pending}>
                    <SelectValue placeholder={m.nav_no_category()} />
                </SelectTrigger>
                <SelectContent align="start">
                    <SelectItem value="__none__">{m.nav_no_category()}</SelectItem>
                    {categoryOptions.map(category => (
                        <SelectItem
                            key={category.id}
                            disabled={category.state === 'archived'}
                            value={category.id}>
                            {category.name}
                            {category.state === 'archived' ? ` · ${m.common_archived()}` : ''}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </Field>
    )
}

function workspaceRoleLabel(role: WorkspaceListItem['role']) {
    if (role === 'owner') return m.nav_workspace_role_owner()
    if (role === 'admin') return m.nav_workspace_role_admin()
    return m.nav_workspace_role_member()
}
