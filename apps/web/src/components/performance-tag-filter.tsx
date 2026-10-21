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
import { CheckIcon } from '@solar-icons/react/linear/check'
import { TagIcon } from '@solar-icons/react/linear/tag'
import { useState } from 'react'

import { sortProjectTags } from '@/lib/project-tags'
import { performanceTagSelectionLimit } from '@/lib/publication-performance'
import * as m from '@/paraglide/messages.js'

export interface PerformanceTagFilterProps {
    readonly tags: readonly ProjectTag[]
    readonly selectedTagIds: readonly string[]
    readonly onChange: (tagIds: string[]) => void
    readonly disabled?: boolean
}

/**
 * Tag filter for the Performance surface.
 *
 * The filter only selects a cohort of current tags: it never creates or edits
 * a tag. Active tags are offered by default, archived tags stay behind an
 * explicit action and a selected tag always remains visible so a stale URL
 * selection can still be read and cleared.
 */
export function PerformanceTagFilter({
    tags,
    selectedTagIds,
    onChange,
    disabled = false,
}: PerformanceTagFilterProps) {
    const [includeArchived, setIncludeArchived] = useState(false)
    const catalogTags = sortProjectTags(tags)
    const catalogTagIds = new Set(catalogTags.map(tag => tag.id))
    const selectedIds = new Set(selectedTagIds)
    const selectionCount = selectedTagIds.length
    const limitReached = selectionCount >= performanceTagSelectionLimit
    const activeTags = catalogTags.filter(tag => tag.state === 'active')
    const archivedTags = catalogTags.filter(tag => tag.state === 'archived')
    const visibleArchivedTags = archivedTags.filter(
        tag => includeArchived || selectedIds.has(tag.id)
    )
    const unavailableSelection = selectedTagIds.some(tagId => !catalogTagIds.has(tagId))

    function toggleTag(tagId: string, checked: boolean) {
        if (checked) {
            if (selectedIds.has(tagId)) return
            if (selectedTagIds.length >= performanceTagSelectionLimit) return
            onChange([...selectedTagIds, tagId])
            return
        }
        onChange(selectedTagIds.filter(id => id !== tagId))
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <Button
                        type="button"
                        aria-label={
                            selectionCount > 0
                                ? m.performance_tag_filter_selected({ count: selectionCount })
                                : m.taxonomy_filter_tags()
                        }
                        data-performance-tag-filter="true"
                        disabled={disabled}
                        size="sm"
                        variant="ghost"
                        className="gap-1.5 px-2">
                        <TagIcon aria-hidden="true" />
                        <span className="text-xs">{m.taxonomy_filter_tags()}</span>
                        {selectionCount > 0 ? (
                            <Badge variant="secondary">{selectionCount}</Badge>
                        ) : null}
                    </Button>
                }
            />
            <DropdownMenuContent align="start" className="min-w-48">
                <DropdownMenuGroup>
                    <DropdownMenuLabel>{m.taxonomy_tags()}</DropdownMenuLabel>
                    {catalogTags.length === 0 ? (
                        <div className="px-2 py-1.5 text-sm text-muted-foreground">
                            {m.taxonomy_no_tags()}
                        </div>
                    ) : (
                        activeTags.map(tag => (
                            <DropdownMenuCheckboxItem
                                key={tag.id}
                                checked={selectedIds.has(tag.id)}
                                data-performance-tag-option={tag.id}
                                disabled={!selectedIds.has(tag.id) && limitReached}
                                onCheckedChange={checked => toggleTag(tag.id, checked)}>
                                {tag.name}
                            </DropdownMenuCheckboxItem>
                        ))
                    )}
                    {unavailableSelection ? (
                        <p className="px-2 py-1.5 text-xs text-muted-foreground">
                            {m.performance_tag_filter_unavailable()}
                        </p>
                    ) : null}
                    {limitReached ? (
                        <p className="px-2 py-1.5 text-xs text-muted-foreground">
                            {m.performance_tag_filter_limit_reached({
                                count: performanceTagSelectionLimit,
                            })}
                        </p>
                    ) : null}
                </DropdownMenuGroup>
                {archivedTags.length > 0 ? (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            closeOnClick={false}
                            data-performance-tag-archived-toggle="true"
                            onClick={() => setIncludeArchived(current => !current)}>
                            {includeArchived ? (
                                <CheckIcon aria-hidden="true" />
                            ) : (
                                <span aria-hidden="true" className="size-4" />
                            )}
                            {m.performance_tag_filter_show_archived()}
                        </DropdownMenuItem>
                    </>
                ) : null}
                {visibleArchivedTags.length > 0 ? (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                            <DropdownMenuLabel>{m.common_archived()}</DropdownMenuLabel>
                            {visibleArchivedTags.map(tag => (
                                <DropdownMenuCheckboxItem
                                    key={tag.id}
                                    checked={selectedIds.has(tag.id)}
                                    data-performance-tag-option={tag.id}
                                    disabled={!selectedIds.has(tag.id) && limitReached}
                                    onCheckedChange={checked => toggleTag(tag.id, checked)}>
                                    {tag.name} · {m.common_archived()}
                                </DropdownMenuCheckboxItem>
                            ))}
                        </DropdownMenuGroup>
                    </>
                ) : null}
                {selectionCount > 0 ? (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            data-performance-tag-clear="true"
                            onClick={() => onChange([])}>
                            {m.taxonomy_clear_tags()}
                        </DropdownMenuItem>
                    </>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
