import { Button } from '@postdot/ui/components/button'
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@postdot/ui/components/dialog'
import { EyeIcon } from '@solar-icons/react/linear/eye'
import { PenIcon } from '@solar-icons/react/linear/pen'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { PublicationStatus, formatSchedule } from '@/components/dashboard-publication-parts'
import { ChannelAvatar } from '@/components/identity-visuals'
import { api, type Channel, type PublicationSummary } from '@/lib/api'
import { projectQueryKeys } from '@/lib/project-realtime'
import { publicationIdentityLabel } from '@/lib/publication-identity'
import { canEditPublication } from '@/lib/publication-lifecycle'
import * as m from '@/paraglide/messages.js'

import { PublicationCadenceStatus } from './publication-cadence-status'

/**
 * C8: a compact card for one calendar entry — the post, each of its channels with time and
 * state, an excerpt, then the action. It dims the page without blurring it (ADR-103 §2).
 */
export function PublicationCalendarPreview({
    channelsById,
    duePublicationIds,
    group,
    locale,
    onOpenChange,
    onOpenPublication,
    projectId,
    readOnly = false,
    timeZone,
}: {
    readonly channelsById: ReadonlyMap<string, Pick<Channel, 'id' | 'name' | 'profileId'>>
    readonly duePublicationIds: ReadonlySet<string>
    /** The publications of the entry, first one leading; empty when closed. */
    readonly group: readonly PublicationSummary[]
    readonly locale: string
    readonly onOpenChange: (publicationId: string | null) => void
    readonly onOpenPublication: (publicationId: string) => void
    readonly projectId: string
    /** Viewer mode: the action opens a read-only page, so it is named as consultation. */
    readonly readOnly?: boolean
    readonly timeZone: string
}) {
    const publication = group[0] ?? null
    const publicationId = publication?.id ?? null
    const previewQuery = useQuery({
        enabled: publicationId !== null,
        queryKey: projectQueryKeys.publicationEditor(projectId, publicationId ?? ''),
        queryFn: () => {
            if (publicationId === null) {
                throw new Error('A publication is required to load its preview')
            }
            return api.getPublicationEditor(projectId, publicationId)
        },
        staleTime: 30_000,
    })
    const editor = previewQuery.data?.editor
    const copy = useMemo(() => getPreviewCopy(locale), [locale])
    const title = publication === null ? copy.untitled : publicationIdentityLabel(publication)
    // The lifecycle decides whether editing is possible at all; the role decides
    // whether this operator may edit. A viewer is offered consultation even for
    // an editable state, because the destination page is read-only for them.
    const editable = publication !== null && canEditPublication(publication.state) && !readOnly

    return (
        <Dialog
            open={publication !== null}
            onOpenChange={open => {
                if (!open) onOpenChange(null)
            }}>
            <DialogContent
                aria-describedby={undefined}
                className="max-h-[min(40rem,calc(100dvh-2rem))] grid-rows-[auto_minmax(0,1fr)_auto] gap-4 sm:max-w-md"
                data-calendar-preview="true"
                showCloseButton={false}>
                <DialogHeader>
                    <DialogTitle className="break-words text-lg leading-snug">{title}</DialogTitle>
                </DialogHeader>

                <div className="min-h-0 overflow-y-auto">
                    {publication === null ? (
                        <p className="text-sm text-muted-foreground">{copy.unavailable}</p>
                    ) : (
                        <>
                            <ul
                                aria-label={copy.channel}
                                className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                                {group.map(item => (
                                    <li
                                        className="flex min-w-0 items-center gap-2.5 px-3 py-2 text-sm"
                                        data-calendar-preview-channel={item.channelId}
                                        key={item.id}>
                                        <ChannelAvatar
                                            channel={
                                                channelsById.get(item.channelId) ?? {
                                                    id: item.channelId,
                                                    name: item.channelName,
                                                    profileId: '',
                                                }
                                            }
                                            size="sm"
                                        />
                                        <span className="min-w-0 flex-1 truncate font-medium">
                                            {item.channelName}
                                        </span>
                                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                            {formatSchedule(item.scheduledAt, timeZone, locale)}
                                        </span>
                                        <PublicationStatus
                                            due={duePublicationIds.has(item.id)}
                                            state={item.state}
                                        />
                                    </li>
                                ))}
                            </ul>

                            {['scheduled', 'ready'].includes(publication.state) ? (
                                <PublicationCadenceStatus
                                    projectId={projectId}
                                    publicationId={publication.id}
                                    locale={locale}
                                    timeZone={timeZone}
                                    readOnly={readOnly}
                                />
                            ) : null}
                            <section aria-label={copy.content} className="mt-4">
                                {previewQuery.isPending ? (
                                    <div aria-busy="true" className="text-sm text-muted-foreground">
                                        {copy.loading}
                                    </div>
                                ) : previewQuery.isError ? (
                                    <div className="rounded-md bg-state-attention/10 p-3 text-sm text-muted-foreground">
                                        {copy.loadError}
                                    </div>
                                ) : (
                                    <PublicationContentPreview copy={copy} editor={editor} />
                                )}
                            </section>
                        </>
                    )}
                </div>

                <DialogFooter className="border-0">
                    <DialogClose render={<Button size="sm" variant="ghost" />}>
                        {copy.close}
                    </DialogClose>
                    {publication === null ? null : (
                        <DialogClose
                            render={
                                <Button
                                    onClick={() => onOpenPublication(publication.id)}
                                    size="sm"
                                />
                            }>
                            {editable ? (
                                <PenIcon aria-hidden="true" />
                            ) : (
                                <EyeIcon aria-hidden="true" />
                            )}
                            {editable ? copy.edit : copy.view}
                        </DialogClose>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function PublicationContentPreview({
    copy,
    editor,
}: {
    readonly copy: PreviewCopy
    readonly editor: Awaited<ReturnType<typeof api.getPublicationEditor>>['editor'] | undefined
}) {
    const sourceContent = editor?.post.sourceContent
    const body = sourceContent?.body?.text
    const headline = sourceContent?.headline

    if (body === undefined && headline === undefined) {
        return (
            <div className="text-sm text-muted-foreground">
                {sourceContent?.media.length ? copy.mediaOnly : copy.noContent}
            </div>
        )
    }

    return (
        <div>
            {headline ? <p className="font-medium">{headline}</p> : null}
            {body ? (
                <p className="line-clamp-6 whitespace-pre-wrap break-words text-sm leading-6 text-foreground/85">
                    {body}
                </p>
            ) : null}
        </div>
    )
}

interface PreviewCopy {
    readonly channel: string
    readonly close: string
    readonly content: string
    readonly loadError: string
    readonly loading: string
    readonly mediaOnly: string
    readonly noContent: string
    readonly edit: string
    readonly view: string
    readonly unavailable: string
    readonly untitled: string
}

function getPreviewCopy(locale: string): PreviewCopy {
    const messageLocale =
        locale === 'fr' || locale === 'es' || locale === 'de' ? locale : ('en' as const)
    const messageOptions = { locale: messageLocale } as const
    return {
        channel: m.calendar_preview_channel({}, messageOptions),
        close: m.common_close({}, messageOptions),
        content: m.calendar_preview_content({}, messageOptions),
        loadError: m.calendar_preview_load_error({}, messageOptions),
        loading: m.calendar_preview_loading({}, messageOptions),
        mediaOnly: m.calendar_preview_media_only({}, messageOptions),
        noContent: m.calendar_preview_no_content({}, messageOptions),
        edit: m.calendar_preview_edit({}, messageOptions),
        view: m.calendar_preview_view({}, messageOptions),
        unavailable: m.calendar_preview_unavailable({}, messageOptions),
        untitled: m.calendar_preview_untitled({}, messageOptions),
    }
}
