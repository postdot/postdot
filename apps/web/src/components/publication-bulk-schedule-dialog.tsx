import { Button } from '@postdot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@postdot/ui/components/dialog'
import { Field, FieldLabel } from '@postdot/ui/components/field'
import { CalendarAddIcon } from '@solar-icons/react/linear/calendar-add'
import { useEffect, useState } from 'react'

import { DateTimePicker } from '@/components/date-time-picker'
import { dateTimeLocalErrorMessage, parseDateTimeLocal, toDateTimeLocal } from '@/lib/date-time'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export function PublicationBulkScheduleDialog({
    onOpenChange,
    onSchedule,
    open,
    pending,
    selectedCount,
    timeZone,
}: {
    readonly onOpenChange: (open: boolean) => void
    readonly onSchedule: (scheduledAt: number) => Promise<boolean>
    readonly open: boolean
    readonly pending: boolean
    readonly selectedCount: number
    readonly timeZone: string
}) {
    const { locale } = useLanguage()
    const [scheduleValue, setScheduleValue] = useState('')
    const [scheduleError, setScheduleError] = useState<string | null>(null)

    useEffect(() => {
        if (!open) return
        const nextHour = Math.ceil((Date.now() + 60 * 60 * 1_000) / 60_000) * 60_000
        setScheduleValue(toDateTimeLocal(nextHour, timeZone))
        setScheduleError(null)
    }, [open, timeZone])

    function handleSchedule() {
        const parsed = parseDateTimeLocal(scheduleValue, timeZone)
        if (parsed === null) {
            setScheduleError(m.queue_reschedule_required())
            return
        }
        if (typeof parsed !== 'number') {
            setScheduleError(dateTimeLocalErrorMessage(parsed))
            return
        }
        if (parsed < Date.now()) {
            setScheduleError(dateTimeLocalErrorMessage('past'))
            return
        }

        void onSchedule(parsed).then(succeeded => {
            if (succeeded) onOpenChange(false)
        })
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{m.queue_reschedule_title({ count: selectedCount })}</DialogTitle>
                </DialogHeader>

                <Field className="gap-1.5">
                    <FieldLabel htmlFor="bulk-publication-schedule">
                        {m.queue_reschedule_deliver_at()}
                    </FieldLabel>
                    <DateTimePicker
                        id="bulk-publication-schedule"
                        value={scheduleValue}
                        ariaInvalid={scheduleError !== null}
                        onChange={value => {
                            setScheduleValue(value)
                            setScheduleError(null)
                        }}
                        disabled={pending}
                        autoFocus
                        dateLabel={m.date_time_picker_date()}
                        locale={locale}
                        placeholder={m.date_time_picker_placeholder()}
                        timeLabel={m.date_time_picker_time()}
                        timeZone={timeZone}
                    />
                    {scheduleError !== null ? (
                        <p className="text-sm text-destructive" role="alert">
                            {scheduleError}
                        </p>
                    ) : null}
                </Field>

                <DialogFooter>
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        disabled={pending}>
                        {m.common_cancel()}
                    </Button>
                    <Button type="button" onClick={handleSchedule} disabled={pending}>
                        <CalendarAddIcon aria-hidden="true" />
                        {m.queue_reschedule_submit()}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
