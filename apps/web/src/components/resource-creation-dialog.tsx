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
import { AddIcon } from '@solar-icons/react/linear/add'
import type { FormEvent } from 'react'

import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

interface ResourceCreationDialogProps {
    readonly id: string
    readonly label: string
    readonly maxLength: number
    readonly onOpenChange: (open: boolean) => void
    readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void
    readonly onValueChange: (value: string) => void
    readonly open: boolean
    readonly pending: boolean
    readonly placeholder: string
    readonly submitLabel: string
    readonly title: string
    readonly value: string
}

export function ResourceCreationDialog({
    id,
    label,
    maxLength,
    onOpenChange,
    onSubmit,
    onValueChange,
    open,
    pending,
    placeholder,
    submitLabel,
    title,
    value,
}: ResourceCreationDialogProps) {
    useLanguage()

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[calc(100%-2rem)] max-w-sm">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>
                <form className="space-y-4" onSubmit={onSubmit}>
                    <Field className="gap-1.5">
                        <FieldLabel htmlFor={id}>{label}</FieldLabel>
                        <Input
                            id={id}
                            autoFocus
                            maxLength={maxLength}
                            onChange={event => onValueChange(event.target.value)}
                            placeholder={placeholder}
                            required
                            value={value}
                        />
                    </Field>
                    <DialogFooter>
                        <Button
                            disabled={pending}
                            onClick={() => onOpenChange(false)}
                            type="button"
                            variant="ghost">
                            {m.common_cancel()}
                        </Button>
                        <Button disabled={pending} type="submit">
                            <AddIcon aria-hidden="true" />
                            {submitLabel}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
