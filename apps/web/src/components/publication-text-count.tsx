import { cn } from '@postbot/ui/lib/utils'

import type { countComposerText, getComposerTextFields } from '@/lib/composer-text-constraints'
import { formatNumber } from '@/lib/format'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

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
    return (
        <div className="px-4 pb-3">
            <p
                id={id}
                data-composer-text-count="true"
                className={cn(
                    'text-xs',
                    result.invalid ? 'text-destructive' : 'text-muted-foreground'
                )}>
                {constraint.field.maxLength !== null
                    ? m.composer_character_count({
                          count: formatNumber(result.characters, locale),
                          limit: formatNumber(constraint.field.maxLength, locale),
                      })
                    : null}
                {result.graphemes !== null && constraint.maxGraphemes !== null ? (
                    <span className="ml-2">
                        {m.composer_grapheme_count({
                            count: formatNumber(result.graphemes, locale),
                            limit: formatNumber(constraint.maxGraphemes, locale),
                        })}
                    </span>
                ) : null}
            </p>
        </div>
    )
}
