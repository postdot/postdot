import { Button } from '@postdot/ui/components/button'
import { Label } from '@postdot/ui/components/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@postdot/ui/components/select'
import { useId, useState } from 'react'

import * as m from '@/paraglide/messages.js'

export function ChannelManagementTransfer({
    projects,
    pending,
    onTransfer,
}: {
    projects: readonly { id: string; name: string }[]
    pending: boolean
    onTransfer: (projectId: string) => Promise<boolean>
}) {
    const id = useId()
    const [projectId, setProjectId] = useState<string | null>(null)
    const selected = projects.find(p => p.id === projectId)
    if (projects.length === 0) return null
    return (
        <section className="space-y-3">
            <h3 className="text-sm font-medium">{m.channel_transfer_title()}</h3>
            <p className="text-sm text-muted-foreground">{m.channel_transfer_description()}</p>
            <div className="space-y-2">
                <Label htmlFor={id}>{m.channel_transfer_project()}</Label>
                <Select
                    value={projectId}
                    onValueChange={setProjectId}
                    items={projects.map(p => ({ value: p.id, label: p.name }))}>
                    <SelectTrigger id={id} className="w-full" disabled={pending}>
                        <SelectValue placeholder={m.channel_transfer_choose()} />
                    </SelectTrigger>
                    <SelectContent>
                        {projects.map(project => (
                            <SelectItem key={project.id} value={project.id}>
                                {project.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            {selected ? (
                <p className="text-sm">
                    {m.channel_transfer_consequence({ project: selected.name })}
                </p>
            ) : null}
            <Button
                variant="outline"
                disabled={!selected || pending}
                onClick={async () => {
                    if (selected && (await onTransfer(selected.id))) setProjectId(null)
                }}>
                {m.channel_transfer_confirm()}
            </Button>
        </section>
    )
}
