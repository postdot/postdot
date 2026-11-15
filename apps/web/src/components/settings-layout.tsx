import { cn } from '@postdot/ui/lib/utils'
import { AltArrowRightIcon } from '@solar-icons/react/linear/alt-arrow-right'
import { SquareArrowRightUpIcon } from '@solar-icons/react/linear/square-arrow-right-up'
import type { ReactNode } from 'react'

import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { PageColumn } from '@/components/page-column'

/**
 * Settings anatomy (owner review, 2026-11-15; see DESIGN.md "Settings pages").
 * A page is a stack of sections; a section is a short heading, one sentence of
 * consequence, and a card of rows. A row is an icon, a title, a short
 * description and, on the right, its control — or a chevron when it opens
 * somewhere else. Pages do not compose their own variants of these.
 */
export function SettingsPage({
    action,
    children,
    title,
}: {
    readonly action?: ReactNode
    readonly children: ReactNode
    readonly title: string
}) {
    return (
        <main className="min-w-0 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
            <DashboardPageHeader action={action} column="reading" title={title} />
            <PageColumn className="space-y-10" variant="reading">
                {children}
            </PageColumn>
        </main>
    )
}

export function SettingsSection({
    action,
    children,
    description,
    id,
    title,
}: {
    readonly action?: ReactNode
    readonly children: ReactNode
    readonly description?: ReactNode
    readonly id: string
    readonly title: string
}) {
    return (
        <section aria-labelledby={id} className="space-y-3" data-settings-section="true">
            <div className="flex items-end justify-between gap-4">
                <div className="min-w-0">
                    <h2 id={id} className="text-sm font-semibold">
                        {title}
                    </h2>
                    {description ? (
                        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                    ) : null}
                </div>
                {action}
            </div>
            {children}
        </section>
    )
}

export function SettingsCard({
    children,
    className,
}: {
    readonly children: ReactNode
    readonly className?: string
}) {
    return (
        <div
            className={cn(
                'divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface-raised',
                className
            )}
            data-settings-card="true">
            {children}
        </div>
    )
}

interface SettingsRowContent {
    readonly description?: ReactNode
    readonly icon?: ReactNode
    /** An identity (avatar, brand mark) shown at its own size instead of an icon. */
    readonly media?: ReactNode
    readonly title: ReactNode
}

function RowText({
    description,
    icon,
    media,
    title,
    htmlFor,
}: SettingsRowContent & { readonly htmlFor?: string }) {
    return (
        <span className="flex min-w-0 flex-1 items-center gap-3">
            {media ? <span className="shrink-0">{media}</span> : null}
            {icon && !media ? (
                <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-inset text-muted-foreground [&_svg]:size-[18px]">
                    {icon}
                </span>
            ) : null}
            <span className="min-w-0">
                {htmlFor ? (
                    <label className="block text-sm font-medium" htmlFor={htmlFor}>
                        {title}
                    </label>
                ) : (
                    <span className="block text-sm font-medium">{title}</span>
                )}
                {description ? (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                        {description}
                    </span>
                ) : null}
            </span>
        </span>
    )
}

/** A row whose control acts in place: a switch, a select, a button. */
export function SettingsRow({
    control,
    htmlFor,
    ...content
}: SettingsRowContent & { readonly control?: ReactNode; readonly htmlFor?: string }) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
            <RowText {...content} htmlFor={htmlFor} />
            {control ? <div className="shrink-0">{control}</div> : null}
        </div>
    )
}

/** A row that opens somewhere else; external destinations say so with their icon. */
export function SettingsLinkRow({
    external = false,
    href,
    ...content
}: SettingsRowContent & { readonly external?: boolean; readonly href: string }) {
    return (
        <a
            className="flex items-center justify-between gap-6 px-4 py-3 outline-none transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover"
            href={href}
            {...(external ? { rel: 'noreferrer', target: '_blank' } : {})}>
            <RowText {...content} />
            {external ? (
                <SquareArrowRightUpIcon
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground"
                />
            ) : (
                <AltArrowRightIcon
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground"
                />
            )}
        </a>
    )
}
