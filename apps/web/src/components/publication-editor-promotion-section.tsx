import { Button } from '@postdot/ui/components/button'
import { Field, FieldLabel } from '@postdot/ui/components/field'
import { Kbd } from '@postdot/ui/components/kbd'
import { CheckIcon } from '@solar-icons/react/linear/check'

import { DateTimePicker } from '@/components/date-time-picker'
import { useLanguage } from '@/lib/i18n'
import type { PublicationPromotionIntent } from '@/lib/publication-promotion'
import { getModifierKey } from '@/lib/shortcuts'
import * as m from '@/paraglide/messages.js'

interface PublicationEditorPromotionSectionProps {
    readonly intent: PublicationPromotionIntent
    readonly pending: boolean
    readonly timeZone: string
    readonly scheduleValue: string
    readonly disabled: boolean
    readonly draftRequiresReview: boolean
    readonly draftDiffersFromTarget: boolean
    readonly onScheduleChange: (value: string) => void
    readonly onPromote: () => void
}

export function PublicationEditorDeliverySettings({
    timeZone,
    scheduleValue,
    disabled,
    onScheduleChange,
}: Pick<
    PublicationEditorPromotionSectionProps,
    'timeZone' | 'scheduleValue' | 'disabled' | 'onScheduleChange'
>) {
    const { locale } = useLanguage()
    return (
        // D7: one labelled field; the picker itself opens the calendar.
        <Field
            className="min-w-0 gap-1.5 rounded-md bg-surface-inset/35 px-3 py-3 shadow-surface"
            data-publication-delivery-disclosure="true">
            <FieldLabel htmlFor="deliver-at">{m.editor_deliver_at()}</FieldLabel>
            <DateTimePicker
                id="deliver-at"
                value={scheduleValue}
                onChange={onScheduleChange}
                disabled={disabled}
                clearLabel={m.common_clear()}
                dateLabel={m.date_time_picker_date()}
                locale={locale}
                placeholder={m.date_time_picker_placeholder()}
                timeLabel={m.date_time_picker_time()}
                timeZone={timeZone}
            />
        </Field>
    )
}

export function PublicationEditorPromotionAction({
    intent,
    pending,
    disabled,
    draftRequiresReview,
    draftDiffersFromTarget,
    onPromote,
}: Pick<
    PublicationEditorPromotionSectionProps,
    | 'intent'
    | 'pending'
    | 'disabled'
    | 'draftRequiresReview'
    | 'draftDiffersFromTarget'
    | 'onPromote'
>) {
    useLanguage()
    return (
        <div className="grid min-w-0 gap-3">
            {draftRequiresReview ? (
                <p className="text-sm text-state-attention">{m.editor_promotion_review_detail()}</p>
            ) : null}
            <div className="flex flex-wrap items-center justify-end gap-3">
                {draftDiffersFromTarget ? (
                    <span className="text-xs text-state-attention">{m.editor_draft_differs()}</span>
                ) : null}
                <Button
                    data-publication-promotion-action
                    onClick={onPromote}
                    disabled={disabled}
                    aria-busy={pending}>
                    <CheckIcon aria-hidden="true" />
                    <span>
                        {pending
                            ? m.editor_applying_draft()
                            : intent === 'schedule'
                              ? m.editor_schedule_action()
                              : intent === 'update_schedule'
                                ? m.editor_update_schedule_action()
                                : intent === 'return_draft'
                                  ? m.editor_return_draft_action()
                                  : m.editor_select_version_action()}
                    </span>
                    <Kbd className="ml-1 hidden font-mono text-[10px] opacity-75 sm:inline-flex">
                        {getModifierKey()}↵
                    </Kbd>
                </Button>
            </div>
        </div>
    )
}
