import type { ProjectTag } from '@postbot/client'
import { Badge } from '@postbot/ui/components/badge'
import { Button } from '@postbot/ui/components/button'
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@postbot/ui/components/dropdown-menu'
import { AddIcon } from '@solar-icons/react/linear/add'
import { TagIcon } from '@solar-icons/react/linear/tag'
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
}: PublicationTagPickerProps) {
    useLanguage()
    const [createOpen, setCreateOpen] = useState(false)
    const catalogTags = sortProjectTags(tags)
    const selectedIds = new Set(selectedTagIds)
    const selectedCount = catalogTags.reduce(
        (count, tag) => count + (selectedIds.has(tag.id) ? 1 : 0),
        0
    )
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

    return (
        <>
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
                            {selectedCount > 0 ? (
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
