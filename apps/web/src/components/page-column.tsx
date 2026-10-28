import { cn } from '@postdot/ui/lib/utils'
import type { ReactNode } from 'react'

/**
 * Bounded content column for pages whose job is not a work surface (SPEC-010 LAY-02). A page keeps
 * one column for all its content blocks; its title row stays independent of the column.
 */
const columnWidths = {
    /** Lists of peer objects and their actions: 64 rem. */
    management: 'max-w-5xl',
    /** Forms and preferences: 36 rem. */
    reading: 'max-w-xl',
} as const

export function PageColumn({
    children,
    className,
    variant,
}: {
    readonly children: ReactNode
    readonly className?: string
    readonly variant: keyof typeof columnWidths
}) {
    return (
        <div
            className={cn('mx-auto w-full min-w-0', columnWidths[variant], className)}
            data-page-column={variant}>
            {children}
        </div>
    )
}
