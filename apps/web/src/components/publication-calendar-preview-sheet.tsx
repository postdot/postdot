import { Button } from '@postbot/ui/components/button'
import {
    Sheet,
    SheetClose,
    SheetContent,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from '@postbot/ui/components/sheet'
import { CalendarMinimalisticIcon } from '@solar-icons/react/linear/calendar-minimalistic'
import { EyeIcon } from '@solar-icons/react/linear/eye'
import { LinkIcon } from '@solar-icons/react/linear/link'
import { PenIcon } from '@solar-icons/react/linear/pen'
import { useQuery } from '@tanstack/react-query'
import { useMemo, type ReactNode } from 'react'

import { PublicationStatus, formatSchedule } from '@/components/dashboard-publication-parts'
import { api, type PublicationSummary } from '@/lib/api'
import { projectQueryKeys } from '@/lib/project-realtime'
import { publicationIdentityLabel } from '@/lib/publication-identity'
import { canEditPublication } from '@/lib/publication-lifecycle'
import * as m from '@/paraglide/messages.js'

export function PublicationCalendarPreviewSheet({
    locale,
    onOpenChange,
    onOpenPublication,
    projectId,
    publicationId,
    publications,
    readOnly = false,
    timeZone,
}: {
    readonly locale: string
    readonly onOpenChange: (publicationId: string | null) => void
    readonly onOpenPublication: (publicationId: string) => void
    readonly projectId: string
    readonly publicationId: string | null
    readonly publications: readonly PublicationSummary[]
    /** Viewer mode: the action opens a read-only page, so it is named as consultation. */
    readonly readOnly?: boolean
    readonly timeZone: string
}) {
    const publication = useMemo(
        () => publications.find(item => item.id === publicationId) ?? null,
        [publicationId, publications]
    )
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
    const copy = getPreviewCopy(locale)
    const title = publication === null ? copy.untitled : publicationIdentityLabel(publication)
    // The lifecycle decides whether editing is possible at all; the role decides
    // whether this operator may edit. A viewer is offered consultation even for
    // an editable state, because the destination page is read-only for them.
    const editable = publication !== null && canEditPublication(publication.state) && !readOnly

    return (
        <Sheet
            open={publicationId !== null}
            onOpenChange={open => {
                if (!open) onOpenChange(null)
            }}>
            <SheetContent
                aria-describedby={undefined}
                className="w-[min(32rem,calc(100vw-1rem))] gap-0 bg-surface-raised p-0 sm:max-w-lg"
                closeLabel={m.common_close({}, { locale: locale === 'fr' ? 'fr' : 'en' })}
                side="right">
                <SheetHeader className="px-5 py-5 sm:px-6">
                    <SheetTitle className="pr-8 break-words text-xl leading-tight">
                        {title}
                    </SheetTitle>
                </SheetHeader>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
                    {publication === null ? (
                        <p className="text-sm text-muted-foreground">{copy.unavailable}</p>
                    ) : (
                        <>
                            <div className="grid gap-2 rounded-md bg-surface-field p-3 shadow-field">
                                <PreviewMetaRow
                                    icon={<LinkIcon aria-hidden="true" />}
                                    label={copy.channel}
                                    value={publication.channelName}
                                />
                                <PreviewMetaRow
                                    icon={<CalendarMinimalisticIcon aria-hidden="true" />}
                                    label={copy.schedule}
                                    value={formatSchedule(
                                        publication.scheduledAt,
                                        timeZone,
                                        locale
                                    )}
                                />
                                <div className="flex min-w-0 items-center justify-between gap-2 text-sm">
                                    <span className="text-muted-foreground">{copy.status}</span>
                                    <PublicationStatus state={publication.state} />
                                </div>
                            </div>

                            <section aria-label={copy.content} className="mt-6">
                                {previewQuery.isPending ? (
                                    <div
                                        aria-busy="true"
                                        className="rounded-md bg-surface-field p-4 text-sm text-muted-foreground shadow-field">
                                        {copy.loading}
                                    </div>
                                ) : previewQuery.isError ? (
                                    <div className="rounded-md bg-state-attention/10 p-4 text-sm text-muted-foreground shadow-field">
                                        {copy.loadError}
                                    </div>
                                ) : (
                                    <PublicationContentPreview copy={copy} editor={editor} />
                                )}
                            </section>
                        </>
                    )}
                </div>

                <SheetFooter className="flex-row justify-end gap-3 border-0 px-5 py-4 sm:px-6">
                    {publication === null ? null : (
                        <SheetClose
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
                        </SheetClose>
                    )}
                </SheetFooter>
            </SheetContent>
        </Sheet>
    )
}

function PreviewMetaRow({
    icon,
    label,
    value,
}: {
    readonly icon: ReactNode
    readonly label: string
    readonly value: string
}) {
    return (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4">
                {icon}
            </span>
            <span className="shrink-0 text-muted-foreground">{label}</span>
            <span className="min-w-0 break-words font-medium">{value}</span>
        </div>
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
            <div className="mt-2 rounded-md bg-surface-field p-4 text-sm text-muted-foreground shadow-field">
                {sourceContent?.media.length ? copy.mediaOnly : copy.noContent}
            </div>
        )
    }

    return (
        <div className="mt-2 rounded-md bg-surface-field p-4 shadow-field">
            {headline ? <p className="font-medium">{headline}</p> : null}
            {body ? (
                <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground/85">
                    {body}
                </p>
            ) : null}
        </div>
    )
}

interface PreviewCopy {
    readonly channel: string
    readonly content: string
    readonly loadError: string
    readonly loading: string
    readonly mediaOnly: string
    readonly noContent: string
    readonly edit: string
    readonly view: string
    readonly schedule: string
    readonly status: string
    readonly unavailable: string
    readonly untitled: string
}

function getPreviewCopy(locale: string): PreviewCopy {
    const messageLocale = locale === 'fr' ? 'fr' : 'en'
    const messageOptions = { locale: messageLocale } as const
    return {
        channel: m.calendar_preview_channel({}, messageOptions),
        content: m.calendar_preview_content({}, messageOptions),
        loadError: m.calendar_preview_load_error({}, messageOptions),
        loading: m.calendar_preview_loading({}, messageOptions),
        mediaOnly: m.calendar_preview_media_only({}, messageOptions),
        noContent: m.calendar_preview_no_content({}, messageOptions),
        edit: m.calendar_preview_edit({}, messageOptions),
        view: m.calendar_preview_view({}, messageOptions),
        schedule: m.calendar_preview_schedule({}, messageOptions),
        status: m.calendar_preview_status({}, messageOptions),
        unavailable: m.calendar_preview_unavailable({}, messageOptions),
        untitled: m.calendar_preview_untitled({}, messageOptions),
    }
}
