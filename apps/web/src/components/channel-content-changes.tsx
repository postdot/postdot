import { useMemo } from 'react'

import {
    compareBuilderRules,
    type BuilderComparedRule,
    type BuilderRuleChange,
} from '@/lib/channel-content-builder'
import {
    compareJsonBodyProperties,
    isJsonBodyCreated,
    type JsonBodyLeaf,
} from '@/lib/channel-json-body-builder'
import { compareQuery } from '@/lib/channel-query-builder'
import { compareMappedRequests, type MappedRequestChange } from '@/lib/channel-request-builder'
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
            const proposed: unknown = JSON.parse(after)
            return [
                ...compareBuilderRules(before, proposed).map(change => ({
                    key: `${change.field.id}-${change.rule}`,
                    label: fieldLabel(change),
                    rule: ruleLabel(change.rule, change.field.kind),
                    before: display(change.before, change.rule, locale),
                    after: display(change.after, change.rule, locale),
                })),
                ...(isJsonBodyCreated(before, proposed)
                    ? [
                          {
                              key: 'body-created',
                              label: m.request_json_body(),
                              rule: m.request_body_format(),
                              before: m.request_body_absent(),
                              after: m.request_body_object(),
                          },
                      ]
                    : []),
                ...compareJsonBodyProperties(before, proposed).map(change => ({
                    key: `body-${change.name}`,
                    label: m.request_json_body(),
                    rule: change.name,
                    before: bodyLeafLabel(change.before),
                    after: bodyLeafLabel(change.after),
                })),
                ...compareQuery(before, proposed).map(change => ({
                    key: `query-${change.name}`,
                    label: m.request_query(),
                    rule: change.name,
                    before:
                        change.before === undefined
                            ? m.request_body_absent()
                            : `“${change.before}”`,
                    after:
                        change.after === undefined ? m.request_body_absent() : `“${change.after}”`,
                })),
                ...compareMappedRequests(before, proposed).map(change => ({
                    key: `http-${change.key}`,
                    label: m.request_title(),
                    rule: requestRuleLabel(change),
                    before: change.before ?? m.request_not_extracted(),
                    after: change.after ?? m.request_not_extracted(),
                })),
            ]
        } catch {
            return []
        }
    }, [before, after, locale])
    if (!changes.length) return null
    return (
        <section aria-label={m.builder_changes()} className="min-w-0 space-y-3">
            <h3 className="text-sm font-medium">{m.builder_changes()}</h3>
            <p className="text-xs text-muted-foreground">{m.builder_changes_hint()}</p>
            <dl className="divide-y divide-border rounded-sm border border-border px-3">
                {changes.map(change => (
                    <div
                        key={change.key}
                        className="grid min-w-0 gap-2 py-3 sm:grid-cols-[1fr_1.2fr]">
                        <dt className="text-sm">
                            <span className="font-medium">{change.label}</span>
                            <span className="block text-xs text-muted-foreground">
                                {change.rule}
                            </span>
                        </dt>
                        <dd className="grid min-w-0 grid-cols-2 gap-4 text-sm">
                            <div className="min-w-0">
                                <span className="block text-xs text-muted-foreground">
                                    {m.builder_before()}
                                </span>
                                <span className="break-words tabular-nums">{change.before}</span>
                            </div>
                            <div className="min-w-0">
                                <span className="block text-xs text-muted-foreground">
                                    {m.builder_after()}
                                </span>
                                <span className="break-words font-medium tabular-nums">
                                    {change.after}
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

function requestRuleLabel(change: MappedRequestChange) {
    if (change.segmentIndex !== undefined)
        return m.request_segment({ number: change.segmentIndex + 1 })
    switch (change.key) {
        case 'externalIdPointer':
            return m.request_external_id()
        case 'externalUrlPointer':
            return m.request_external_url()
        case 'method':
            return m.request_method()
        case 'successStatuses':
            return m.request_success()
        case 'retryableStatuses':
            return m.request_retryable()
        case 'rejectedStatuses':
            return m.request_rejected()
        default:
            return m.request_ambiguous()
    }
}

function bodyLeafLabel(value: JsonBodyLeaf | undefined): string {
    if (value === undefined) return m.request_body_absent()
    if (value.kind === 'content') return m.request_body_content({ path: value.pointer })
    if (value.value === null) return m.request_body_null()
    return typeof value.value === 'string' ? `“${value.value}”` : String(value.value)
}
