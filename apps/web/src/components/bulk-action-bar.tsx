import { Button } from '@herald/ui/components/button'
import { ButtonGroup } from '@herald/ui/components/button-group'
import { cn } from '@herald/ui/lib/utils'
import type { ReactNode } from 'react'

export type BulkActionVariant =
    | 'default'
    | 'outline'
    | 'secondary'
    | 'ghost'
    | 'destructive'
    | 'link'

export interface BulkAction {
    readonly id: string
    readonly label: string
    readonly icon?: ReactNode
    readonly variant?: BulkActionVariant
    readonly disabled?: boolean
    readonly disabledReason?: string
    readonly onSelect: () => void
}

export function BulkActionBar({
    actions,
    allSelected = false,
    ariaLabel,
    clearLabel,
    className,
    leadingContent,
    onClear,
    onToggleAll,
    quietWhenEmpty = false,
    selectedCount,
    selectionSummary,
    showActions = true,
    showClearSelection = false,
    toggleAllLabel,
}: {
    readonly actions?: readonly BulkAction[]
    readonly allSelected?: boolean
    readonly ariaLabel: string
    readonly clearLabel: string
    readonly className?: string
    readonly leadingContent?: ReactNode
    readonly onClear: () => void
    readonly onToggleAll?: () => void
    readonly quietWhenEmpty?: boolean
    readonly selectedCount: number
    readonly selectionSummary: ReactNode
    readonly showActions?: boolean
    readonly showClearSelection?: boolean
    readonly toggleAllLabel?: string
}) {
    const quiet = quietWhenEmpty && selectedCount === 0

    return (
        <div
            role="toolbar"
            aria-label={ariaLabel}
            data-bulk-action-bar="true"
            className={cn(
                'sticky top-3 z-10 flex flex-wrap items-center justify-between gap-2 max-sm:flex-col max-sm:items-stretch',
                quiet
                    ? 'px-0 py-0'
                    : 'rounded-md bg-surface-inset/95 px-3 py-2 shadow-surface backdrop-blur-sm',
                className
            )}>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                {leadingContent}
                {selectionSummary !== null && selectionSummary !== undefined ? (
                    <div className="min-w-0 text-sm font-medium">{selectionSummary}</div>
                ) : null}
            </div>
            {showActions ? (
                <div
                    className="flex flex-wrap items-center justify-end gap-2"
                    data-bulk-actions="true">
                    {onToggleAll !== undefined && toggleAllLabel !== undefined ? (
                        <ButtonGroup>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={selectedCount === 0 && allSelected}
                                aria-pressed={allSelected}
                                data-bulk-select-all="true"
                                onClick={onToggleAll}>
                                {toggleAllLabel}
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={selectedCount === 0}
                                data-bulk-clear-selection="true"
                                onClick={onClear}>
                                {clearLabel}
                            </Button>
                        </ButtonGroup>
                    ) : null}
                    {showClearSelection ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={selectedCount === 0}
                            data-bulk-clear-selection="true"
                            onClick={onClear}>
                            {clearLabel}
                        </Button>
                    ) : null}
                    {actions?.map(action => (
                        <Button
                            key={action.id}
                            type="button"
                            variant={action.variant ?? 'secondary'}
                            size="sm"
                            disabled={selectedCount === 0 || action.disabled === true}
                            title={action.disabled ? action.disabledReason : undefined}
                            data-bulk-action={action.id}
                            onClick={action.onSelect}>
                            {action.icon}
                            {action.label}
                        </Button>
                    ))}
                </div>
            ) : null}
        </div>
    )
}
