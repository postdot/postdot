import { cn } from '@postdot/ui/lib/utils'
import type { ReactNode } from 'react'

export function DashboardPageHeader({
    action,
    back,
    children,
    centered = false,
    description,
    title,
}: {
    readonly action?: ReactNode
    readonly back?: ReactNode
    readonly children?: ReactNode
    readonly centered?: boolean
    readonly description?: string
    readonly title: string
}) {
    const hasBack = back !== undefined || centered
    const titleBlock = (
        <>
            <h1 className="font-heading text-3xl font-semibold leading-[1.02] xl:text-4xl">
                {title}
            </h1>
            {description ? (
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    {description}
                </p>
            ) : null}
            {children}
        </>
    )

    if (hasBack) {
        return (
            <header className="grid min-w-0 grid-cols-1 gap-3 pb-6 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-start">
                <div className="flex min-w-0 w-full items-center justify-between lg:contents">
                    <div className="min-w-0 lg:col-start-1 lg:row-start-1">{back}</div>
                    <div className="shrink-0 lg:col-start-3 lg:row-start-1 lg:justify-self-end">
                        {action ?? <div aria-hidden="true" />}
                    </div>
                </div>
                <div className="min-w-0 text-center lg:col-start-2 lg:row-start-1">
                    {titleBlock}
                </div>
            </header>
        )
    }

    return (
        <header className="min-w-0 gap-4 pb-6 flex flex-col justify-between sm:flex-row sm:items-end">
            <div className="min-w-0">{titleBlock}</div>
            {action ? (
                <div className={cn('shrink-0', !description && 'sm:pb-0.5')}>{action}</div>
            ) : null}
        </header>
    )
}
