import type { ProjectTag } from '@herald/client'
import { Badge } from '@herald/ui/components/badge'
import { Button } from '@herald/ui/components/button'
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from '@herald/ui/components/dropdown-menu'
import { TagIcon } from '@solar-icons/react/linear/tag'

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
}: PublicationTagPickerProps) {
    const selectedIds = new Set(selectedTagIds)
    const selectedCount = tags.reduce((count, tag) => count + (selectedIds.has(tag.id) ? 1 : 0), 0)
    const pickerDisabled = disabled || tags.length === 0
    const triggerAriaLabel =
        selectedCount === 0
            ? (emptyLabel ?? ariaLabel ?? label)
            : (selectedLabel?.(selectedCount) ?? ariaLabel ?? label)

    function handleTagChange(tagId: string, checked: boolean) {
        if (checked) {
            if (selectedIds.has(tagId)) return
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
                    {tags.map(tag => (
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
                    ))}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
