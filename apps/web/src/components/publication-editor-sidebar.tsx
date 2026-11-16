import { Alert, AlertDescription, AlertTitle } from '@postdot/ui/components/alert'
import { Button } from '@postdot/ui/components/button'
import { useState } from 'react'

import { MediaPreview, readyRepresentation } from '@/components/media-asset-card'
import type { MediaReference, PublicationEditorState } from '@/lib/api'
import { sourceContentDifferences } from '@/lib/post-source-review'
import { diffWords } from '@/lib/word-diff'
import * as m from '@/paraglide/messages.js'

export type PublicationEditorSaveState =
    | 'saved'
    | 'saving'
    | 'rebasing'
    | 'local_only'
    | 'conflict'
    | 'error'

interface PublicationEditorSidebarProps {
    readonly projectId: string
    readonly media: readonly MediaReference[]
    readonly editor: PublicationEditorState
    readonly sourceConflict: boolean
    readonly saveState: PublicationEditorSaveState
    readonly isRebasing: boolean
    readonly recoveryAvailable: boolean
    readonly hasLocalChanges: boolean
    readonly onRebase: () => void
    readonly onReload: () => void
    readonly onRestore: () => void
}

export function PublicationEditorSidebar({
    editor,
    projectId,
    media,
    sourceConflict,
    saveState,
    isRebasing,
    recoveryAvailable,
    hasLocalChanges,
    onRebase,
    onReload,
    onRestore,
}: PublicationEditorSidebarProps) {
    return (
        <aside
            aria-label={m.editor_technical_details()}
            className="grid min-w-0 gap-4 lg:grid-cols-2">
            {sourceConflict || saveState === 'conflict' ? (
                <Alert
                    data-publication-conflict="true"
                    className="rounded-lg border border-border bg-surface-raised px-4 py-4 text-foreground lg:col-span-2">
                    {/* The conflict keeps its state colour on the title, not on the surface. */}
                    <AlertTitle className="text-state-attention">
                        {sourceConflict
                            ? m.editor_sidebar_source_review_title()
                            : m.editor_sidebar_reconcile_title()}
                    </AlertTitle>
                    <AlertDescription className="text-foreground group-data-[variant=destructive]/alert:text-foreground">
                        {sourceConflict
                            ? m.editor_sidebar_source_conflict_detail()
                            : m.editor_sidebar_revision_conflict_detail()}
                    </AlertDescription>
                    <div className="mt-4 flex flex-wrap gap-2">
                        {sourceConflict ? (
                            <Button size="sm" onClick={onRebase} disabled={isRebasing}>
                                {m.editor_sidebar_rebase_current()}
                            </Button>
                        ) : null}
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={onReload}
                            disabled={isRebasing}>
                            {m.editor_sidebar_load_server()}
                        </Button>
                        {recoveryAvailable || hasLocalChanges ? (
                            <Button
                                size="sm"
                                variant="secondary"
                                onClick={onRestore}
                                disabled={isRebasing}>
                                {m.editor_sidebar_load_local()}
                            </Button>
                        ) : null}
                    </div>
                    {sourceConflict ? (
                        <div className="mt-4 grid min-w-0 gap-3 text-xs sm:grid-cols-2">
                            <div className="min-w-0 rounded-lg border border-border bg-surface-raised p-3">
                                <p className="font-medium text-foreground">
                                    {m.editor_sidebar_draft_source_revision()}
                                </p>
                                <SourceComparisonContent
                                    content={editor.draft.baseSourceContent}
                                    projectId={projectId}
                                    media={media}
                                />
                            </div>
                            <div className="min-w-0 rounded-lg border border-border bg-surface-raised p-3">
                                <p className="font-medium text-foreground">
                                    {m.editor_sidebar_current_source_revision()}
                                </p>
                                <SourceComparisonContent
                                    content={editor.post.sourceContent}
                                    projectId={projectId}
                                    media={media}
                                />
                            </div>
                        </div>
                    ) : null}
                </Alert>
            ) : null}
            {/* ADR-103 §1: snapshots, profile versions and schema hashes belong to the API and
                CLI, not to Studio. */}
        </aside>
    )
}

export function SourceComparisonContent({
    content,
    compareWith,
    comparisonSide = 'current',
    projectId,
    media,
}: {
    readonly content: PublicationEditorState['post']['sourceContent']
    readonly compareWith?: PublicationEditorState['post']['sourceContent']
    readonly comparisonSide?: 'current' | 'post'
    readonly projectId: string
    readonly media: readonly MediaReference[]
}) {
    const [expanded, setExpanded] = useState(false)
    const differences = compareWith ? sourceContentDifferences(content, compareWith) : undefined
    const changedClass = 'rounded-sm bg-accent/60 px-1 text-foreground'
    const body = content.body?.text
    const shortened = body !== undefined && body.length > 500
    return (
        <div className="mt-3 min-w-0 space-y-3 text-sm leading-6">
            {content.headline || differences?.title ? (
                <p className="break-words font-medium">
                    <ComparisonText
                        text={content.headline ?? ''}
                        compareWith={compareWith?.headline ?? (compareWith ? '' : undefined)}
                        side={comparisonSide}
                    />
                </p>
            ) : null}
            {content.body || differences?.text ? (
                <p className="whitespace-pre-wrap break-words">
                    <ComparisonText
                        text={body ?? ''}
                        compareWith={compareWith?.body?.text ?? (compareWith ? '' : undefined)}
                        side={comparisonSide}
                        limit={shortened && !expanded ? 500 : undefined}
                    />
                </p>
            ) : null}
            {shortened ? (
                <Button
                    size="sm"
                    variant="ghost"
                    aria-expanded={expanded}
                    onClick={() => setExpanded(value => !value)}>
                    {expanded ? m.editor_comparison_collapse() : m.editor_comparison_expand()}
                </Button>
            ) : null}
            {content.language ? (
                <p className="text-xs text-muted-foreground">{content.language}</p>
            ) : null}
            {compareWith && (content.media.length > 0 || compareWith.media.length > 0) ? (
                <p className="text-xs text-muted-foreground">
                    <span className={differences?.media ? changedClass : undefined}>
                        {m.source_review_media({ count: content.media.length })}
                    </span>
                </p>
            ) : null}
            {content.media.length > 0 ? (
                <ol
                    className={
                        differences?.media
                            ? 'flex flex-wrap gap-2 rounded-sm bg-accent/60 p-1'
                            : 'flex flex-wrap gap-2'
                    }>
                    {content.media.map((selection, index) => {
                        const asset = media.find(item => item.asset.id === selection.assetId)
                        return (
                            <li
                                key={`${selection.assetId}-${index}`}
                                className="min-w-0 max-w-full">
                                {asset ? (
                                    <MediaPreview
                                        projectId={projectId}
                                        asset={asset}
                                        representation={readyRepresentation(asset)}
                                        alt={
                                            selection.accessibilityText
                                                ? ''
                                                : asset.asset.originalFilename
                                        }
                                        className="size-16 rounded-lg border border-border object-cover"
                                    />
                                ) : (
                                    <span className="flex min-h-16 max-w-40 items-center rounded-lg border border-border bg-surface-raised px-3 text-xs text-muted-foreground">
                                        {m.editor_comparison_media_unavailable()}
                                    </span>
                                )}
                                {selection.accessibilityText ? (
                                    <p className="mt-1 max-w-40 break-words text-xs text-muted-foreground">
                                        {selection.accessibilityText}
                                    </p>
                                ) : null}
                            </li>
                        )
                    })}
                </ol>
            ) : null}
        </div>
    )
}

function ComparisonText({
    text,
    compareWith,
    side,
    limit = text.length,
}: {
    text: string
    compareWith?: string
    side: 'current' | 'post'
    limit?: number
}) {
    if (text === '') return compareWith === undefined ? null : m.source_review_empty()
    if (compareWith === undefined)
        return (
            <>
                {text.slice(0, limit)}
                {text.length > limit ? '…' : null}
            </>
        )
    const diff = side === 'current' ? diffWords(text, compareWith) : diffWords(compareWith, text)
    let remaining = limit
    return (
        <>
            {diff[side].map((part, index) => {
                const visible = part.text.slice(0, remaining)
                remaining = Math.max(0, remaining - part.text.length)
                if (visible === '') return null
                if (!part.changed) return visible
                return side === 'current' ? (
                    <del
                        key={index}
                        className="rounded-sm bg-state-failed/10 decoration-state-failed">
                        <span className="sr-only">{m.source_review_removed()}</span>
                        {visible}
                    </del>
                ) : (
                    <ins
                        key={index}
                        className="rounded-sm bg-state-published/10 decoration-state-published">
                        <span className="sr-only">{m.source_review_added()}</span>
                        {visible}
                    </ins>
                )
            })}
            {text.length > limit ? '…' : null}
        </>
    )
}
