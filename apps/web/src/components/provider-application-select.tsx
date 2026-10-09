import { Field, FieldLabel } from '@herald/ui/components/field'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@herald/ui/components/select'

import type { ProviderApplication } from '@/lib/api'
import * as m from '@/paraglide/messages.js'

interface ProviderApplicationSelectProps {
    readonly applications: readonly ProviderApplication[]
    readonly disabled: boolean
    readonly id: string
    readonly onValueChange: (value: string) => void
    readonly value: string
}

export function ProviderApplicationSelect({
    applications,
    disabled,
    id,
    onValueChange,
    value,
}: ProviderApplicationSelectProps) {
    if (applications.length < 2) return null

    return (
        <Field className="gap-1.5">
            <FieldLabel htmlFor={id}>{m.provider_apps_select()}</FieldLabel>
            <Select
                value={value}
                onValueChange={nextValue => {
                    if (typeof nextValue === 'string') onValueChange(nextValue)
                }}>
                <SelectTrigger id={id} disabled={disabled}>
                    <SelectValue>
                        {applications.find(application => application.id === value)?.name}
                    </SelectValue>
                </SelectTrigger>
                <SelectContent>
                    {applications.map(application => (
                        <SelectItem key={application.id} value={application.id}>
                            {application.name}
                            {application.isDefault ? ` · ${m.provider_apps_default()}` : ''}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </Field>
    )
}
