import { Button } from '@postbot/ui/components/button'
import { Field, FieldLabel } from '@postbot/ui/components/field'
import { AltArrowDownIcon } from '@solar-icons/react/linear/alt-arrow-down'
import { CalendarMinimalisticIcon } from '@solar-icons/react/linear/calendar-minimalistic'
import { CheckIcon } from '@solar-icons/react/linear/check'

import { DateTimePicker } from '@/components/date-time-picker'
import { formatCivilSchedule } from '@/lib/date-time'
import { useLanguage } from '@/lib/i18n'
import type { PublicationPromotionIntent } from '@/lib/publication-promotion'
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
        <details
            data-publication-delivery-disclosure="true"
            className="group min-w-0 rounded-md bg-surface-inset/35 px-3 shadow-surface">
            <summary
                aria-label={m.editor_promotion_heading()}
                className="flex min-h-14 cursor-pointer list-none items-center gap-3 py-3 text-sm [&::-webkit-details-marker]:hidden">
                <CalendarMinimalisticIcon
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 flex-1 truncate font-medium">
                    {formatCivilSchedule(scheduleValue, locale) || m.date_time_picker_placeholder()}
                </span>
                <AltArrowDownIcon
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
                />
            </summary>
            <Field className="min-w-0 gap-1.5 pb-4 pt-1">
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
        </details>
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
                    {pending
                        ? m.editor_applying_draft()
                        : intent === 'schedule'
                          ? m.editor_schedule_action()
                          : intent === 'update_schedule'
                            ? m.editor_update_schedule_action()
                            : intent === 'return_draft'
                              ? m.editor_return_draft_action()
                              : m.editor_select_version_action()}
                </Button>
            </div>
        </div>
    )
}
