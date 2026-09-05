import { cn } from '@herald/ui/lib/utils'
import type { ReactNode } from 'react'

interface PublicationSummaryItem {
    readonly attention?: boolean
    readonly id: string
    readonly label: ReactNode
    readonly value: ReactNode
}

export function PublicationSummaryBar({
    ariaLabel,
    items,
}: {
    readonly ariaLabel: string
    readonly items: readonly PublicationSummaryItem[]
}) {
    return (
        <div
            aria-label={ariaLabel}
            className="flex flex-wrap items-center gap-x-5 gap-y-1.5 bg-muted px-3 py-2.5 text-sm text-muted-foreground sm:px-4">
            {items.map(item => (
                <span className={cn(item.attention && 'text-state-attention')} key={item.id}>
                    <strong className="font-medium text-current">{item.value}</strong> {item.label}
                </span>
            ))}
        </div>
    )
}
