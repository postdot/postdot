import { Button } from '@herald/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@herald/ui/components/dialog'
import { useBlocker } from '@tanstack/react-router'
import { useRef, useState } from 'react'

import { SourceComparisonContent } from '@/components/publication-editor-sidebar'
import { PublicationEditorSourceSection } from '@/components/publication-editor-source-section'
import { api, ApiError, formatApiError, type MediaReference, type Post } from '@/lib/api'
import * as m from '@/paraglide/messages.js'

export function PostSourceEditor({
    projectId,
    post,
    media,
    canEdit,
    accessEpoch,
    getAccessEpoch,
    onSaved,
    onEditingChange,
}: {
    readonly projectId: string
    readonly post: Post
    readonly media: readonly MediaReference[]
    readonly canEdit: boolean
    readonly getAccessEpoch: () => number
    readonly accessEpoch: number
    readonly onSaved: () => void
    readonly onEditingChange: (editing: boolean) => void
}) {
    const [working, setWorking] = useState<Post | null>(null)
    const [discardPending, setDiscardPending] = useState(false)
    const initialContent = useRef<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const currentAccess = useRef({ canEdit, accessEpoch })
    currentAccess.current = { canEdit, accessEpoch }
    const dirty =
        working !== null && JSON.stringify(working.sourceContent) !== initialContent.current
    const blocker = useBlocker({
        shouldBlockFn: () => dirty,
        enableBeforeUnload: dirty,
        withResolver: true,
    })
    const conflict = working !== null && working.sourceRevision !== post.sourceRevision
    function close() {
        if (dirty) {
            setDiscardPending(true)
            return
        }
        discard()
    }
    function discard() {
        setDiscardPending(false)
        setWorking(null)
        setError(null)
        onEditingChange(false)
    }
    async function save() {
        if (!working || saving || !canEdit) return
        const started = accessEpoch
        setSaving(true)
        setError(null)
        try {
            await api.savePostSource(projectId, post.id, {
                expectedSourceRevision: working.sourceRevision,
                sourceContent: working.sourceContent,
            })
            if (getAccessEpoch() !== started || !currentAccess.current.canEdit) return
            setWorking(null)
            onEditingChange(false)
            onSaved()
        } catch (failure) {
            if (getAccessEpoch() !== started || !currentAccess.current.canEdit) return
            setError(
                failure instanceof ApiError && failure.code === 'write_conflict'
                    ? m.post_source_conflict()
                    : formatApiError(failure)
            )
        } finally {
            setSaving(false)
        }
    }
    function update(content: Post['sourceContent']) {
        if (working) setWorking({ ...working, sourceContent: content })
    }
    return (
        <section aria-label={m.source_review_source()} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">{m.source_review_source()}</h2>
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                        {m.editor_source_revision({ revision: post.sourceRevision })}
                    </span>
                    {working ? (
                        <>
                            <Button variant="ghost" disabled={saving} onClick={close}>
                                {m.common_cancel()}
                            </Button>
                            <Button
                                disabled={!canEdit || saving || conflict || !dirty}
                                onClick={() => void save()}>
                                {saving ? m.common_loading() : m.common_save()}
                            </Button>
                        </>
                    ) : canEdit ? (
                        <Button
                            variant="outline"
                            onClick={() => {
                                initialContent.current = JSON.stringify(post.sourceContent)
                                setWorking(post)
                                setError(null)
                                onEditingChange(true)
                            }}>
                            {m.post_source_edit()}
                        </Button>
                    ) : null}
                </div>
            </div>
            {conflict || error ? (
                <p role="alert" className="text-sm text-destructive">
                    {conflict ? m.post_source_conflict() : error}
                </p>
            ) : null}
            {working ? (
                <PublicationEditorSourceSection
                    projectId={projectId}
                    sourceContent={working.sourceContent}
                    sourceRevision={working.sourceRevision}
                    disabled={!canEdit || saving}
                    mediaDisabled={!canEdit || saving}
                    onTextChange={text =>
                        update({
                            ...working.sourceContent,
                            ...(text
                                ? {
                                      body: {
                                          text,
                                          format:
                                              working.sourceContent.body?.format ?? 'plain_text',
                                      },
                                  }
                                : { body: undefined }),
                        })
                    }
                    onFormatChange={format =>
                        update({
                            ...working.sourceContent,
                            ...(working.sourceContent.body
                                ? { body: { ...working.sourceContent.body, format } }
                                : {}),
                        })
                    }
                    onOptionalFieldChange={(field, value) => {
                        const content = { ...working.sourceContent }
                        if (value) content[field] = value
                        else delete content[field]
                        update(content)
                    }}
                    onMediaChange={items => update({ ...working.sourceContent, media: items })}
                />
            ) : (
                <SourceComparisonContent
                    projectId={projectId}
                    content={post.sourceContent}
                    media={media}
                />
            )}
            <Dialog
                open={discardPending || blocker.status === 'blocked'}
                onOpenChange={open => {
                    if (!open) {
                        setDiscardPending(false)
                        blocker.reset?.()
                    }
                }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{m.post_source_leave()}</DialogTitle>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="ghost"
                            onClick={() => {
                                setDiscardPending(false)
                                blocker.reset?.()
                            }}>
                            {m.common_cancel()}
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => {
                                if (blocker.status === 'blocked') blocker.proceed()
                                else discard()
                            }}>
                            {m.publication_new_recovery_discard()}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </section>
    )
}
