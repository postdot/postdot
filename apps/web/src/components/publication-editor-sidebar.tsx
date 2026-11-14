import { Alert, AlertDescription, AlertTitle } from '@postdot/ui/components/alert'
import { Button } from '@postdot/ui/components/button'
import { useState } from 'react'

import { MediaPreview, readyRepresentation } from '@/components/media-asset-card'
import type { MediaReference, PublicationEditorState } from '@/lib/api'
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
                    className="rounded-md border-0 bg-state-attention/10 px-4 py-4 text-foreground shadow-surface lg:col-span-2">
                    <AlertTitle>
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
                            <div className="min-w-0 rounded-md bg-background/60 p-3 shadow-field">
                                <p className="font-medium text-foreground">
                                    {m.editor_sidebar_draft_source_revision()}
                                </p>
                                <SourceComparisonContent
                                    content={editor.draft.baseSourceContent}
                                    projectId={projectId}
                                    media={media}
                                />
                            </div>
                            <div className="min-w-0 rounded-md bg-background/60 p-3 shadow-field">
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
    projectId,
    media,
}: {
    readonly content: PublicationEditorState['post']['sourceContent']
    readonly projectId: string
    readonly media: readonly MediaReference[]
}) {
    const [expanded, setExpanded] = useState(false)
    const body = content.body?.text
    const shortened = body !== undefined && body.length > 500
    return (
        <div className="mt-3 min-w-0 space-y-3 text-sm leading-6">
            {content.headline ? (
                <p className="break-words font-medium">{content.headline}</p>
            ) : null}
            {content.body ? (
                <p className="whitespace-pre-wrap break-words">
                    {shortened && !expanded ? `${body?.slice(0, 500)}…` : body}
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
            {content.media.length > 0 ? (
                <ol className="flex flex-wrap gap-2">
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
                                        className="size-16 rounded-md object-cover shadow-field"
                                    />
                                ) : (
                                    <span className="flex min-h-16 max-w-40 items-center rounded-md bg-surface-inset px-3 text-xs text-muted-foreground">
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
