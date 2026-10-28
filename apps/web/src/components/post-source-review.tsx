import { Button } from '@postdot/ui/components/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@postdot/ui/components/dialog'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { SourceComparisonContent } from '@/components/publication-editor-sidebar'
import { api, formatApiError, type PublicationEditorState, type MediaReference } from '@/lib/api'
import { loadPostPublications } from '@/lib/post-publications'
import { getTargetPreviewBody, getTargetPreviewTitle } from '@/lib/publication-preview'
import { getTargetMediaSelections } from '@/lib/target-media'
import * as m from '@/paraglide/messages.js'

export function PostSourceReview({
    projectId,
    postId,
    disabled,
    accessEpoch,
    onApplied,
}: {
    projectId: string
    postId: string
    disabled: boolean
    accessEpoch?: number
    onApplied: (editor: PublicationEditorState) => void
}) {
    const [open, setOpen] = useState(false)
    return (
        <>
            <Button variant="outline" disabled={disabled} onClick={() => setOpen(true)}>
                {m.source_review_title()}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-h-[calc(100dvh-3rem)] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{m.source_review_title()}</DialogTitle>
                    </DialogHeader>
                    {open ? (
                        <Review
                            projectId={projectId}
                            postId={postId}
                            accessEpoch={accessEpoch}
                            disabled={disabled}
                            onApplied={onApplied}
                        />
                    ) : null}
                </DialogContent>
            </Dialog>
        </>
    )
}

function Review({
    projectId,
    postId,
    disabled,
    accessEpoch,
    onApplied,
}: {
    projectId: string
    postId: string
    disabled: boolean
    accessEpoch?: number
    onApplied: (editor: PublicationEditorState) => void
}) {
    const client = useQueryClient()
    const query = useQuery({
        queryKey: ['project', projectId, 'source-review', postId],
        queryFn: async () => {
            const { post } = await api.getPost(projectId, postId)
            const ids = (await loadPostPublications(projectId, postId)).map(item => item.id)
            const entries = await Promise.all(
                ids.map(async id => (await api.getPublicationEditor(projectId, id)).editor)
            )
            const assetIds = [
                ...new Set([
                    ...post.sourceContent.media.map(item => item.assetId),
                    ...entries.flatMap(editor =>
                        getTargetMediaSelections(editor.profile.profile, editor.draft.content).map(
                            item => item.assetId
                        )
                    ),
                ]),
            ]
            const loadedMedia = await Promise.allSettled(
                assetIds.map(id => api.getMedia(projectId, id))
            )
            const media = loadedMedia.flatMap(result =>
                result.status === 'fulfilled' ? [result.value] : []
            )
            return { post, entries, media }
        },
        staleTime: 0,
        gcTime: 0,
    })
    if (query.isPending) return <p>{m.common_loading()}</p>
    if (query.isError)
        return (
            <div>
                <p role="alert">{formatApiError(query.error)}</p>
                <Button onClick={() => void query.refetch()}>{m.common_retry()}</Button>
            </div>
        )
    return (
        <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{m.source_review_description()}</p>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">
                    {m.editor_source_revision({ revision: query.data.post.sourceRevision })}
                </p>
                <Button variant="ghost" onClick={() => void query.refetch()}>
                    {m.source_review_refresh()}
                </Button>
            </div>
            <div className="divide-y divide-border/50">
                {query.data.entries.map(editor => (
                    <DestinationReview
                        key={`${editor.publication.id}:${editor.draft.revision}:${query.data.post.sourceRevision}`}
                        editor={editor}
                        source={query.data.post}
                        media={query.data.media}
                        disabled={disabled}
                        accessEpoch={accessEpoch}
                        onApplied={next => {
                            onApplied(next)
                            void client.invalidateQueries({ queryKey: ['project', projectId] })
                        }}
                    />
                ))}
            </div>
        </div>
    )
}

function DestinationReview({
    editor,
    source,
    media,
    disabled,
    accessEpoch,
    onApplied,
}: {
    editor: PublicationEditorState
    source: PublicationEditorState['post']
    media: readonly MediaReference[]
    disabled: boolean
    accessEpoch?: number
    onApplied: (editor: PublicationEditorState) => void
}) {
    const [replace, setReplace] = useState(false)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [done, setDone] = useState(false)
    const epoch = useRef(accessEpoch)
    epoch.current = accessEpoch
    const editable =
        !['ready', 'publishing', 'published', 'ambiguous', 'cancelled'].includes(
            editor.publication.state
        ) && editor.channel.state === 'active'
    const stale = editor.draft.sourceRevision !== source.sourceRevision
    async function apply() {
        if (pending || disabled || !editable || done) return
        const started = epoch.current
        setPending(true)
        setError(null)
        try {
            const result = await api.rebasePublicationDraft(
                editor.publication.projectId,
                editor.publication.id,
                editor.draft.revision,
                {
                    expectedSourceRevision: source.sourceRevision,
                    replaceContent: replace,
                }
            )
            if (started !== epoch.current) return
            setDone(true)
            onApplied(result.editor)
        } catch (caught) {
            if (started === epoch.current) setError(formatApiError(caught))
        } finally {
            setPending(false)
        }
    }
    return (
        <section className="py-4 first:pt-0" aria-label={editor.channel.name}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-medium">{editor.channel.name}</h3>
                <span className="text-xs text-muted-foreground">
                    {done
                        ? m.source_review_done()
                        : !editable
                          ? m.source_review_locked()
                          : stale
                            ? m.source_review_stale()
                            : m.source_review_current()}
                </span>
            </div>
            {editable && !done ? (
                <details className="mt-2">
                    <summary className="cursor-pointer text-sm">
                        {m.source_review_compare()}
                    </summary>
                    <div className="my-3 space-y-3 text-sm">
                        <div>
                            <p className="font-medium">{m.source_review_destination()}</p>
                            <SourceComparisonContent
                                projectId={editor.publication.projectId}
                                media={media}
                                content={{
                                    body: {
                                        text: getTargetPreviewBody(
                                            editor.profile.profile,
                                            editor.draft.content
                                        ),
                                        format: 'plain_text',
                                    },
                                    headline: getTargetPreviewTitle(
                                        editor.profile.profile,
                                        editor.draft.content
                                    ),
                                    media: getTargetMediaSelections(
                                        editor.profile.profile,
                                        editor.draft.content
                                    ),
                                }}
                            />
                        </div>
                        <div>
                            <p className="font-medium">{m.source_review_source()}</p>
                            <SourceComparisonContent
                                projectId={editor.publication.projectId}
                                media={media}
                                content={source.sourceContent}
                            />
                        </div>
                        <p className="text-muted-foreground">
                            {m.source_review_media({
                                target: String(
                                    getTargetMediaSelections(
                                        editor.profile.profile,
                                        editor.draft.content
                                    ).length
                                ),
                                source: String(source.sourceContent.media.length),
                            })}
                        </p>
                    </div>
                    <fieldset disabled={disabled || pending} className="space-y-2 text-sm">
                        <label className="flex items-start gap-2">
                            <input
                                type="radio"
                                name={editor.publication.id}
                                checked={!replace}
                                onChange={() => setReplace(false)}
                            />
                            {m.source_review_keep()}
                        </label>
                        <label className="flex items-start gap-2">
                            <input
                                type="radio"
                                name={editor.publication.id}
                                checked={replace}
                                onChange={() => setReplace(true)}
                            />
                            {m.source_review_replace()}
                        </label>
                    </fieldset>
                    {replace ? (
                        <p className="mt-2 text-sm text-muted-foreground">
                            {m.source_review_replace_warning()}
                        </p>
                    ) : null}
                    {error ? (
                        <p role="alert" className="mt-2 text-sm text-destructive">
                            {error}
                        </p>
                    ) : null}
                    <Button
                        className="mt-3"
                        disabled={disabled || pending || (!stale && !replace)}
                        onClick={() => void apply()}>
                        {pending ? m.common_loading() : m.source_review_apply()}
                    </Button>
                </details>
            ) : null}
        </section>
    )
}
