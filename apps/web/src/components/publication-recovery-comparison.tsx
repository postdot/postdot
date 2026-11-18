import { SourceComparisonContent } from '@/components/publication-editor-sidebar'
import type { MediaReference, PublicationEditorState } from '@/lib/api'
import { formatCivilSchedule } from '@/lib/date-time'
import { useLanguage } from '@/lib/i18n'
import { getTargetEditorFields, readTargetField } from '@/lib/target-editor'
import { getTargetMediaSelections } from '@/lib/target-media'
import * as m from '@/paraglide/messages.js'

type Source = PublicationEditorState['post']['sourceContent']

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
    if (value !== null && typeof value === 'object') {
        return `{${Object.keys(value)
            .sort()
            .map(
                key =>
                    `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`
            )
            .join(',')}}`
    }
    return JSON.stringify(value) ?? 'undefined'
}

export interface RecoveryComparisonInput {
    readonly editor: PublicationEditorState
    readonly localSource: Source
    readonly localTarget: Record<string, unknown> | null
    readonly localSchedule: string
    readonly savedSchedule: string
}

/** What a local copy changes compared to the saved version, ignoring key order. */
export function recoveryComparisonChanges({
    editor,
    localSource,
    localTarget,
    localSchedule,
    savedSchedule,
}: RecoveryComparisonInput) {
    return {
        source: stableJson(localSource) !== stableJson(editor.post.sourceContent),
        target: stableJson(localTarget) !== stableJson(editor.draft.content),
        schedule: localSchedule !== savedSchedule,
    }
}

/**
 * Saved version and local copy side by side. `parts` limits the comparison to the post text
 * (`source`) or to one channel's version and schedule (`channel`), so a post with several
 * channels shows its text once.
 */
export function PublicationRecoveryComparison({
    editor,
    localSource,
    localTarget,
    localSchedule,
    savedSchedule,
    projectId,
    media,
    parts = 'all',
}: RecoveryComparisonInput & {
    readonly projectId: string
    readonly media: readonly MediaReference[]
    readonly parts?: 'all' | 'source' | 'channel'
}) {
    const { locale } = useLanguage()
    const changes = recoveryComparisonChanges({
        editor,
        localSource,
        localTarget,
        localSchedule,
        savedSchedule,
    })
    const sourceChanged = parts !== 'channel' && changes.source
    const targetChanged = parts !== 'source' && changes.target
    const scheduleChanged = parts !== 'source' && changes.schedule
    if (!sourceChanged && !targetChanged && !scheduleChanged) return null
    return (
        <div className="grid min-w-0 gap-4 sm:grid-cols-2" data-recovery-comparison>
            {[
                {
                    label: m.editor_comparison_saved(),
                    source: editor.post.sourceContent,
                    target: editor.draft.content,
                    schedule: savedSchedule,
                },
                {
                    label: m.editor_comparison_local(),
                    source: localSource,
                    target: localTarget,
                    schedule: localSchedule,
                },
            ].map((version, index) => (
                <section
                    key={index}
                    className="min-w-0 rounded-lg border border-border bg-surface-raised p-3"
                    data-recovery-version={index === 0 ? 'saved' : 'local'}>
                    <h3 className="font-medium">{version.label}</h3>
                    {sourceChanged ? (
                        <div className="mt-4">
                            <h4 className="text-xs text-muted-foreground">
                                {m.editor_comparison_shared()}
                            </h4>
                            <SourceComparisonContent
                                content={version.source}
                                projectId={projectId}
                                media={media}
                            />
                        </div>
                    ) : null}
                    {targetChanged ? (
                        <div className="mt-4">
                            <h4 className="text-xs text-muted-foreground">
                                {m.editor_comparison_destination()}
                            </h4>
                            {version.target ? (
                                <>
                                    {getTargetEditorFields(editor.profile.profile, locale)
                                        .filter(field => field.kind !== 'media')
                                        .map(field => {
                                            const value = readTargetField(
                                                version.target!,
                                                field.path
                                            )
                                            if (
                                                value === undefined ||
                                                value === null ||
                                                value === ''
                                            )
                                                return null
                                            if (typeof value === 'string')
                                                return (
                                                    <div key={field.path}>
                                                        {field.semantic !== 'primary_text' ? (
                                                            <p className="mt-3 text-xs text-muted-foreground">
                                                                {field.label}
                                                            </p>
                                                        ) : null}
                                                        <SourceComparisonContent
                                                            content={{
                                                                body: {
                                                                    format: 'plain_text',
                                                                    text: value,
                                                                },
                                                                media: [],
                                                            }}
                                                            projectId={projectId}
                                                            media={media}
                                                        />
                                                    </div>
                                                )
                                            return (
                                                <div key={field.path} className="mt-3 min-w-0">
                                                    <p className="text-xs text-muted-foreground">
                                                        {field.label}
                                                    </p>
                                                    {/* Structured values are summarized, never shown as JSON. */}
                                                    {Array.isArray(value) ? (
                                                        <p className="text-sm">
                                                            {m.editor_comparison_items({
                                                                count: value.length,
                                                            })}
                                                        </p>
                                                    ) : typeof value === 'object' ? (
                                                        <p className="text-sm">
                                                            {m.editor_comparison_structured()}
                                                        </p>
                                                    ) : (
                                                        <p className="break-words">
                                                            {String(value)}
                                                        </p>
                                                    )}
                                                </div>
                                            )
                                        })}
                                    {/* Text kept under fields the current rules no longer know. */}
                                    {unmappedTargetText(
                                        version.target,
                                        getTargetEditorFields(editor.profile.profile, locale)
                                    ).map((text, index) => (
                                        <SourceComparisonContent
                                            content={{
                                                body: { format: 'plain_text', text },
                                                media: [],
                                            }}
                                            key={`unmapped-${index}`}
                                            media={media}
                                            projectId={projectId}
                                        />
                                    ))}
                                    <SourceComparisonContent
                                        content={{
                                            media: getTargetMediaSelections(
                                                editor.profile.profile,
                                                version.target
                                            ),
                                        }}
                                        projectId={projectId}
                                        media={media}
                                    />
                                </>
                            ) : (
                                <p className="mt-2 text-sm text-muted-foreground">
                                    {m.editor_target_null()}
                                </p>
                            )}
                        </div>
                    ) : null}
                    {scheduleChanged ? (
                        <div className="mt-4">
                            <h4 className="text-xs text-muted-foreground">
                                {m.editor_comparison_schedule()}
                            </h4>
                            <p className="mt-2 text-sm">
                                {formatCivilSchedule(version.schedule, locale) ||
                                    version.schedule ||
                                    m.publication_unscheduled()}
                            </p>
                        </div>
                    ) : null}
                </section>
            ))}
        </div>
    )
}

/** Top-level text values that no field of the current rules reads. */
function unmappedTargetText(
    target: Readonly<Record<string, unknown>>,
    fields: readonly { readonly path: string }[]
): string[] {
    const known = new Set(fields.map(field => field.path.split('/')[1]).filter(Boolean))
    return Object.entries(target)
        .filter(([key, value]) => !known.has(key) && typeof value === 'string' && value !== '')
        .map(([, value]) => value as string)
}
