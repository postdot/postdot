import { cn } from '@herald/ui/lib/utils'
import type { ReactNode } from 'react'

export function DashboardPageHeader({
    action,
    children,
    description,
    title,
}: {
    readonly action?: ReactNode
    readonly children?: ReactNode
    readonly description?: string
    readonly title: string
}) {
    return (
        <header className="flex flex-col justify-between gap-4 pb-6 sm:flex-row sm:items-end">
            <div className="min-w-0">
                <h1 className="font-heading text-3xl font-semibold leading-[1.02] tracking-[-0.05em] sm:text-4xl">
                    {title}
                </h1>
                {description ? (
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                        {description}
                    </p>
                ) : null}
                {children}
            </div>
            {action ? (
                <div className={cn('shrink-0', !description && 'sm:pb-0.5')}>{action}</div>
            ) : null}
        </header>
    )
}
