import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from '@postdot/ui/components/empty'
import { cn } from '@postdot/ui/lib/utils'
import type { ComponentProps, ReactNode } from 'react'

import accessDark from '@/assets/empty-states/access-dark.svg'
import accessLight from '@/assets/empty-states/access-light.svg'
import dataDark from '@/assets/empty-states/data-dark.svg'
import dataLight from '@/assets/empty-states/data-light.svg'
import eventDark from '@/assets/empty-states/event-dark.svg'
import eventLight from '@/assets/empty-states/event-light.svg'
import imageDark from '@/assets/empty-states/image-dark.svg'
import imageLight from '@/assets/empty-states/image-light.svg'
import networkDark from '@/assets/empty-states/network-dark.svg'
import networkLight from '@/assets/empty-states/network-light.svg'
import notificationsDark from '@/assets/empty-states/notifications-dark.svg'
import notificationsLight from '@/assets/empty-states/notifications-light.svg'
import resultDark from '@/assets/empty-states/result-dark.svg'
import resultLight from '@/assets/empty-states/result-light.svg'
import taskDark from '@/assets/empty-states/task-dark.svg'
import taskLight from '@/assets/empty-states/task-light.svg'

const emptyIllustrations = {
    access: { dark: accessDark, light: accessLight },
    data: { dark: dataDark, light: dataLight },
    event: { dark: eventDark, light: eventLight },
    image: { dark: imageDark, light: imageLight },
    network: { dark: networkDark, light: networkLight },
    notifications: { dark: notificationsDark, light: notificationsLight },
    result: { dark: resultDark, light: resultLight },
    task: { dark: taskDark, light: taskLight },
} as const

export type EmptyStateIllustration = keyof typeof emptyIllustrations
export type EmptyStateLayout = 'default' | 'compact'

export interface EmptyStateProps extends Omit<ComponentProps<typeof Empty>, 'title'> {
    readonly action?: ReactNode
    readonly description?: ReactNode | null
    readonly icon?: ReactNode
    readonly illustration?: EmptyStateIllustration
    readonly illustrationClassName?: string
    readonly layout?: EmptyStateLayout
    readonly title: ReactNode
}

export function EmptyState({
    action,
    className,
    description,
    icon,
    illustration,
    illustrationClassName,
    layout = 'default',
    title,
    ...props
}: EmptyStateProps) {
    // One empty state, two contexts (ADR-103 §2, audit S12). A page whose
    // content is missing gets the centred state, with an illustration when one
    // fits; a section inside a page gets the compact row, which never carries
    // an illustration. Callers choose the context, never a look.
    const compact = layout === 'compact'
    const media = compact ? (
        icon
    ) : illustration ? (
        <EmptyIllustration className={illustrationClassName} name={illustration} />
    ) : (
        icon
    )
    const hasMedia = media !== undefined && media !== null
    const hasDescription = description !== undefined && description !== null

    return (
        <Empty
            {...props}
            aria-live="polite"
            className={cn(
                compact
                    ? 'min-h-0 flex-none flex-row items-center justify-start gap-3 rounded-lg bg-surface-inset/45 px-4 py-3 text-left shadow-surface'
                    : 'min-h-0 flex-none gap-4 rounded-none border-0 bg-transparent px-6 py-14 shadow-none',
                className
            )}
            data-empty-state={illustration ?? 'generic'}
            data-empty-layout={layout}
            role="status">
            {hasMedia ? (
                <EmptyMedia
                    className={cn(
                        'mb-0',
                        compact || !illustration ? 'size-8 bg-surface-control' : undefined
                    )}
                    variant={!compact && illustration ? 'default' : 'icon'}>
                    {media}
                </EmptyMedia>
            ) : null}
            <EmptyHeader className={cn(compact ? 'items-start gap-0.5' : 'gap-1.5')}>
                <EmptyTitle className={cn(compact ? 'text-sm' : 'text-base')}>{title}</EmptyTitle>
                {hasDescription ? (
                    <EmptyDescription className={cn(compact ? 'text-left text-xs/5' : 'max-w-sm')}>
                        {description}
                    </EmptyDescription>
                ) : null}
            </EmptyHeader>
            {action ? (
                <EmptyContent
                    className={cn('w-auto max-w-none', compact && 'ml-auto shrink-0 items-end')}>
                    {action}
                </EmptyContent>
            ) : null}
        </Empty>
    )
}

export function EmptyIllustration({
    className,
    name,
}: {
    readonly className?: string
    readonly name: EmptyStateIllustration
}) {
    const sources = emptyIllustrations[name]

    return (
        <span
            aria-hidden="true"
            className={cn('block w-32 shrink-0 sm:w-36', className)}
            data-empty-illustration={name}
            data-publication-empty-illustration="true">
            <img
                alt=""
                className="block h-auto w-full dark:hidden"
                decoding="async"
                height="136"
                src={sources.light}
                width="171"
            />
            <img
                alt=""
                className="hidden h-auto w-full dark:block"
                decoding="async"
                height="136"
                src={sources.dark}
                width="171"
            />
        </span>
    )
}
