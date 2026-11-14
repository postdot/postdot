import { cn } from '@postdot/ui/lib/utils'
import type { ReactNode } from 'react'

/**
 * The one page header (ADR-103 §2): a left-aligned title that equals the navigation label, with the
 * page action on the same row. Only object pages (a post, a publication) pass `back`; sidebar
 * destinations never do.
 */
export function DashboardPageHeader({
    action,
    back,
    children,
    column,
    description,
    title,
}: {
    readonly action?: ReactNode
    readonly back?: ReactNode
    readonly children?: ReactNode
    /** Aligns the header with the page's bounded content column (SPEC-010 LAY-01). */
    readonly column?: 'management' | 'reading'
    readonly description?: string
    readonly title: string
}) {
    return (
        <header
            className={cn(
                'min-w-0 pb-5',
                column === 'management' && 'mx-auto w-full max-w-5xl',
                column === 'reading' && 'mx-auto w-full max-w-xl'
            )}
            data-page-header="true">
            {back !== undefined ? <div className="-ml-2 mb-1 flex min-w-0">{back}</div> : null}
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <h1 className="line-clamp-2 min-w-0 break-words font-heading text-2xl leading-tight font-semibold">
                    {title}
                </h1>
                {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
            </div>
            {description ? (
                <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
                    {description}
                </p>
            ) : null}
            {children}
        </header>
    )
}
