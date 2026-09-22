import { Badge } from '@herald/ui/components/badge'
import { Button } from '@herald/ui/components/button'
import { Card, CardContent } from '@herald/ui/components/card'
import { Field, FieldDescription, FieldLabel } from '@herald/ui/components/field'
import { CheckIcon } from '@solar-icons/react/linear/check'

import { DateTimePicker } from '@/components/date-time-picker'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

interface PublicationEditorPromotionSectionProps {
    readonly timeZone: string
    readonly scheduleValue: string
    readonly disabled: boolean
    readonly draftRequiresReview: boolean
    readonly draftDiffersFromTarget: boolean
    readonly onScheduleChange: (value: string) => void
    readonly onPromote: () => void
}

export function PublicationEditorPromotionSection({
    timeZone,
    scheduleValue,
    disabled,
    draftRequiresReview,
    draftDiffersFromTarget,
    onScheduleChange,
    onPromote,
}: PublicationEditorPromotionSectionProps) {
    const { locale } = useLanguage()
    return (
        <section className="min-w-0">
            <Card className="rounded-xl">
                <CardContent className="p-4 sm:p-5">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                        <h2 className="font-heading text-xl font-[580] leading-tight">
                            {m.editor_promotion_heading()}
                        </h2>
                        <Badge
                            variant="outline"
                            className={
                                draftDiffersFromTarget
                                    ? 'border-0 bg-transparent px-0 text-state-attention'
                                    : 'border-0 bg-transparent px-0 text-state-published'
                            }>
                            <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                            {draftDiffersFromTarget
                                ? m.editor_draft_differs()
                                : m.editor_draft_matches()}
                        </Badge>
                    </div>
                    {draftRequiresReview ? (
                        <p className="mt-3 text-sm text-state-attention">
                            {m.editor_promotion_review_detail()}
                        </p>
                    ) : null}
                    <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end">
                        <Field className="min-w-0 flex-1 gap-1.5">
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
                            <FieldDescription className="text-xs">
                                {m.editor_project_timezone({ timeZone })}
                            </FieldDescription>
                        </Field>
                        <Button className="sm:mb-5" onClick={onPromote} disabled={disabled}>
                            <CheckIcon aria-hidden="true" />
                            {m.editor_apply_draft()}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </section>
    )
}
