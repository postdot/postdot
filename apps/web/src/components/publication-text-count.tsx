import { cn } from '@postdot/ui/lib/utils'

import type { countComposerText, getComposerTextFields } from '@/lib/composer-text-constraints'
import { formatNumber } from '@/lib/format'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

/** Short limits are always worth seeing; long ones only once the text approaches them. */
const ALWAYS_SHOWN_LIMIT = 500
const APPROACHING_RATIO = 0.8

/**
 * One counter for the strictest limit, shown only when it can matter (ADR-103 §1, audit P6):
 * never two counters, never "graphemes", never a limit nobody can reach.
 */
export function PublicationTextCount({
    id,
    result,
    constraint,
}: {
    readonly id: string
    readonly result: ReturnType<typeof countComposerText>
    readonly constraint: NonNullable<ReturnType<typeof getComposerTextFields>['body']>
}) {
    const { locale } = useLanguage()
    const measure = strictestMeasure(result, constraint)
    if (measure === null) return null
    const { count, limit } = measure
    if (!result.invalid && limit > ALWAYS_SHOWN_LIMIT && count < limit * APPROACHING_RATIO) {
        return null
    }
    return (
        <div className="px-4 pb-3">
            <p
                id={id}
                data-composer-text-count="true"
                className={cn(
                    'text-xs tabular-nums',
                    result.invalid ? 'text-destructive' : 'text-muted-foreground'
                )}>
                {m.composer_character_count({
                    count: formatNumber(count, locale),
                    limit: formatNumber(limit, locale),
                })}
            </p>
        </div>
    )
}

function strictestMeasure(
    result: ReturnType<typeof countComposerText>,
    constraint: NonNullable<ReturnType<typeof getComposerTextFields>['body']>
) {
    const measures = [
        constraint.field.maxLength === null
            ? null
            : { count: result.characters, limit: constraint.field.maxLength },
        result.graphemes === null || constraint.maxGraphemes === null
            ? null
            : { count: result.graphemes, limit: constraint.maxGraphemes },
    ].filter(
        (measure): measure is { count: number; limit: number } =>
            measure !== null && Number.isFinite(measure.limit) && measure.limit > 0
    )
    if (measures.length === 0) return null
    return measures.reduce((strictest, measure) =>
        measure.count / measure.limit > strictest.count / strictest.limit ? measure : strictest
    )
}
