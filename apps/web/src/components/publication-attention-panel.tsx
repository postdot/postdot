import { Button } from '@herald/ui/components/button'
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from '@herald/ui/components/empty'
import { AltArrowRightIcon } from '@solar-icons/react/bold/alt-arrow-right'
import { UserCheckIcon } from '@solar-icons/react/bold/user-check'

import { formatSchedule, PublicationStatus } from '@/components/dashboard-publication-parts'
import type { DuePublication } from '@/lib/api'

export function PublicationAttentionPanel({
    duePublications,
    onPublish,
    pending,
    timeZone,
}: {
    readonly duePublications: readonly DuePublication[]
    readonly onPublish: (publicationId: string) => Promise<void>
    readonly pending: boolean
    readonly timeZone: string
}) {
    return (
        <aside className="min-w-0 rounded-lg bg-muted p-5 shadow-surface xl:sticky xl:top-6 xl:p-6">
            <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-heading text-xl font-[580] leading-[1.03] tracking-[-0.04em]">
                    Needs attention
                </h2>
                <span className="text-sm font-medium tabular-nums text-muted-foreground">
                    {duePublications.length}
                </span>
            </div>
            {duePublications.length > 0 ? (
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Manual destinations stay visible until a person records the external result.
                </p>
            ) : null}

            {duePublications.length === 0 ? (
                <Empty className="mt-4 min-h-28 bg-background/80 px-4 py-5">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <UserCheckIcon aria-hidden="true" />
                        </EmptyMedia>
                        <EmptyTitle>Nothing is due</EmptyTitle>
                        <EmptyDescription>
                            Manual destinations will appear here when they need a person.
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : (
                <div className="mt-4 divide-y divide-border/70">
                    {duePublications.map(publication => (
                        <article key={publication.id} className="py-5 first:pt-1 last:pb-1">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium">
                                        {publication.channelName}
                                    </p>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        {formatSchedule(publication.scheduledAt, timeZone)}
                                    </p>
                                </div>
                                <PublicationStatus state={publication.state} due />
                            </div>
                            <h3 className="mt-4 text-sm font-medium leading-5">
                                {publication.postTitle ?? 'Untitled post'}
                            </h3>
                            <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                                {targetPreview(publication.targetContent)}
                            </p>
                            <Button
                                className="mt-4 w-full"
                                size="sm"
                                variant="secondary"
                                disabled={pending}
                                onClick={() => void onPublish(publication.id)}>
                                Record as published
                                <AltArrowRightIcon aria-hidden="true" />
                            </Button>
                        </article>
                    ))}
                </div>
            )}
        </aside>
    )
}

function targetPreview(targetContent: Record<string, unknown>) {
    const candidates = [targetContent.body, targetContent.commentary, targetContent.text]
    const text = candidates.find(value => typeof value === 'string')
    return typeof text === 'string' ? text : 'Structured target content'
}
