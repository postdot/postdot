import { X_MAX_WEIGHTED_POST_LENGTH, type XWeightedTextResult } from '@postdot/x/text'

import { formatNumber } from '@/lib/format'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export function XWeightedTextCount({
    id,
    invalid,
    result,
}: {
    readonly id: string
    readonly invalid: boolean
    readonly result: XWeightedTextResult
}) {
    const { locale } = useLanguage()

    return (
        <p
            id={id}
            data-weighted-count="true"
            className={`text-xs ${invalid ? 'text-destructive' : 'text-muted-foreground'}`}>
            {result.weightedLength === null
                ? m.editor_x_weighted_count_invalid({
                      limit: formatNumber(X_MAX_WEIGHTED_POST_LENGTH, locale),
                  })
                : m.editor_x_weighted_count({
                      count: formatNumber(result.weightedLength, locale),
                      limit: formatNumber(X_MAX_WEIGHTED_POST_LENGTH, locale),
                  })}
        </p>
    )
}
