import { useMemo } from 'react'

import {
    compareBuilderRules,
    type BuilderComparedRule,
    type BuilderRuleChange,
} from '@/lib/channel-content-builder'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

/** A bounded readable comparison, alongside the server's complete impact assessment. */
export function ChannelContentChanges({
    before,
    after,
}: {
    readonly before: unknown
    readonly after: string
}) {
    const { locale } = useLanguage()
    const changes = useMemo(() => {
        try {
            return compareBuilderRules(before, JSON.parse(after))
        } catch {
            return []
        }
    }, [before, after])
    if (!changes.length) return null
    return (
        <section aria-label={m.builder_changes()} className="min-w-0 space-y-3">
            <h3 className="text-sm font-medium">{m.builder_changes()}</h3>
            <p className="text-xs text-muted-foreground">{m.builder_changes_hint()}</p>
            <dl className="divide-y divide-border rounded-sm border border-border px-3">
                {changes.map(change => (
                    <div
                        key={`${change.field.id}-${change.rule}`}
                        className="grid min-w-0 gap-2 py-3 sm:grid-cols-[1fr_1.2fr]">
                        <dt className="text-sm">
                            <span className="font-medium">{fieldLabel(change)}</span>
                            <span className="block text-xs text-muted-foreground">
                                {ruleLabel(change.rule, change.field.kind)}
                            </span>
                        </dt>
                        <dd className="grid min-w-0 grid-cols-2 gap-4 text-sm">
                            <div className="min-w-0">
                                <span className="block text-xs text-muted-foreground">
                                    {m.builder_before()}
                                </span>
                                <span className="break-words tabular-nums">
                                    {display(change.before, change.rule, locale)}
                                </span>
                            </div>
                            <div className="min-w-0">
                                <span className="block text-xs text-muted-foreground">
                                    {m.builder_after()}
                                </span>
                                <span className="break-words font-medium tabular-nums">
                                    {display(change.after, change.rule, locale)}
                                </span>
                            </div>
                        </dd>
                    </div>
                ))}
            </dl>
        </section>
    )
}
function fieldLabel(change: BuilderRuleChange) {
    return change.field.semantic === 'primary_text'
        ? m.editor_source_body()
        : change.field.semantic === 'headline'
          ? m.editor_source_headline()
          : change.field.semantic === 'language'
            ? m.editor_source_language()
            : m.media_attachments_title()
}
function ruleLabel(rule: BuilderComparedRule, kind: string) {
    return rule === 'present'
        ? m.builder_field_present()
        : rule === 'required'
          ? m.builder_required()
          : rule === 'maximum'
            ? kind === 'media'
                ? m.builder_max_files()
                : m.builder_max_length()
            : rule === 'formats'
              ? m.builder_formats()
              : rule === 'families'
                ? m.builder_media_types()
                : rule === 'maxBytes'
                  ? m.builder_max_bytes()
                  : rule === 'maxGraphemes'
                    ? m.builder_grapheme_limit()
                    : m.builder_weighted_limit()
}
function display(
    value: BuilderRuleChange['before'],
    rule: BuilderComparedRule,
    locale: string
): string {
    if (value === undefined) return m.builder_no_extra_limit()
    if (typeof value === 'boolean') return value ? m.editor_target_yes() : m.editor_target_no()
    if (typeof value === 'number')
        return new Intl.NumberFormat(locale).format(rule === 'maxBytes' ? value / 1_000_000 : value)
    return (
        value
            .map(item =>
                item === 'plain_text'
                    ? m.builder_plain_text()
                    : item === 'markdown'
                      ? 'Markdown'
                      : item === 'image'
                        ? m.media_filter_images()
                        : item === 'video'
                          ? m.builder_videos()
                          : item === 'audio'
                            ? m.media_filter_audio()
                            : item === 'document'
                              ? m.media_filter_documents()
                              : item
            )
            .join(', ') || m.editor_target_no_values()
    )
}
