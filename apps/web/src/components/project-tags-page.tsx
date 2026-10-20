import type { ProjectTag } from '@postbot/client'
import { Alert, AlertDescription, AlertTitle } from '@postbot/ui/components/alert'
import { Badge } from '@postbot/ui/components/badge'
import { Button } from '@postbot/ui/components/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@postbot/ui/components/dropdown-menu'
import { Skeleton } from '@postbot/ui/components/skeleton'
import { AddIcon } from '@solar-icons/react/linear/add'
import { ArchiveIcon } from '@solar-icons/react/linear/archive'
import { MenuDotsVerticalIcon } from '@solar-icons/react/linear/menu-dots-vertical'
import { Pen2Icon } from '@solar-icons/react/linear/pen-2'
import { RestartIcon } from '@solar-icons/react/linear/restart'
import { TagIcon } from '@solar-icons/react/linear/tag'
import { useState } from 'react'

import { AccessPageHeader } from '@/components/access-page-header'
import { ActionTooltip } from '@/components/action-tooltip'
import { EmptyState } from '@/components/empty-state'
import { ProjectTagDialog } from '@/components/project-tag-create-dialog'
import { QueryErrorState } from '@/components/query-error-state'
import { formatApiError } from '@/lib/api'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import {
    formatProjectTagMutationError,
    sortProjectTags,
    useProjectTagCatalog,
} from '@/lib/project-tags'
import * as m from '@/paraglide/messages.js'

export function ProjectTagsPage() {
    useLanguage()
    const {
        onArchiveProjectTag,
        onCreateProjectTag,
        onRenameProjectTag,
        onRestoreProjectTag,
        project,
        projectRole,
    } = useProjectDashboard()
    const canManage = projectRole === 'owner' || projectRole === 'editor'
    const catalogQuery = useProjectTagCatalog(project.id)
    const [createOpen, setCreateOpen] = useState(false)
    const [renameTag, setRenameTag] = useState<ProjectTag | null>(null)
    const [pendingTagId, setPendingTagId] = useState<string | null>(null)
    const [actionError, setActionError] = useState<string | null>(null)

    async function handleCreate(name: string) {
        setActionError(null)
        await onCreateProjectTag(name)
    }

    async function handleRename(name: string) {
        if (renameTag === null) return
        setActionError(null)
        await onRenameProjectTag(renameTag.id, name)
    }

    async function handleLifecycle(tag: ProjectTag) {
        setActionError(null)
        setPendingTagId(tag.id)
        try {
            if (tag.state === 'archived') {
                await onRestoreProjectTag(tag.id)
            } else {
                await onArchiveProjectTag(tag.id)
            }
        } catch (error) {
            setActionError(formatProjectTagMutationError(error))
        } finally {
            setPendingTagId(null)
        }
    }

    const tags = catalogQuery.data?.tags ?? []
    const activeTags = sortProjectTags(tags.filter(tag => tag.state === 'active'))
    const archivedTags = sortProjectTags(tags.filter(tag => tag.state === 'archived'))
    const loaded = catalogQuery.data !== undefined
    const refreshError =
        catalogQuery.error !== null && catalogQuery.error !== undefined
            ? formatApiError(catalogQuery.error)
            : null

    return (
        <main className="min-w-0 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
            <div className="w-full">
                <AccessPageHeader
                    action={
                        canManage && loaded ? (
                            <Button onClick={() => setCreateOpen(true)} size="sm">
                                <AddIcon aria-hidden="true" />
                                {m.project_tags_create()}
                            </Button>
                        ) : undefined
                    }
                    projectId={project.id}
                    title={m.project_tags_title()}
                />
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                    {m.project_tags_description()}
                </p>
                {!canManage ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                        {m.project_tags_read_only()}
                    </p>
                ) : null}

                {actionError ? (
                    <Alert
                        className="mt-6 rounded-md border-state-failed/35 bg-state-failed/10"
                        variant="destructive">
                        <AlertTitle>{m.project_tags_action_failed()}</AlertTitle>
                        <AlertDescription>{actionError}</AlertDescription>
                    </Alert>
                ) : null}

                {loaded && refreshError ? (
                    <Alert
                        className="mt-6 rounded-md border-state-failed/35 bg-state-failed/10"
                        variant="destructive">
                        <AlertTitle>{m.project_tags_refresh_failed()}</AlertTitle>
                        <AlertDescription className="flex flex-wrap items-center gap-3">
                            <span>{refreshError}</span>
                            <Button
                                onClick={() => void catalogQuery.refetch()}
                                size="sm"
                                variant="ghost">
                                {m.common_retry()}
                            </Button>
                        </AlertDescription>
                    </Alert>
                ) : null}

                {catalogQuery.isPending ? (
                    <div aria-busy="true" className="mt-8 space-y-3" role="status">
                        <span className="sr-only">{m.common_loading()}</span>
                        <Skeleton className="h-12 rounded-md bg-surface-control motion-reduce:animate-none" />
                        <Skeleton className="h-12 rounded-md bg-surface-control motion-reduce:animate-none" />
                        <Skeleton className="h-12 rounded-md bg-surface-control motion-reduce:animate-none" />
                    </div>
                ) : !loaded && catalogQuery.isError ? (
                    <QueryErrorState className="mt-8" onRetry={() => void catalogQuery.refetch()} />
                ) : tags.length === 0 ? (
                    <EmptyState
                        action={
                            canManage ? (
                                <Button
                                    onClick={() => setCreateOpen(true)}
                                    size="sm"
                                    variant="ghost">
                                    <AddIcon aria-hidden="true" />
                                    {m.project_tags_create()}
                                </Button>
                            ) : undefined
                        }
                        className="mt-8"
                        description={m.project_tags_empty_description()}
                        icon={<TagIcon aria-hidden="true" />}
                        layout="compact"
                        title={m.project_tags_empty_title()}
                    />
                ) : (
                    <div className="mt-8 space-y-8">
                        <section aria-labelledby="project-active-tags">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <h2 className="text-sm font-semibold" id="project-active-tags">
                                    {m.project_tags_active()}
                                </h2>
                                <span className="text-xs text-muted-foreground">
                                    {activeTags.length}
                                </span>
                            </div>
                            {activeTags.length > 0 ? (
                                <ul className="divide-y divide-border/60 overflow-hidden rounded-md bg-surface-raised shadow-surface">
                                    {activeTags.map(tag => (
                                        <ProjectTagRow
                                            key={tag.id}
                                            canManage={canManage}
                                            disabled={pendingTagId !== null}
                                            onLifecycle={() => void handleLifecycle(tag)}
                                            onRename={() => setRenameTag(tag)}
                                            pending={pendingTagId === tag.id}
                                            tag={tag}
                                        />
                                    ))}
                                </ul>
                            ) : (
                                <p className="rounded-md bg-surface-inset/45 px-4 py-3 text-sm text-muted-foreground">
                                    {m.project_tags_no_active()}
                                </p>
                            )}
                        </section>

                        {archivedTags.length > 0 ? (
                            <section aria-labelledby="project-archived-tags">
                                <div className="mb-3 flex items-center justify-between gap-3">
                                    <h2
                                        className="text-sm font-semibold"
                                        id="project-archived-tags">
                                        {m.project_tags_archived()}
                                    </h2>
                                    <span className="text-xs text-muted-foreground">
                                        {archivedTags.length}
                                    </span>
                                </div>
                                <ul className="divide-y divide-border/60 overflow-hidden rounded-md bg-surface-raised shadow-surface">
                                    {archivedTags.map(tag => (
                                        <ProjectTagRow
                                            key={tag.id}
                                            canManage={canManage}
                                            disabled={pendingTagId !== null}
                                            onLifecycle={() => void handleLifecycle(tag)}
                                            onRename={() => setRenameTag(tag)}
                                            pending={pendingTagId === tag.id}
                                            tag={tag}
                                        />
                                    ))}
                                </ul>
                            </section>
                        ) : null}
                    </div>
                )}
            </div>

            {canManage ? (
                <>
                    <ProjectTagDialog
                        open={createOpen}
                        onOpenChange={setCreateOpen}
                        onSubmit={handleCreate}
                        submitIcon={<AddIcon aria-hidden="true" />}
                        submitLabel={m.project_tags_create()}
                        title={m.project_tags_create_title()}
                    />
                    <ProjectTagDialog
                        initialName={renameTag?.name ?? ''}
                        open={renameTag !== null}
                        onOpenChange={open => {
                            if (!open) setRenameTag(null)
                        }}
                        onSubmit={handleRename}
                        submitLabel={m.common_save()}
                        title={m.project_tags_rename_title()}
                    />
                </>
            ) : null}
        </main>
    )
}

function ProjectTagRow({
    canManage,
    disabled,
    onLifecycle,
    onRename,
    pending,
    tag,
}: {
    readonly canManage: boolean
    readonly disabled: boolean
    readonly onLifecycle: () => void
    readonly onRename: () => void
    readonly pending: boolean
    readonly tag: ProjectTag
}) {
    const archived = tag.state === 'archived'
    const manageLabel = m.project_tags_manage({ tag: tag.name })

    return (
        <li
            aria-busy={pending}
            className="flex min-w-0 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/35">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <TagIcon
                    aria-hidden="true"
                    className={
                        archived
                            ? 'size-4 shrink-0 text-muted-foreground/60'
                            : 'size-4 shrink-0 text-muted-foreground'
                    }
                />
                <span
                    className={
                        archived
                            ? 'truncate text-sm text-muted-foreground'
                            : 'truncate text-sm font-medium'
                    }>
                    {tag.name}
                </span>
                {archived ? <Badge variant="outline">{m.common_archived()}</Badge> : null}
            </div>
            {canManage ? (
                <DropdownMenu>
                    <ActionTooltip label={manageLabel}>
                        <DropdownMenuTrigger
                            render={
                                <Button
                                    aria-label={manageLabel}
                                    className="shrink-0"
                                    disabled={disabled}
                                    size="icon-sm"
                                    variant="ghost">
                                    <MenuDotsVerticalIcon aria-hidden="true" />
                                </Button>
                            }
                        />
                    </ActionTooltip>
                    <DropdownMenuContent align="end" className="min-w-40">
                        <DropdownMenuItem disabled={disabled} onClick={onRename}>
                            <Pen2Icon aria-hidden="true" />
                            {m.project_tags_rename()}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={disabled} onClick={onLifecycle}>
                            {archived ? (
                                <RestartIcon aria-hidden="true" />
                            ) : (
                                <ArchiveIcon aria-hidden="true" />
                            )}
                            {archived ? m.common_restore() : m.common_archive()}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            ) : null}
        </li>
    )
}
