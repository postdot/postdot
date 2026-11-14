import type { ProjectTag } from '@postdot/client'
import { Badge } from '@postdot/ui/components/badge'
import { Button } from '@postdot/ui/components/button'
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@postdot/ui/components/dropdown-menu'
import { AddIcon } from '@solar-icons/react/linear/add'
import { CloseIcon } from '@solar-icons/react/linear/close'
import { TagIcon } from '@solar-icons/react/linear/tag'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'

import { ProjectTagDialog } from '@/components/project-tag-create-dialog'
import { useLanguage } from '@/lib/i18n'
import { sortProjectTags } from '@/lib/project-tags'
import * as m from '@/paraglide/messages.js'

export interface PublicationTagPickerProps {
    readonly tags: readonly ProjectTag[]
    readonly selectedTagIds: readonly string[]
    readonly onChange: (tagIds: string[]) => void
    readonly disabled?: boolean
    readonly label?: string
    readonly emptyLabel?: string
    readonly selectedLabel?: (count: number) => string
    readonly ariaLabel?: string
    readonly archivedLabel?: string
    readonly onCreateTag?: (name: string) => Promise<ProjectTag>
    readonly showSelectedTags?: boolean
    readonly manageTagsProjectId?: string
}

export function PublicationTagPicker({
    tags,
    selectedTagIds,
    onChange,
    disabled = false,
    label,
    emptyLabel,
    selectedLabel,
    ariaLabel,
    archivedLabel,
    onCreateTag,
    showSelectedTags = false,
    manageTagsProjectId,
}: PublicationTagPickerProps) {
    useLanguage()
    const [createOpen, setCreateOpen] = useState(false)
    const catalogTags = sortProjectTags(tags)
    const selectedIds = new Set(selectedTagIds)
    const selectedTags = catalogTags.filter(tag => selectedIds.has(tag.id))
    const selectedCount = selectedTags.length
    const visibleTags = catalogTags.filter(tag => tag.state === 'active' || selectedIds.has(tag.id))
    const pickerDisabled = disabled || (visibleTags.length === 0 && onCreateTag === undefined)
    const triggerAriaLabel =
        selectedCount === 0
            ? (ariaLabel ?? label ?? emptyLabel ?? m.taxonomy_select_tags())
            : (selectedLabel?.(selectedCount) ?? ariaLabel ?? label ?? m.taxonomy_select_tags())

    function handleTagChange(tagId: string, checked: boolean) {
        if (checked) {
            if (selectedIds.has(tagId)) return
            onChange([...selectedTagIds, tagId])
            return
        }

        onChange(selectedTagIds.filter(id => id !== tagId))
    }

    async function handleCreateTag(name: string) {
        if (onCreateTag === undefined) return
        const tag = await onCreateTag(name)
        if (!selectedIds.has(tag.id)) onChange([...selectedTagIds, tag.id])
    }

    const menu = (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <Button
                        type="button"
                        aria-label={triggerAriaLabel}
                        disabled={pickerDisabled}
                        size="sm"
                        variant="ghost"
                        className="gap-1.5 px-2">
                        <TagIcon aria-hidden="true" />
                        {label ? <span className="text-xs">{label}</span> : null}
                        {!showSelectedTags && selectedCount > 0 ? (
                            <Badge variant="secondary">{selectedCount}</Badge>
                        ) : null}
                    </Button>
                }
            />
            <DropdownMenuContent align="start" className="min-w-48">
                <DropdownMenuGroup>
                    {label ? <DropdownMenuLabel>{label}</DropdownMenuLabel> : null}
                    {visibleTags.length === 0 ? (
                        <div className="px-2 py-1.5 text-sm text-muted-foreground">
                            {emptyLabel ?? m.taxonomy_no_tags()}
                        </div>
                    ) : (
                        visibleTags.map(tag => (
                            <DropdownMenuCheckboxItem
                                key={tag.id}
                                checked={selectedIds.has(tag.id)}
                                disabled={tag.state === 'archived' && !selectedIds.has(tag.id)}
                                onCheckedChange={checked => handleTagChange(tag.id, checked)}>
                                {tag.name}
                                {tag.state === 'archived' && archivedLabel
                                    ? ` · ${archivedLabel}`
                                    : null}
                            </DropdownMenuCheckboxItem>
                        ))
                    )}
                </DropdownMenuGroup>
                {onCreateTag !== undefined ? (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => setCreateOpen(true)}>
                            <AddIcon aria-hidden="true" />
                            {m.project_tags_create()}
                        </DropdownMenuItem>
                    </>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
    )

    return (
        <>
            {showSelectedTags || manageTagsProjectId !== undefined ? (
                <div
                    data-publication-tag-picker="true"
                    className="flex min-w-0 flex-wrap items-center gap-1.5">
                    {menu}
                    {showSelectedTags
                        ? selectedTags.map(tag => {
                              const tagLabel =
                                  tag.state === 'archived' && archivedLabel
                                      ? `${tag.name} · ${archivedLabel}`
                                      : tag.name
                              return (
                                  <Badge
                                      key={tag.id}
                                      variant="secondary"
                                      data-selected-tag={tag.id}
                                      className="max-w-full gap-1 pr-1 font-normal">
                                      <span className="truncate">{tagLabel}</span>
                                      <button
                                          type="button"
                                          aria-label={m.taxonomy_remove_tag({ tag: tag.name })}
                                          disabled={disabled}
                                          onClick={() => handleTagChange(tag.id, false)}
                                          className="inline-flex size-4 shrink-0 items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50">
                                          <CloseIcon aria-hidden="true" className="size-3" />
                                      </button>
                                  </Badge>
                              )
                          })
                        : null}
                    {showSelectedTags && onCreateTag !== undefined ? (
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={disabled}
                            onClick={() => setCreateOpen(true)}
                            className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground">
                            <AddIcon aria-hidden="true" className="size-3.5" />
                            {m.project_tags_create()}
                        </Button>
                    ) : null}
                    {manageTagsProjectId !== undefined ? (
                        <Link
                            to="/dashboard/projects/$projectId/tags"
                            params={{ projectId: manageTagsProjectId }}
                            className="inline-flex h-7 items-center px-2 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                            {m.taxonomy_manage_tags()}
                        </Link>
                    ) : null}
                </div>
            ) : (
                menu
            )}
            {onCreateTag !== undefined ? (
                <ProjectTagDialog
                    open={createOpen}
                    onOpenChange={setCreateOpen}
                    onSubmit={handleCreateTag}
                    submitIcon={<AddIcon aria-hidden="true" />}
                    submitLabel={m.project_tags_create_and_select()}
                    title={m.project_tags_create_title()}
                />
            ) : null}
        </>
    )
}
