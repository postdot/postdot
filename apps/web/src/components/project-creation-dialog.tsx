import { Field, FieldLabel } from '@postdot/ui/components/field'
import type { FormEvent } from 'react'

import { ResourceCreationDialog } from '@/components/resource-creation-dialog'
import { TimeZoneCombobox } from '@/components/time-zone-combobox'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

interface ProjectCreationDialogProps {
    readonly id: string
    readonly name: string
    readonly onNameChange: (value: string) => void
    readonly onOpenChange: (open: boolean) => void
    readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void
    readonly onTimeZoneChange: (timeZone: string) => void
    readonly open: boolean
    readonly pending: boolean
    readonly timeZone: string
}

export function ProjectCreationDialog({
    id,
    name,
    onNameChange,
    onOpenChange,
    onSubmit,
    onTimeZoneChange,
    open,
    pending,
    timeZone,
}: ProjectCreationDialogProps) {
    useLanguage()
    const timeZoneId = `${id}-timezone`

    return (
        <ResourceCreationDialog
            id={id}
            label={m.nav_new_project()}
            maxLength={120}
            onOpenChange={onOpenChange}
            onSubmit={onSubmit}
            onValueChange={onNameChange}
            open={open}
            pending={pending}
            placeholder={m.nav_project_name()}
            submitLabel={m.nav_add_project()}
            title={m.nav_create_project()}
            value={name}>
            <Field className="gap-1.5">
                <FieldLabel htmlFor={timeZoneId}>{m.project_timezone_label()}</FieldLabel>
                <TimeZoneCombobox
                    disabled={pending}
                    id={timeZoneId}
                    label={m.project_timezone_label()}
                    onValueChange={onTimeZoneChange}
                    value={timeZone}
                />
            </Field>
        </ResourceCreationDialog>
    )
}
