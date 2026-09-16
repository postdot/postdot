import { Button } from '@herald/ui/components/button'
import { Card, CardContent } from '@herald/ui/components/card'
import { Field, FieldDescription, FieldLabel } from '@herald/ui/components/field'
import { Input } from '@herald/ui/components/input'
import { CheckSquareIcon } from '@solar-icons/react/bold/check-square'

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
    useLanguage()
    return (
        <section className="min-w-0">
            <Card>
                <CardContent className="p-6 sm:p-7">
                    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                        <div>
                            <p className="text-xs font-medium text-muted-foreground">
                                {m.editor_promotion_title()}
                            </p>
                            <h2 className="mt-2 font-heading text-2xl font-[580] leading-[1.03] tracking-[-0.05em]">
                                {m.editor_promotion_heading()}
                            </h2>
                            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                                {m.editor_promotion_autosave()}
                            </p>
                            {draftRequiresReview ? (
                                <p className="mt-3 max-w-2xl text-sm leading-6 text-state-attention">
                                    {m.editor_promotion_review_detail()}
                                </p>
                            ) : null}
                        </div>
                        <span className="text-sm text-muted-foreground">
                            {draftDiffersFromTarget
                                ? m.editor_draft_differs()
                                : m.editor_draft_matches()}
                        </span>
                    </div>
                    <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end">
                        <Field className="min-w-0 flex-1 gap-1.5">
                            <FieldLabel htmlFor="deliver-at">{m.editor_deliver_at()}</FieldLabel>
                            <Input
                                id="deliver-at"
                                type="datetime-local"
                                value={scheduleValue}
                                onChange={event => onScheduleChange(event.target.value)}
                                disabled={disabled}
                                className="min-w-0"
                            />
                            <FieldDescription className="text-xs">
                                {m.editor_project_timezone({ timeZone })}.{' '}
                                {m.editor_clear_draft_note()}
                            </FieldDescription>
                        </Field>
                        <Button className="sm:mb-5" onClick={onPromote} disabled={disabled}>
                            <CheckSquareIcon aria-hidden="true" />
                            {m.editor_apply_draft()}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </section>
    )
}
