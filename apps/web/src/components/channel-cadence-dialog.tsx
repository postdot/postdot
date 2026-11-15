import { Alert, AlertDescription } from '@postdot/ui/components/alert'
import { Button } from '@postdot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@postdot/ui/components/dialog'
import { Input } from '@postdot/ui/components/input'
import { Label } from '@postdot/ui/components/label'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { TimeZoneCombobox } from '@/components/time-zone-combobox'
import { api, ApiError, formatApiError, type Channel } from '@/lib/api'
import * as m from '@/paraglide/messages.js'

export function ChannelCadenceDialog({
    channel,
    projectId,
    workspaceId,
    timeZone,
    onClose,
    onChanged,
}: {
    channel: Pick<Channel, 'id' | 'name'>
    projectId?: string
    workspaceId?: string
    timeZone: string
    onClose: () => void
    onChanged: () => Promise<void>
}) {
    const query = useQuery({
        queryKey: ['channel-cadence', workspaceId, projectId, channel.id],
        queryFn: () =>
            workspaceId
                ? api.getWorkspaceChannelCadence(workspaceId, channel.id)
                : api.getChannelCadence(projectId!, channel.id),
    })
    return (
        <Dialog
            open
            onOpenChange={open => {
                if (!open) onClose()
            }}>
            <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden">
                <DialogHeader>
                    <DialogTitle>{m.cadence_title({ channel: channel.name })}</DialogTitle>
                    <DialogDescription>{m.cadence_description()}</DialogDescription>
                </DialogHeader>
                {query.isPending ? <p role="status">{m.cadence_loading()}</p> : null}
                {query.isError ? (
                    <Alert variant="destructive">
                        <AlertDescription>{formatApiError(query.error)}</AlertDescription>
                        <Button variant="outline" onClick={() => void query.refetch()}>
                            {m.cadence_retry()}
                        </Button>
                    </Alert>
                ) : null}
                {query.data ? (
                    <CadenceForm
                        key={query.data.rules?.revision ?? 0}
                        data={query.data}
                        timeZone={timeZone}
                        onConfigure={input =>
                            workspaceId
                                ? api.configureWorkspaceChannelCadence(
                                      workspaceId,
                                      channel.id,
                                      input
                                  )
                                : api.configureChannelCadence(projectId!, channel.id, input)
                        }
                        onReload={() => query.refetch()}
                        onSaved={async () => {
                            await query.refetch()
                            await onChanged()
                            onClose()
                        }}
                    />
                ) : null}
            </DialogContent>
        </Dialog>
    )
}
function CadenceForm({
    data,
    timeZone,
    onConfigure,
    onSaved,
    onReload,
}: {
    data: Awaited<ReturnType<typeof api.getChannelCadence>>
    timeZone: string
    onConfigure: (input: Parameters<typeof api.configureChannelCadence>[2]) => Promise<unknown>
    onReload: () => Promise<unknown>
    onSaved: () => Promise<void>
}) {
    const [zone, setZone] = useState(data.rules?.timeZone ?? timeZone)
    const [daily, setDaily] = useState(data.rules?.dailyMax?.toString() ?? '')
    const [weekly, setWeekly] = useState(data.rules?.weeklyMax?.toString() ?? '')
    const [spacing, setSpacing] = useState(
        data.rules?.minimumIntervalMs ? String(data.rules.minimumIntervalMs / 60000) : ''
    )
    const [error, setError] = useState<string | null>(null)
    const [pending, setPending] = useState(false)
    const [stale, setStale] = useState(false)
    const disabled = pending || !data.canManage
    const limit = (
        id: string,
        label: string,
        before: string,
        after: string,
        value: string,
        set: (value: string) => void
    ) => (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span>{before}</span>
            <Input
                id={id}
                aria-label={label}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                className="w-20 tabular-nums"
                value={value}
                disabled={disabled}
                onChange={event => set(event.target.value)}
            />
            <span>{after}</span>
        </div>
    )
    return (
        <form
            className="flex min-h-0 flex-col gap-5"
            onSubmit={async event => {
                event.preventDefault()
                setPending(true)
                setError(null)
                try {
                    await onConfigure({
                        expectedRevision: data.rules?.revision ?? 0,
                        timeZone: zone,
                        dailyMax: daily === '' ? null : Number(daily),
                        weeklyMax: weekly === '' ? null : Number(weekly),
                        minimumIntervalMs:
                            spacing === '' ? null : Math.round(Number(spacing) * 60000),
                    })
                    await onSaved()
                } catch (caught) {
                    setError(formatApiError(caught))
                    setStale(caught instanceof ApiError && caught.code === 'write_conflict')
                } finally {
                    setPending(false)
                }
            }}>
            <div className="min-h-0 space-y-5 overflow-y-auto px-0.5 pb-1">
                <div className="space-y-3">
                    {limit(
                        'cadence-daily',
                        m.cadence_daily(),
                        m.cadence_at_most(),
                        m.cadence_unit_day(),
                        daily,
                        setDaily
                    )}
                    {limit(
                        'cadence-weekly',
                        m.cadence_weekly(),
                        m.cadence_at_most(),
                        m.cadence_unit_week(),
                        weekly,
                        setWeekly
                    )}
                    <p className="text-xs text-muted-foreground">{m.cadence_limits_hint()}</p>
                </div>
                <div className="space-y-2">
                    {limit(
                        'cadence-spacing',
                        m.cadence_spacing(),
                        m.cadence_at_least(),
                        m.cadence_unit_minutes(),
                        spacing,
                        setSpacing
                    )}
                    <p className="text-xs text-muted-foreground">{m.cadence_spacing_hint()}</p>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="cadence-timezone">{m.cadence_timezone()}</Label>
                    <TimeZoneCombobox
                        id="cadence-timezone"
                        label={m.cadence_timezone()}
                        value={zone}
                        disabled={disabled}
                        onValueChange={setZone}
                    />
                </div>
                {error ? (
                    <Alert variant="destructive" role="alert">
                        <AlertDescription>{error}</AlertDescription>
                        {stale ? (
                            <Button variant="outline" onClick={() => void onReload()}>
                                {m.cadence_reload()}
                            </Button>
                        ) : null}
                    </Alert>
                ) : null}
            </div>
            {data.canManage ? (
                <DialogFooter>
                    <Button type="submit" disabled={pending}>
                        {m.cadence_save()}
                    </Button>
                </DialogFooter>
            ) : null}
        </form>
    )
}
