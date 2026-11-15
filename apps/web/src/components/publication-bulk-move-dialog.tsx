import { Button } from '@postdot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@postdot/ui/components/dialog'
import { Input } from '@postdot/ui/components/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@postdot/ui/components/select'
import { useState } from 'react'

import type { PublicationSummary } from '@/lib/api'
import {
    dateTimeLocalErrorMessage,
    getBrowserTimeZone,
    moveProjectSchedule,
    formatProjectDateTime,
} from '@/lib/date-time'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export function PublicationBulkMoveDialog({
    open,
    onOpenChange,
    publications,
    pending,
    timeZone,
    onMove,
}: {
    readonly open: boolean
    readonly onOpenChange: (open: boolean) => void
    readonly publications: readonly PublicationSummary[]
    readonly pending: boolean
    readonly timeZone: string
    readonly onMove: (times: Record<string, number>) => Promise<boolean>
}) {
    const { locale } = useLanguage()
    const [amount, setAmount] = useState('1')
    const [unit, setUnit] = useState('24')
    const [direction, setDirection] = useState('1')
    const [expired, setExpired] = useState(false)
    const results = publications.map(
        p =>
            [
                p.id,
                p.scheduledAt === null
                    ? null
                    : moveProjectSchedule(
                          p.scheduledAt,
                          Number(amount) * Number(direction),
                          unit,
                          timeZone
                      ),
            ] as const
    )
    const error = results.find(([, at]) => typeof at === 'string')?.[1]
    const valid =
        Number.isSafeInteger(Number(amount)) &&
        Number(amount) > 0 &&
        publications.length > 0 &&
        results.every(
            ([, at]) =>
                typeof at === 'number' &&
                Number.isFinite(at) &&
                Math.abs(at) <= 8_640_000_000_000_000
        )
    const times = Object.fromEntries(
        results.map(([id, at]) => [id, typeof at === 'number' ? at : 0])
    )
    const values = Object.values(times)
    const blocked = valid ? publications.filter(p => times[p.id]! <= Date.now()) : []
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{m.calendar_move_by()}</DialogTitle>
                </DialogHeader>
                <div className="min-h-0 space-y-4 overflow-y-auto">
                    <div className="flex flex-wrap items-center gap-2">
                        <span>{m.calendar_move_action()}</span>
                        <Input
                            id="move-amount"
                            aria-label={m.calendar_move_amount()}
                            className="w-16"
                            type="number"
                            min="1"
                            step="1"
                            value={amount}
                            onChange={e => {
                                setAmount(e.target.value)
                                setExpired(false)
                            }}
                            disabled={pending}
                        />

                        <Select
                            value={unit}
                            onValueChange={v => {
                                if (v) setUnit(v)
                            }}>
                            <SelectTrigger
                                id="move-unit"
                                aria-label={m.calendar_move_unit()}
                                className="w-auto"
                                disabled={pending}>
                                <SelectValue>
                                    {unit === '1'
                                        ? m.calendar_move_hours()
                                        : unit === '24'
                                          ? m.calendar_move_days()
                                          : m.calendar_move_weeks()}
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                                {[
                                    ['1', m.calendar_move_hours()],
                                    ['24', m.calendar_move_days()],
                                    ['168', m.calendar_move_weeks()],
                                ].map(([value, label]) => (
                                    <SelectItem key={value} value={value!}>
                                        {label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        <Select
                            value={direction}
                            onValueChange={v => {
                                if (v) setDirection(v)
                            }}>
                            <SelectTrigger
                                id="move-direction"
                                aria-label={m.calendar_move_direction()}
                                className="w-auto"
                                disabled={pending}>
                                <SelectValue>
                                    {direction === '1'
                                        ? m.calendar_move_forward()
                                        : m.calendar_move_back()}
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="1">{m.calendar_move_forward()}</SelectItem>
                                <SelectItem value="-1">{m.calendar_move_back()}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {typeof error === 'string' ? (
                        <p role="alert" className="text-sm text-destructive">
                            {dateTimeLocalErrorMessage(error)}
                        </p>
                    ) : null}
                    {valid ? (
                        <p className="text-sm text-muted-foreground" data-move-preview="true">
                            {formatProjectDateTime(
                                Math.min(...publications.map(p => p.scheduledAt!)),
                                timeZone,
                                locale
                            )}{' '}
                            → {formatProjectDateTime(Math.max(...values), timeZone, locale)}{' '}
                            {timeZone !== getBrowserTimeZone() ? `· ${timeZone}` : null}
                        </p>
                    ) : null}
                    {blocked.length > 0 || expired ? (
                        <div role="alert" className="text-sm text-destructive">
                            <p>{m.calendar_move_past()}</p>
                            {blocked.map(p => (
                                <p key={p.id}>
                                    {p.postTitle ?? p.sourceExcerpt} · {p.channelName}
                                </p>
                            ))}
                        </div>
                    ) : null}
                </div>
                <DialogFooter>
                    <Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
                        {m.common_cancel()}
                    </Button>
                    <Button
                        disabled={pending || !valid || blocked.length > 0}
                        onClick={() => {
                            if (values.some(at => at <= Date.now())) {
                                setExpired(true)
                                return
                            }
                            void onMove(times).then(ok => {
                                if (ok) onOpenChange(false)
                            })
                        }}>
                        {publications.length === 1
                            ? m.calendar_move_submit_one()
                            : m.calendar_move_submit_many({ count: publications.length })}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
