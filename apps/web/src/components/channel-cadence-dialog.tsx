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
    const fields = [
        {
            id: 'cadence-timezone',
            label: m.cadence_timezone(),
            value: zone,
            set: setZone,
            type: 'text',
        },
        {
            id: 'cadence-daily',
            label: m.cadence_daily(),
            value: daily,
            set: setDaily,
            type: 'number',
        },
        {
            id: 'cadence-weekly',
            label: m.cadence_weekly(),
            value: weekly,
            set: setWeekly,
            type: 'number',
        },
        {
            id: 'cadence-spacing',
            label: m.cadence_spacing(),
            value: spacing,
            set: setSpacing,
            type: 'number',
        },
    ]
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
            <div className="min-h-0 space-y-4 overflow-y-auto">
                <p className="text-sm text-muted-foreground">{m.cadence_empty_disables()}</p>
                {fields.map(field => (
                    <div key={field.id} className="space-y-2">
                        <Label htmlFor={field.id}>{field.label}</Label>
                        <Input
                            id={field.id}
                            type={field.type}
                            min={
                                field.id === 'cadence-spacing'
                                    ? 1 / 60000
                                    : field.type === 'number'
                                      ? 1
                                      : undefined
                            }
                            step={
                                field.id === 'cadence-spacing'
                                    ? 'any'
                                    : field.type === 'number'
                                      ? 1
                                      : undefined
                            }
                            value={field.value}
                            disabled={pending || !data.canManage}
                            onChange={event => field.set(event.target.value)}
                        />
                    </div>
                ))}
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
