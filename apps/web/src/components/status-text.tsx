import { cn } from '@postdot/ui/lib/utils'
import type { ReactNode } from 'react'

export type StatusTone = 'positive' | 'attention' | 'critical' | 'neutral' | 'progress'

const toneClass: Record<StatusTone, string> = {
    positive: 'text-state-published',
    attention: 'text-state-attention',
    critical: 'text-state-failed',
    neutral: 'text-muted-foreground',
    progress: 'text-state-queued',
}

/**
 * The one status mark of Studio (ADR-103 §2): a short word in its state colour,
 * without a badge or a dot. Lists, panels and previews use it instead of
 * composing their own badge.
 */
export function StatusText({
    children,
    className,
    tone,
}: {
    readonly children: ReactNode
    readonly className?: string
    readonly tone: StatusTone
}) {
    return (
        <span
            data-status-tone={tone}
            className={cn(
                'inline-flex shrink-0 items-center text-xs font-medium whitespace-nowrap',
                toneClass[tone],
                className
            )}>
            {children}
        </span>
    )
}
