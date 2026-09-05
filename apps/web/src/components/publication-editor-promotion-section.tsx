import { Button } from '@herald/ui/components/button'
import { Card, CardContent } from '@herald/ui/components/card'
import { Field, FieldDescription, FieldLabel } from '@herald/ui/components/field'
import { Input } from '@herald/ui/components/input'
import { CheckReadIcon } from '@solar-icons/react/bold/check-read'

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
    return (
        <section className="min-w-0">
            <Card>
                <CardContent className="p-6 sm:p-7">
                    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                        <div>
                            <p className="text-xs font-medium text-muted-foreground">
                                Explicit promotion
                            </p>
                            <h2 className="mt-2 font-heading text-2xl font-[580] leading-[1.03] tracking-[-0.05em]">
                                Choose what gets delivered
                            </h2>
                            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                                Autosave preserves your work. This action creates the immutable
                                target revision used by manual delivery or the worker.
                            </p>
                            {draftRequiresReview ? (
                                <p className="mt-3 max-w-2xl text-sm leading-6 text-state-attention">
                                    Resolve the profile validation issues before applying this draft
                                    to the selected target.
                                </p>
                            ) : null}
                        </div>
                        <span className="text-sm text-muted-foreground">
                            {draftDiffersFromTarget
                                ? 'Draft differs from selected target'
                                : 'Draft matches selected target'}
                        </span>
                    </div>
                    <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end">
                        <Field className="min-w-0 flex-1 gap-1.5">
                            <FieldLabel htmlFor="deliver-at">Deliver at</FieldLabel>
                            <Input
                                id="deliver-at"
                                type="datetime-local"
                                value={scheduleValue}
                                onChange={event => onScheduleChange(event.target.value)}
                                disabled={disabled}
                                className="min-w-0"
                            />
                            <FieldDescription className="text-xs">
                                Project time · {timeZone}. Clear the value to keep this publication
                                as a draft.
                            </FieldDescription>
                        </Field>
                        <Button className="sm:mb-5" onClick={onPromote} disabled={disabled}>
                            <CheckReadIcon aria-hidden="true" />
                            Apply draft to target
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </section>
    )
}
