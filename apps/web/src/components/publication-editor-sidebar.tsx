import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { Button } from '@herald/ui/components/button'
import { useState } from 'react'

import { MediaPreview, readyRepresentation } from '@/components/media-asset-card'
import type { MediaReference, PublicationEditorState } from '@/lib/api'
import { formatProjectDateTime } from '@/lib/date-time'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export type PublicationEditorSaveState =
    | 'saved'
    | 'saving'
    | 'rebasing'
    | 'local_only'
    | 'conflict'
    | 'error'

export interface CapabilitySummary {
    readonly textFields: readonly {
        readonly bindingId: string
        readonly maxLength: number | null
        readonly maxWeightedLength: number | null
        readonly acceptedSourceFormats: readonly string[]
    }[]
    readonly mediaFieldCount: number
}

interface PublicationEditorSidebarProps {
    readonly projectId: string
    readonly media: readonly MediaReference[]
    readonly editor: PublicationEditorState
    readonly capabilitySummary: CapabilitySummary
    readonly timeZone: string
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
    capabilitySummary,
    timeZone,
    sourceConflict,
    saveState,
    isRebasing,
    recoveryAvailable,
    hasLocalChanges,
    onRebase,
    onReload,
    onRestore,
}: PublicationEditorSidebarProps) {
    const { locale } = useLanguage()
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
                            ? m.editor_sidebar_source_conflict_detail({
                                  draftRevision: editor.draft.sourceRevision,
                                  currentRevision: editor.post.sourceRevision,
                              })
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
                                    {m.editor_sidebar_draft_source_revision({
                                        revision: editor.draft.sourceRevision,
                                    })}
                                </p>
                                <SourceComparisonContent
                                    content={editor.draft.baseSourceContent}
                                    projectId={projectId}
                                    media={media}
                                />
                            </div>
                            <div className="min-w-0 rounded-md bg-background/60 p-3 shadow-field">
                                <p className="font-medium text-foreground">
                                    {m.editor_sidebar_current_source_revision({
                                        revision: editor.post.sourceRevision,
                                    })}
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
            <section className="min-w-0 rounded-xl bg-surface-inset/65 p-4 shadow-surface sm:p-5">
                <p className="text-xs font-medium text-muted-foreground">
                    {m.editor_sidebar_selected_target()}
                </p>
                <h2 className="mt-2 font-heading text-xl font-[580] leading-[1.03]">
                    {m.editor_sidebar_delivery_snapshot()}
                </h2>
                {editor.selectedTarget === null ? (
                    <p className="mt-4 text-sm leading-6 text-muted-foreground">
                        {m.editor_sidebar_no_promoted_target()}
                    </p>
                ) : (
                    <div className="mt-4 space-y-3 text-sm">
                        <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
                            <dt className="text-muted-foreground">{m.editor_sidebar_revision()}</dt>
                            <dd className="font-medium">{editor.selectedTarget.sequence}</dd>
                            <dt className="text-muted-foreground">{m.editor_sidebar_profile()}</dt>
                            <dd className="truncate font-medium">
                                {editor.selectedTarget.profileVersionId}
                            </dd>
                            <dt className="text-muted-foreground">
                                {m.editor_sidebar_scheduled()}
                            </dt>
                            <dd className="font-medium">
                                {formatProjectDateTime(
                                    editor.publication.scheduledAt,
                                    timeZone,
                                    locale,
                                    m.publication_unscheduled()
                                )}
                            </dd>
                        </dl>
                        <pre className="max-h-72 max-w-full overflow-auto rounded-md bg-surface-field p-3 font-mono text-xs leading-5 shadow-field">
                            {formatJson(editor.selectedTarget.content)}
                        </pre>
                    </div>
                )}
            </section>

            <section className="min-w-0 rounded-xl bg-surface-raised p-4 shadow-surface sm:p-5">
                <p className="text-xs font-medium text-muted-foreground">
                    {m.editor_sidebar_contract()}
                </p>
                <h2 className="mt-2 font-heading text-xl font-[580] leading-[1.03]">
                    {m.editor_sidebar_capability_feedback()}
                </h2>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {m.editor_sidebar_profile_meta({
                        profile: editor.profile.profileId,
                        version: editor.profile.version,
                        schema:
                            editor.profile.profile.schemaHash ?? m.editor_sidebar_schema_unhashed(),
                    })}
                </p>
                <div className="mt-5 space-y-3 text-sm">
                    {capabilitySummary.textFields.map(field => (
                        <div
                            key={field.bindingId}
                            className="rounded-md bg-muted px-3 py-2 shadow-field">
                            <p className="font-medium">{field.bindingId}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                {field.maxWeightedLength !== null
                                    ? m.editor_sidebar_max_weighted_chars({
                                          count: field.maxWeightedLength,
                                      })
                                    : field.maxLength === null
                                      ? m.editor_sidebar_no_length_limit()
                                      : m.editor_sidebar_max_chars({ count: field.maxLength })}{' '}
                                ·{' '}
                                {field.acceptedSourceFormats.join(', ') ||
                                    m.editor_sidebar_no_source_format()}
                            </p>
                        </div>
                    ))}
                    <p className="text-xs text-muted-foreground">
                        {m.editor_sidebar_media_fields({
                            count: capabilitySummary.mediaFieldCount,
                        })}
                    </p>
                </div>
            </section>
        </aside>
    )
}

function formatJson(value: unknown) {
    return JSON.stringify(value, null, 2)
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
