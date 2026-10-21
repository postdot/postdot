import { TZDate } from '@date-fns/tz'
import { Button } from '@postdot/ui/components/button'
import { Calendar, calendarLocales } from '@postdot/ui/components/calendar'
import { Input } from '@postdot/ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@postdot/ui/components/popover'
import { cn } from '@postdot/ui/lib/utils'
import { CalendarMinimalisticIcon } from '@solar-icons/react/linear/calendar-minimalistic'
import { ClockCircleIcon } from '@solar-icons/react/linear/clock-circle'
import { useEffect, useMemo, useState } from 'react'

import { getZonedDateTimeParts } from '@/lib/date-time'

interface CivilDateTime {
    readonly year: number
    readonly month: number
    readonly day: number
    readonly hour: number
    readonly minute: number
}

export interface DateTimePickerProps {
    readonly ariaInvalid?: boolean
    readonly autoFocus?: boolean
    readonly clearLabel?: string
    readonly dateLabel: string
    readonly disabled?: boolean
    readonly displayLocale?: string
    readonly id: string
    readonly locale?: 'en' | 'fr'
    readonly onChange: (value: string) => void
    readonly placeholder: string
    readonly required?: boolean
    readonly timeLabel: string
    readonly timeZone: string
    readonly value: string
}

export function DateTimePicker({
    ariaInvalid = false,
    autoFocus = false,
    clearLabel,
    dateLabel,
    disabled = false,
    displayLocale,
    id,
    locale = 'en',
    onChange,
    placeholder,
    required = false,
    timeLabel,
    timeZone,
    value,
}: DateTimePickerProps) {
    const [open, setOpen] = useState(false)
    const parsedValue = useMemo(() => parseCivilDateTime(value), [value])
    const today = useMemo(() => todayInTimeZone(timeZone), [timeZone])
    const lastSelectableMonth = useMemo(
        () => makeTimeZoneDate(today.getFullYear() + 10, 12, 31, timeZone),
        [today, timeZone]
    )
    const selectedDate = useMemo(
        () =>
            parsedValue === null
                ? undefined
                : makeTimeZoneDate(parsedValue.year, parsedValue.month, parsedValue.day, timeZone),
        [parsedValue, timeZone]
    )
    const [visibleMonth, setVisibleMonth] = useState<Date>(selectedDate ?? today)
    const [draftTime, setDraftTime] = useState(() => formatTime(parsedValue))
    const [timeInput, setTimeInput] = useState(() => formatTime(parsedValue))

    useEffect(() => {
        const nextTime = formatTime(parsedValue)
        setDraftTime(nextTime)
        setTimeInput(nextTime)
    }, [parsedValue])

    const formattedValue = formatDisplayValue(value, parsedValue, displayLocale ?? locale)
    const calendarLocale = calendarLocales[locale]

    function handleOpenChange(nextOpen: boolean) {
        setOpen(nextOpen)
        if (nextOpen) setVisibleMonth(selectedDate ?? today)
    }

    function updateDate(date: Date | undefined) {
        if (date === undefined) return
        const parts = getZonedDateTimeParts(date.getTime(), timeZone)
        const nextTime = draftTime || '09:00'
        onChange(formatCivilDateTime(parts.year, parts.month, parts.day, nextTime))
    }

    function updateTime(nextTime: string) {
        setDraftTime(nextTime)
        setTimeInput(nextTime)
        if (parsedValue === null) return
        onChange(
            formatCivilDateTime(parsedValue.year, parsedValue.month, parsedValue.day, nextTime)
        )
    }

    function handleTimeInputChange(nextValue: string) {
        const nextInput = formatTimeInput(nextValue)
        setTimeInput(nextInput)

        if (parseTimeInput(nextInput) !== null) updateTime(nextInput)
    }

    function commitTimeInput() {
        const nextTime = parseTimeInput(timeInput)
        if (nextTime === null) {
            setTimeInput(draftTime)
            return
        }
        updateTime(nextTime)
    }

    return (
        <Popover open={open} onOpenChange={handleOpenChange}>
            <PopoverTrigger
                render={
                    <Button
                        id={id}
                        type="button"
                        variant="ghost"
                        disabled={disabled}
                        autoFocus={autoFocus}
                        aria-expanded={open}
                        aria-haspopup="dialog"
                        aria-invalid={ariaInvalid || undefined}
                        aria-required={required || undefined}
                        className={cn(
                            'h-10 w-full justify-between bg-surface-field px-3 text-left font-normal text-foreground shadow-none hover:bg-surface-field-hover aria-expanded:bg-surface-field-hover',
                            !formattedValue && 'text-muted-foreground',
                            ariaInvalid && 'bg-destructive/5 text-destructive'
                        )}>
                        <span className="min-w-0 truncate">{formattedValue || placeholder}</span>
                        <CalendarMinimalisticIcon aria-hidden="true" className="size-4" />
                    </Button>
                }
            />
            <PopoverContent
                align="start"
                className="w-fit max-w-[calc(100vw-1rem)] bg-popover p-3"
                role="dialog"
                aria-label={dateLabel}>
                <Calendar
                    captionLayout="dropdown"
                    mode="single"
                    selected={selectedDate}
                    onSelect={updateDate}
                    month={visibleMonth}
                    onMonthChange={setVisibleMonth}
                    locale={calendarLocale}
                    timeZone={timeZone}
                    today={today}
                    startMonth={today}
                    endMonth={lastSelectableMonth}
                    disabled={{ before: today }}
                    autoFocus
                />
                <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-surface-inset/45 px-2.5 py-2">
                    <label
                        htmlFor={`${id}-time`}
                        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <ClockCircleIcon aria-hidden="true" className="size-4" />
                        {timeLabel}
                    </label>
                    <Input
                        id={`${id}-time`}
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={5}
                        placeholder="09:00"
                        value={timeInput}
                        onChange={event => handleTimeInputChange(event.target.value)}
                        onBlur={commitTimeInput}
                        disabled={disabled}
                        aria-label={timeLabel}
                        className="h-8 w-[5.5rem] bg-surface-field px-2 text-center text-sm tabular-nums"
                    />
                </div>
                {clearLabel && value !== '' ? (
                    <div className="mt-2 flex justify-end">
                        <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            disabled={disabled}
                            onClick={() => {
                                onChange('')
                                setOpen(false)
                            }}>
                            {clearLabel}
                        </Button>
                    </div>
                ) : null}
            </PopoverContent>
        </Popover>
    )
}

function parseCivilDateTime(value: string): CivilDateTime | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
    if (match === null) return null

    const parts = {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
        hour: Number(match[4]),
        minute: Number(match[5]),
    }
    if (
        parts.month < 1 ||
        parts.month > 12 ||
        parts.day < 1 ||
        parts.day > daysInMonth(parts.year, parts.month) ||
        parts.hour < 0 ||
        parts.hour > 23 ||
        parts.minute < 0 ||
        parts.minute > 59
    ) {
        return null
    }
    return parts
}

function formatCivilDateTime(year: number, month: number, day: number, time: string) {
    return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}T${time}`
}

function formatTime(parts: CivilDateTime | null) {
    if (parts === null) return '09:00'
    return `${parts.hour.toString().padStart(2, '0')}:${parts.minute.toString().padStart(2, '0')}`
}

function formatTimeInput(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 4)
    if (digits.length <= 2) return digits
    return `${digits.slice(0, 2)}:${digits.slice(2)}`
}

function parseTimeInput(value: string) {
    const match = /^(\d{2}):(\d{2})$/.exec(value)
    if (match === null) return null

    const hour = Number(match[1])
    const minute = Number(match[2])
    if (hour > 23 || minute > 59) return null
    return `${match[1]}:${match[2]}`
}

function formatDisplayValue(value: string, parts: CivilDateTime | null, locale: string) {
    if (parts === null) return value
    const date = new Date(
        Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
    )
    return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
    }).format(date)
}

function todayInTimeZone(timeZone: string) {
    const parts = getZonedDateTimeParts(Date.now(), timeZone)
    return makeTimeZoneDate(parts.year, parts.month, parts.day, timeZone)
}

function makeTimeZoneDate(year: number, month: number, day: number, timeZone: string) {
    try {
        return new TZDate(year, month - 1, day, timeZone)
    } catch {
        return new TZDate(year, month - 1, day, 'UTC')
    }
}

function daysInMonth(year: number, month: number) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    if (month === 2) return leapYear ? 29 : 28
    return [4, 6, 9, 11].includes(month) ? 30 : 31
}
