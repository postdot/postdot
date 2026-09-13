import { Button } from '@herald/ui/components/button'
import { ButtonGroup } from '@herald/ui/components/button-group'
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
    readonly onSelect: () => void
}

export function BulkActionBar({
    actions,
    allSelected = false,
    ariaLabel,
    clearLabel,
    onClear,
    onToggleAll,
    selectedCount,
    selectionSummary,
    toggleAllLabel,
}: {
    readonly actions?: readonly BulkAction[]
    readonly allSelected?: boolean
    readonly ariaLabel: string
    readonly clearLabel: string
    readonly onClear: () => void
    readonly onToggleAll?: () => void
    readonly selectedCount: number
    readonly selectionSummary: ReactNode
    readonly toggleAllLabel?: string
}) {
    return (
        <div
            role="toolbar"
            aria-label={ariaLabel}
            data-bulk-action-bar="true"
            className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-3 py-2">
            <div className="min-w-0 text-sm font-medium">{selectionSummary}</div>
            <div className="flex flex-wrap items-center gap-2">
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
                {actions?.map(action => (
                    <Button
                        key={action.id}
                        type="button"
                        variant={action.variant ?? 'secondary'}
                        size="sm"
                        disabled={selectedCount === 0 || action.disabled === true}
                        data-bulk-action={action.id}
                        onClick={action.onSelect}>
                        {action.icon}
                        {action.label}
                    </Button>
                ))}
            </div>
        </div>
    )
}
