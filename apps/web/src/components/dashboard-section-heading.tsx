import type { ReactNode } from 'react'

interface DashboardSectionHeadingProps {
    readonly description?: string
    readonly meta?: ReactNode
    readonly title: string
}

export function DashboardSectionHeading({
    description,
    meta,
    title,
}: DashboardSectionHeadingProps) {
    return (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
            <div className="min-w-0">
                <h2 className="font-heading text-xl font-[580] leading-[1.03] tracking-[-0.04em]">
                    {title}
                </h2>
                {description ? (
                    <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                        {description}
                    </p>
                ) : null}
            </div>
            {meta ? <span className="shrink-0 text-sm text-muted-foreground">{meta}</span> : null}
        </div>
    )
}
