import { Alert, AlertDescription } from '@postdot/ui/components/alert'
import { Button } from '@postdot/ui/components/button'
import { Checkbox } from '@postdot/ui/components/checkbox'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@postdot/ui/components/dialog'
import { Skeleton } from '@postdot/ui/components/skeleton'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'

import { ChannelAvatar } from '@/components/identity-visuals'
import { SourceComparisonContent } from '@/components/publication-editor-sidebar'
import {
    api,
    ApiError,
    formatApiError,
    type PublicationEditorState,
    type MediaReference,
} from '@/lib/api'
import { loadPostPublications } from '@/lib/post-publications'
import { channelVersionContent, sourceContentDifferences } from '@/lib/post-source-review'
import { canEditPublication } from '@/lib/publication-lifecycle'
import * as m from '@/paraglide/messages.js'

export function PostSourceReview({
    projectId,
    postId,
    staleCount,
    disabled,
    accessEpoch,
    onApplied,
}: {
    projectId: string
    postId: string
    staleCount: number
    disabled: boolean
    accessEpoch?: number
    onApplied: (editor: PublicationEditorState) => void
}) {
    const [open, setOpen] = useState(false)
    const [pending, setPending] = useState(false)
    return (
        <>
            {staleCount > 0 ? (
                <Alert
                    role="status"
                    className="flex flex-wrap items-center justify-between gap-3 bg-surface-raised">
                    <AlertDescription className="text-foreground">
                        {m.source_review_notice({ count: staleCount })}
                    </AlertDescription>
                    <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={disabled}
                        onClick={() => setOpen(true)}>
                        {m.source_review_action()}
                    </Button>
                </Alert>
            ) : null}
            <Dialog
                open={open}
                onOpenChange={value => {
                    if (!pending) setOpen(value)
                }}>
                <DialogContent
                    showCloseButton={!pending}
                    className="flex max-h-[calc(100dvh-3rem)] flex-col overflow-hidden sm:max-w-2xl">
                    <DialogHeader className="shrink-0 pr-5">
                        <DialogTitle>{m.source_review_title()}</DialogTitle>
                        <DialogDescription>{m.source_review_description()}</DialogDescription>
                    </DialogHeader>
                    {open ? (
                        <Review
                            projectId={projectId}
                            postId={postId}
                            accessEpoch={accessEpoch}
                            disabled={disabled}
                            onApplied={onApplied}
                            onPendingChange={setPending}
                            onClose={() => setOpen(false)}
                        />
                    ) : null}
                </DialogContent>
            </Dialog>
        </>
    )
}

function lockedReason(editor: PublicationEditorState): string | null {
    if (editor.channel.state !== 'active') return m.source_review_locked_channel()
    if (editor.publication.state === 'published') return m.source_review_locked_published()
    if (editor.publication.state === 'cancelled') return m.source_review_locked_cancelled()
    if (!canEditPublication(editor.publication.state)) return m.source_review_locked()
    return null
}

function Review({
    projectId,
    postId,
    disabled,
    accessEpoch,
    onApplied,
    onPendingChange,
    onClose,
}: {
    projectId: string
    postId: string
    disabled: boolean
    accessEpoch?: number
    onApplied: (editor: PublicationEditorState) => void
    onPendingChange: (pending: boolean) => void
    onClose: () => void
}) {
    const client = useQueryClient()
    const reviewId = useId()
    const [selected, setSelected] = useState<ReadonlySet<string> | null>(null)
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [pending, setPending] = useState(false)
    const live = useRef({ accessEpoch, disabled, mounted: true })
    live.current = { accessEpoch, disabled, mounted: true }
    const applying = useRef(false)
    useEffect(() => {
        live.current.mounted = true
        return () => {
            live.current.mounted = false
        }
    }, [])
    const query = useQuery({
        queryKey: ['project', projectId, 'source-review', postId, reviewId],
        queryFn: async () => {
            const [{ post }, publications] = await Promise.all([
                api.getPost(projectId, postId),
                loadPostPublications(projectId, postId),
            ])
            const entries = await Promise.all(
                publications.map(
                    async item => (await api.getPublicationEditor(projectId, item.id)).editor
                )
            )
            const assetIds = [
                ...new Set([
                    ...post.sourceContent.media.map(item => item.assetId),
                    ...entries.flatMap(editor =>
                        channelVersionContent(editor).media.map(item => item.assetId)
                    ),
                ]),
            ]
            const loadedMedia = await Promise.allSettled(
                assetIds.map(id => api.getMedia(projectId, id))
            )
            const media = loadedMedia.flatMap(result =>
                result.status === 'fulfilled' ? [result.value] : []
            )
            entries.sort((left, right) => left.channel.name.localeCompare(right.channel.name))
            return { post, entries, media }
        },
        // Keep the reviewed snapshot until an explicit reload after a failed update.
        // Realtime invalidation must not silently change what the checkboxes approve.
        staleTime: 'static',
        gcTime: 0,
        retry: false,
        refetchOnWindowFocus: false,
    })
    const stale =
        query.data?.entries.filter(
            editor =>
                lockedReason(editor) === null &&
                editor.draft.sourceRevision < query.data.post.sourceRevision
        ) ?? []
    const checked = stale.filter(editor => selected === null || selected.has(editor.publication.id))

    async function apply() {
        if (
            applying.current ||
            live.current.disabled ||
            checked.length === 0 ||
            !query.data ||
            query.isFetching
        )
            return
        applying.current = true
        setPending(true)
        onPendingChange(true)
        const started = live.current.accessEpoch
        const sourceRevision = query.data.post.sourceRevision
        const ids = new Set(checked.map(editor => editor.publication.id))
        setSelected(ids)
        setErrors({})
        let failed = false
        let conflict = false
        const stillAllowed = () =>
            live.current.mounted && !live.current.disabled && started === live.current.accessEpoch
        try {
            for (const editor of checked) {
                if (!stillAllowed()) return
                try {
                    const result = await api.rebasePublicationDraft(
                        projectId,
                        editor.publication.id,
                        editor.draft.revision,
                        {
                            expectedSourceRevision: sourceRevision,
                            replaceContent: true,
                        }
                    )
                    if (!stillAllowed()) return
                    ids.delete(editor.publication.id)
                    setSelected(new Set(ids))
                    onApplied(result.editor)
                } catch (caught) {
                    if (!stillAllowed()) return
                    failed = true
                    setErrors(current => ({
                        ...current,
                        [editor.publication.id]: formatApiError(caught),
                    }))
                    if (
                        caught instanceof ApiError &&
                        (caught.status === 409 || caught.status === 403 || caught.status === 404)
                    ) {
                        conflict = true
                        // A changed comparison needs a fresh, explicit choice before retrying.
                        setSelected(new Set())
                        break
                    }
                }
            }
            if (!stillAllowed()) return
            if (!failed) onClose()
            if (conflict || failed) await query.refetch()
        } finally {
            applying.current = false
            onPendingChange(false)
            if (live.current.mounted) setPending(false)
            void client.invalidateQueries({ queryKey: ['project', projectId] })
        }
    }

    const currentNames =
        query.data?.entries
            .filter(
                editor =>
                    lockedReason(editor) === null &&
                    editor.draft.sourceRevision === query.data.post.sourceRevision &&
                    !errors[editor.publication.id]
            )
            .map(editor => editor.channel.name) ?? []
    return (
        <>
            <div className="min-h-0 overflow-y-auto" aria-busy={query.isPending || pending}>
                {query.isPending ? (
                    <div className="space-y-4" role="status" aria-label={m.common_loading()}>
                        {[0, 1, 2].map(index => (
                            <div key={index} className="flex items-center gap-3 py-3">
                                <Skeleton className="size-4 rounded-sm" />
                                <Skeleton className="size-9 rounded-full" />
                                <div className="flex-1 space-y-2">
                                    <Skeleton className="h-4 w-2/3" />
                                    <Skeleton className="h-3 w-1/2" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : query.isError ? (
                    <Alert variant="destructive">
                        <AlertDescription>{formatApiError(query.error)}</AlertDescription>
                        <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>
                            {m.common_retry()}
                        </Button>
                    </Alert>
                ) : query.data ? (
                    <div className="divide-y divide-border/50">
                        {query.data.entries
                            .filter(
                                editor =>
                                    lockedReason(editor) !== null ||
                                    editor.draft.sourceRevision < query.data.post.sourceRevision ||
                                    errors[editor.publication.id]
                            )
                            .map(editor => {
                                const reason =
                                    lockedReason(editor) ??
                                    (editor.draft.sourceRevision === query.data.post.sourceRevision
                                        ? m.source_review_current({ names: editor.channel.name })
                                        : null)
                                return (
                                    <DestinationReview
                                        key={editor.publication.id}
                                        editor={editor}
                                        source={query.data.post}
                                        media={query.data.media}
                                        reason={reason}
                                        checked={
                                            selected === null || selected.has(editor.publication.id)
                                        }
                                        disabled={disabled || pending || query.isFetching}
                                        error={errors[editor.publication.id]}
                                        onCheckedChange={value => {
                                            const next = new Set(
                                                selected ?? stale.map(item => item.publication.id)
                                            )
                                            if (value) next.add(editor.publication.id)
                                            else next.delete(editor.publication.id)
                                            setSelected(next)
                                        }}
                                    />
                                )
                            })}
                        {currentNames.length > 0 ? (
                            <p className="py-4 text-sm text-muted-foreground">
                                {m.source_review_current({ names: currentNames.join(', ') })}
                            </p>
                        ) : null}
                    </div>
                ) : null}
            </div>
            <DialogFooter className="shrink-0">
                <Button variant="secondary" disabled={pending} onClick={onClose}>
                    {m.common_cancel()}
                </Button>
                <Button
                    disabled={
                        disabled ||
                        pending ||
                        query.isFetching ||
                        query.isError ||
                        checked.length === 0
                    }
                    onClick={() => void apply()}>
                    {m.source_review_apply({ count: checked.length })}
                </Button>
            </DialogFooter>
        </>
    )
}

function DestinationReview({
    editor,
    source,
    media,
    reason,
    checked,
    disabled,
    error,
    onCheckedChange,
}: {
    editor: PublicationEditorState
    source: PublicationEditorState['post']
    media: readonly MediaReference[]
    reason: string | null
    checked: boolean
    disabled: boolean
    error?: string
    onCheckedChange: (checked: boolean) => void
}) {
    const [comparisonOpen, setComparisonOpen] = useState(false)
    const comparisonId = useId()
    const current = channelVersionContent(editor)
    const differs = sourceContentDifferences(current, source.sourceContent)
    const summaries = [
        m.source_review_difference_none,
        m.source_review_difference_text,
        m.source_review_difference_title,
        m.source_review_difference_text_title,
        m.source_review_difference_media,
        m.source_review_difference_text_media,
        m.source_review_difference_title_media,
        m.source_review_difference_all,
    ]
    const summary =
        summaries[Number(differs.text) + Number(differs.title) * 2 + Number(differs.media) * 4]!()
    return (
        <section className="py-4 first:pt-0" aria-label={editor.channel.name}>
            <div className="flex items-start gap-3">
                {reason === null ? (
                    <Checkbox
                        className="mt-2"
                        aria-label={editor.channel.name}
                        checked={checked}
                        disabled={disabled}
                        onCheckedChange={onCheckedChange}
                    />
                ) : null}
                <ChannelAvatar channel={editor.channel} size="sm" />
                <div className="min-w-0 flex-1">
                    <h3
                        className={
                            reason
                                ? 'break-words font-medium text-muted-foreground'
                                : 'break-words font-medium'
                        }>
                        {editor.channel.name}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">{reason ?? summary}</p>
                </div>
                {reason === null ? (
                    <Button
                        size="sm"
                        variant="ghost"
                        className="shrink-0 text-muted-foreground"
                        aria-expanded={comparisonOpen}
                        aria-controls={comparisonId}
                        onClick={() => setComparisonOpen(value => !value)}>
                        {m.source_review_compare()}
                    </Button>
                ) : null}
            </div>
            {error ? (
                <p role="alert" className="mt-2 text-sm text-destructive">
                    {error}
                </p>
            ) : null}
            {reason === null ? (
                <div id={comparisonId} hidden={!comparisonOpen}>
                    <div className="mt-3 grid min-w-0 grid-cols-2 gap-3 text-sm">
                        <div className="min-w-0">
                            <p className="font-medium">{m.source_review_destination()}</p>
                            <SourceComparisonContent
                                projectId={editor.publication.projectId}
                                media={media}
                                content={current}
                                compareWith={source.sourceContent}
                            />
                        </div>
                        <div className="min-w-0">
                            <p className="font-medium">{m.source_review_source()}</p>
                            <SourceComparisonContent
                                projectId={editor.publication.projectId}
                                media={media}
                                content={source.sourceContent}
                                compareWith={current}
                            />
                        </div>
                    </div>
                </div>
            ) : null}
        </section>
    )
}
