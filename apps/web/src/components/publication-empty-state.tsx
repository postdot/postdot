import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from '@herald/ui/components/empty'
import { cn } from '@herald/ui/lib/utils'
import type { ReactNode } from 'react'

export function PublicationEmptyState({
    action,
    className,
    description,
    illustration,
    title,
}: {
    readonly action?: ReactNode
    readonly className?: string
    readonly description?: ReactNode | null
    readonly illustration?: ReactNode
    readonly title: ReactNode
}) {
    const hasDescription = description !== undefined && description !== null

    return (
        <div
            aria-live="polite"
            className={cn(
                'mt-4 min-h-72 overflow-hidden rounded-lg bg-surface-inset/35 shadow-surface sm:min-h-80',
                className
            )}
            data-publication-empty-state="true"
            role="status">
            <Empty className="min-h-72 gap-4 px-6 py-10 sm:min-h-80 sm:gap-5 sm:py-12">
                <EmptyMedia className="mb-0 text-muted-foreground/65">
                    {illustration ?? <PublicationEmptyIllustration />}
                </EmptyMedia>
                <EmptyHeader className="gap-1.5">
                    <EmptyTitle className="text-base">{title}</EmptyTitle>
                    {hasDescription ? (
                        <EmptyDescription className="max-w-sm">{description}</EmptyDescription>
                    ) : null}
                </EmptyHeader>
                {action ? (
                    <EmptyContent className="w-auto max-w-none">{action}</EmptyContent>
                ) : null}
            </Empty>
        </div>
    )
}

function PublicationEmptyIllustration() {
    return (
        <svg
            aria-hidden="true"
            className="h-32 w-40 overflow-visible sm:h-36 sm:w-44"
            data-publication-empty-illustration="true"
            fill="none"
            viewBox="0 0 176 136">
            <path
                d="M33 105c8-15 18-31 33-39 17-9 35-5 49 4 14 9 24 23 28 35H33Z"
                fill="currentColor"
                opacity="0.1"
            />
            <path
                d="M45 38.5 98 25l28 12.5v58L73 109 45 94.5v-56Z"
                fill="var(--surface-field)"
                stroke="currentColor"
                strokeOpacity="0.35"
                strokeWidth="1.5"
            />
            <path
                d="m98 25 28 12.5-53 13.5-28-12.5L98 25Z"
                fill="var(--surface-control)"
                stroke="currentColor"
                strokeOpacity="0.3"
                strokeWidth="1.5"
            />
            <path
                d="M57 29h53l20 19v52H57V29Z"
                fill="var(--surface-raised)"
                stroke="currentColor"
                strokeOpacity="0.72"
                strokeWidth="1.8"
            />
            <path
                d="M110 29v19h20M70 64h42M70 76h48M70 88h31"
                stroke="currentColor"
                strokeLinecap="round"
                strokeOpacity="0.42"
                strokeWidth="2"
            />
            <circle cx="77" cy="52" fill="var(--primary)" opacity="0.9" r="5" />
            <path
                d="m40 28 2.5 5.5L48 36l-5.5 2.5L40 44l-2.5-5.5L32 36l5.5-2.5L40 28Z"
                fill="var(--primary)"
                opacity="0.55"
            />
            <path d="m119 77 9 9-14 14-9 2 2-9 12-16Z" fill="var(--primary)" opacity="0.8" />
            <path
                d="m114 98 3-3M111 91l9 9"
                stroke="var(--surface-raised)"
                strokeLinecap="round"
                strokeWidth="1.5"
            />
        </svg>
    )
}
