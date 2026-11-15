import { Button } from '@postdot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@postdot/ui/components/dialog'
import { Field, FieldLabel } from '@postdot/ui/components/field'
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
import { formatProjectDateTime } from '@/lib/date-time'
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
    const offset = Number(amount) * Number(unit) * Number(direction) * 3_600_000
    const valid =
        Number.isSafeInteger(offset) &&
        Number.isSafeInteger(Number(amount)) &&
        Number(amount) > 0 &&
        publications.length > 0 &&
        publications.every(
            p => p.scheduledAt !== null && Math.abs(p.scheduledAt + offset) <= 8_640_000_000_000_000
        )
    const times = Object.fromEntries(publications.map(p => [p.id, (p.scheduledAt ?? 0) + offset]))
    const values = Object.values(times)
    const blocked = valid ? publications.filter(p => times[p.id]! <= Date.now()) : []
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{m.calendar_move_by()}</DialogTitle>
                </DialogHeader>
                <div className="min-h-0 space-y-4 overflow-y-auto">
                    <Field>
                        <FieldLabel htmlFor="move-amount">{m.calendar_move_amount()}</FieldLabel>
                        <Input
                            id="move-amount"
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
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="move-unit">{m.calendar_move_unit()}</FieldLabel>
                        <Select
                            value={unit}
                            onValueChange={v => {
                                if (v) setUnit(v)
                            }}>
                            <SelectTrigger id="move-unit" disabled={pending}>
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
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="move-direction">
                            {m.calendar_move_direction()}
                        </FieldLabel>
                        <Select
                            value={direction}
                            onValueChange={v => {
                                if (v) setDirection(v)
                            }}>
                            <SelectTrigger id="move-direction" disabled={pending}>
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
                    </Field>
                    {valid ? (
                        <p className="text-sm text-muted-foreground" data-move-preview="true">
                            {m.calendar_move_range({
                                first: formatProjectDateTime(Math.min(...values), timeZone, locale),
                                last: formatProjectDateTime(Math.max(...values), timeZone, locale),
                            })}{' '}
                            · {timeZone}
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
                        {m.queue_reschedule_submit()}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
