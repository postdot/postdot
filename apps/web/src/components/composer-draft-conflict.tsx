import { Button } from '@postdot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@postdot/ui/components/dialog'
import { useQueries } from '@tanstack/react-query'

import { MediaPreview, mediaStateLabel, readyRepresentation } from '@/components/media-asset-card'
import { api } from '@/lib/api'
import { formatCivilSchedule } from '@/lib/date-time'
import { useLanguage } from '@/lib/i18n'
import { projectQueryKeys } from '@/lib/project-query-keys'
import type { useProjectTagCatalog } from '@/lib/project-tags'
import type { PublicationComposerDraftContent } from '@/lib/publication-recovery'
import * as m from '@/paraglide/messages.js'

export function ComposerDraftConflict({
    projectId,
    local,
    saved,
    channels,
    tagCatalog,
    timeZone,
    busy,
    savedKnown,
    error,
    onRefresh,
    onUseSaved,
    onSaveLocal,
    onClose,
}: {
    readonly projectId: string
    readonly local: PublicationComposerDraftContent
    readonly saved: PublicationComposerDraftContent | null
    readonly channels: readonly { id: string; name: string }[]
    readonly tagCatalog: ReturnType<typeof useProjectTagCatalog>
    readonly timeZone: string
    readonly savedKnown: boolean
    readonly busy: boolean
    readonly error: string | null
    readonly onRefresh: () => void
    readonly onUseSaved: () => void
    readonly onSaveLocal: () => void
    readonly onClose: () => void
}) {
    const { locale } = useLanguage()
    const tagsById = new Map(tagCatalog.data?.tags.map(tag => [tag.id, tag]))
    const tagIds = [
        ...local.publicationTagIds,
        ...(savedKnown ? (saved?.publicationTagIds ?? []) : []),
    ]
    const mediaIds = [
        ...new Set([
            ...local.sourceMedia.map(item => item.assetId),
            ...(savedKnown ? (saved?.sourceMedia.map(item => item.assetId) ?? []) : []),
        ]),
    ]
    const mediaQueries = useQueries({
        queries: mediaIds.map(assetId => ({
            queryKey: [...projectQueryKeys.data(projectId), 'composer-conflict-media', assetId],
            queryFn: ({ signal }: { signal: AbortSignal }) =>
                api.getMedia(projectId, assetId, { signal }),
            retry: false,
            retryOnMount: false,
            refetchOnWindowFocus: false,
            staleTime: 30_000,
            gcTime: 60_000,
        })),
    })
    const mediaById = new Map(mediaIds.map((id, index) => [id, mediaQueries[index]!]))
    const loadingDetails =
        (tagIds.length > 0 && tagCatalog.isFetching) || mediaQueries.some(query => query.isFetching)
    const unavailableDetails =
        (tagIds.length > 0 &&
            (tagCatalog.isError ||
                (tagCatalog.isSuccess && tagIds.some(id => !tagsById.has(id))))) ||
        mediaQueries.some(query => query.isError)
    function download() {
        const blob = new Blob([JSON.stringify({ local, saved }, null, 2)], {
            type: 'application/json',
        })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = 'postdot-draft-versions.json'
        anchor.click()
        URL.revokeObjectURL(url)
    }
    function version(content: PublicationComposerDraftContent | null, label: string) {
        return (
            <section
                aria-label={label}
                className="min-w-0 space-y-3 rounded-md bg-surface-inset p-3">
                <h3 className="font-medium">{label}</h3>
                {content === null ? (
                    <p className="text-muted-foreground">{m.composer_conflict_removed()}</p>
                ) : (
                    <>
                        {content.postTitle ? (
                            <p className="break-words font-medium">{content.postTitle}</p>
                        ) : null}
                        <p className="whitespace-pre-wrap break-words text-sm">
                            {content.postContent}
                        </p>
                        <div className="space-y-1 text-sm">
                            <h4 className="font-medium">{m.taxonomy_tags()}</h4>
                            {content.publicationTagIds.length === 0 ? (
                                <p className="text-muted-foreground">{m.taxonomy_no_tags()}</p>
                            ) : (
                                <ul className="space-y-1">
                                    {content.publicationTagIds.map(id => {
                                        const tag = tagsById.get(id)
                                        return (
                                            <li key={id} className="break-words">
                                                {tag ? (
                                                    <>
                                                        {tag.name}
                                                        {tag.state === 'archived'
                                                            ? ` · ${m.common_archived()}`
                                                            : ''}
                                                    </>
                                                ) : (
                                                    <>
                                                        <p className="text-muted-foreground">
                                                            {tagCatalog.isPending
                                                                ? m.common_loading()
                                                                : m.composer_conflict_tag_unavailable()}
                                                        </p>
                                                        <p className="break-all text-xs text-muted-foreground">
                                                            {id}
                                                        </p>
                                                    </>
                                                )}
                                            </li>
                                        )
                                    })}
                                </ul>
                            )}
                        </div>
                        <div className="space-y-2 text-sm">
                            <h4 className="font-medium">{m.nav_media()}</h4>
                            {content.sourceMedia.length === 0 ? (
                                <p className="text-muted-foreground">{m.media_none_selected()}</p>
                            ) : (
                                <ol className="space-y-3">
                                    {content.sourceMedia.map((selection, index) => {
                                        const query = mediaById.get(selection.assetId)!
                                        const media = query.data
                                        const representation = media
                                            ? readyRepresentation(media)
                                            : undefined
                                        return (
                                            <li
                                                key={selection.assetId}
                                                data-composer-conflict-media={selection.assetId}
                                                className="flex min-w-0 items-start gap-2">
                                                <span className="text-muted-foreground">
                                                    {index + 1}.
                                                </span>
                                                {media && representation ? (
                                                    <MediaPreview
                                                        projectId={projectId}
                                                        asset={media}
                                                        representation={representation}
                                                        alt=""
                                                        className="size-12 shrink-0 rounded-md object-cover"
                                                    />
                                                ) : null}
                                                <div className="min-w-0 flex-1 space-y-1">
                                                    <p className="break-all font-medium">
                                                        {media?.asset.originalFilename ??
                                                            (query.isPending
                                                                ? m.common_loading()
                                                                : m.composer_conflict_media_unavailable())}
                                                    </p>
                                                    {media && media.asset.state !== 'ready' ? (
                                                        <p className="text-xs text-state-failed">
                                                            {mediaStateLabel(media.asset.state)}
                                                        </p>
                                                    ) : null}
                                                    {media ? (
                                                        <details className="text-xs text-muted-foreground">
                                                            <summary className="cursor-pointer">
                                                                {m.composer_conflict_reference()}
                                                            </summary>
                                                            <p className="break-all">
                                                                {selection.assetId}
                                                            </p>
                                                        </details>
                                                    ) : (
                                                        <p className="break-all text-xs text-muted-foreground">
                                                            {selection.assetId}
                                                        </p>
                                                    )}
                                                    <p className="whitespace-pre-wrap break-words text-xs">
                                                        <span className="text-muted-foreground">
                                                            {m.media_accessibility_text()}:{' '}
                                                        </span>
                                                        {selection.accessibilityText?.trim()
                                                            ? selection.accessibilityText
                                                            : m.composer_conflict_no_accessibility_text()}
                                                    </p>
                                                </div>
                                            </li>
                                        )
                                    })}
                                </ol>
                            )}
                        </div>
                        {content.publicationTargets.map(target => (
                            <div key={target.id} className="space-y-1 text-sm">
                                <h4 className="font-medium">
                                    {channels.find(channel => channel.id === target.channelId)
                                        ?.name ?? m.nav_channels()}
                                </h4>
                                {target.content ? (
                                    <p className="whitespace-pre-wrap break-words">
                                        {target.content}
                                    </p>
                                ) : null}
                                <p className="text-xs text-muted-foreground">
                                    {target.deliveryMode === 'manual'
                                        ? m.common_manual()
                                        : m.common_automatic()}{' '}
                                    ·{' '}
                                    {formatCivilSchedule(target.scheduledAt, locale) ||
                                        m.publication_unscheduled()}{' '}
                                    · {timeZone}
                                </p>
                            </div>
                        ))}
                    </>
                )}
            </section>
        )
    }
    return (
        <Dialog
            open
            onOpenChange={open => {
                if (!open && !busy) onClose()
            }}>
            <DialogContent
                className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl"
                data-composer-conflict="true"
                showCloseButton={!busy}>
                <DialogHeader>
                    <DialogTitle>{m.composer_conflict_title()}</DialogTitle>
                    <DialogDescription>{m.composer_conflict_choice()}</DialogDescription>
                </DialogHeader>
                <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                    {version(local, m.composer_conflict_local())}
                    {savedKnown ? (
                        version(saved, m.composer_conflict_saved())
                    ) : (
                        <p role="status">{m.composer_conflict_read_failed()}</p>
                    )}
                </div>
                {error ? (
                    <p role="alert" className="text-sm text-state-failed">
                        {error}
                    </p>
                ) : null}
                {tagIds.length > 0 || mediaIds.length > 0 ? (
                    <div className="space-y-2 text-sm" role="status">
                        {unavailableDetails ? (
                            <p>{m.composer_conflict_details_unavailable()}</p>
                        ) : null}
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={loadingDetails}
                            focusableWhenDisabled
                            title={loadingDetails ? m.common_loading() : undefined}
                            onClick={() => {
                                void tagCatalog.refetch()
                                for (const query of mediaQueries) void query.refetch()
                            }}>
                            {m.composer_conflict_retry_details()}
                        </Button>
                    </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                    <Button
                        disabled={busy || !savedKnown}
                        onClick={download}
                        variant="ghost"
                        size="sm">
                        {m.composer_conflict_download()}
                    </Button>
                    <Button disabled={busy} onClick={onRefresh} variant="ghost" size="sm">
                        {m.composer_conflict_refresh()}
                    </Button>
                </div>
                <DialogFooter>
                    <Button
                        disabled={
                            busy ||
                            !savedKnown ||
                            (!local.postContent.trim() &&
                                !local.postTitle.trim() &&
                                local.sourceMedia.length === 0 &&
                                local.publicationTargets.every(target => !target.content.trim()))
                        }
                        onClick={onSaveLocal}
                        variant="destructive">
                        {m.composer_conflict_replace()}
                    </Button>
                    <Button disabled={busy || !savedKnown} onClick={onUseSaved}>
                        {saved === null
                            ? m.composer_conflict_start_new()
                            : m.composer_conflict_use_saved()}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
