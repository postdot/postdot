import { Button } from '@postdot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@postdot/ui/components/dialog'
import { useEffect, useSyncExternalStore } from 'react'

import { cadencePrompts } from '@/lib/cadence-confirmation'
import * as m from '@/paraglide/messages.js'

export function CadenceConfirmationDialog({
    channels,
}: {
    channels: readonly { id: string; name: string }[]
}) {
    useEffect(() => () => cadencePrompts.getSnapshot()?.resolve(false), [])
    const prompt = useSyncExternalStore(cadencePrompts.subscribe, cadencePrompts.getSnapshot)
    return (
        <Dialog
            open={prompt !== null}
            onOpenChange={open => {
                if (!open) prompt?.resolve(false)
            }}>
            <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden">
                <DialogHeader>
                    <DialogTitle>{m.cadence_conflict_title()}</DialogTitle>
                    <DialogDescription>{m.cadence_conflict_description()}</DialogDescription>
                </DialogHeader>
                <ul className="min-h-0 space-y-2 overflow-y-auto text-sm">
                    {prompt?.warnings.map((warning, index) => (
                        <li key={index}>
                            <span className="font-medium">
                                {channels.find(channel => channel.id === warning.channelId)?.name}
                            </span>
                            {' · '}
                            {warning.rule === 'daily_max'
                                ? m.cadence_daily_warning({
                                      period: warning.period,
                                      count: warning.count,
                                      maximum: warning.maximum,
                                  })
                                : m.cadence_weekly_warning({
                                      period: warning.period,
                                      count: warning.count,
                                      maximum: warning.maximum,
                                  })}
                        </li>
                    ))}
                </ul>
                <DialogFooter>
                    <Button variant="outline" onClick={() => prompt?.resolve(false)}>
                        {m.cadence_cancel()}
                    </Button>
                    <Button onClick={() => prompt?.resolve(true)}>{m.cadence_confirm()}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
