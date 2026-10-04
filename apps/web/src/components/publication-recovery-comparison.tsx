import { SourceComparisonContent } from '@/components/publication-editor-sidebar'
import type { MediaReference, PublicationEditorState } from '@/lib/api'
import { formatCivilSchedule } from '@/lib/date-time'
import { useLanguage } from '@/lib/i18n'
import { getTargetEditorFields, readTargetField } from '@/lib/target-editor'
import { getTargetMediaSelections } from '@/lib/target-media'
import * as m from '@/paraglide/messages.js'

type Source = PublicationEditorState['post']['sourceContent']

export function PublicationRecoveryComparison({
    editor,
    localSource,
    localTarget,
    localSchedule,
    savedSchedule,
    projectId,
    media,
}: {
    readonly editor: PublicationEditorState
    readonly localSource: Source
    readonly localTarget: Record<string, unknown> | null
    readonly localSchedule: string
    readonly savedSchedule: string
    readonly projectId: string
    readonly media: readonly MediaReference[]
}) {
    const { locale } = useLanguage()
    const sourceChanged = JSON.stringify(localSource) !== JSON.stringify(editor.post.sourceContent)
    const targetChanged = JSON.stringify(localTarget) !== JSON.stringify(editor.draft.content)
    const scheduleChanged = localSchedule !== savedSchedule
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
                    className="min-w-0 rounded-md bg-surface-inset/50 p-3 shadow-field"
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
                                                    {typeof value === 'object' ? (
                                                        <details>
                                                            <summary className="cursor-pointer">
                                                                {m.editor_comparison_expand()}
                                                            </summary>
                                                            <pre className="whitespace-pre-wrap break-words text-xs">
                                                                {JSON.stringify(value, null, 2)}
                                                            </pre>
                                                        </details>
                                                    ) : (
                                                        <p className="break-words">
                                                            {String(value)}
                                                        </p>
                                                    )}
                                                </div>
                                            )
                                        })}
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
