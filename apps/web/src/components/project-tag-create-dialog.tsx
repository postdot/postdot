import { Button } from '@postbot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@postbot/ui/components/dialog'
import { Field, FieldError, FieldLabel } from '@postbot/ui/components/field'
import { Input } from '@postbot/ui/components/input'
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'

import { useLanguage } from '@/lib/i18n'
import { formatProjectTagMutationError } from '@/lib/project-tags'
import * as m from '@/paraglide/messages.js'

interface ProjectTagDialogProps {
    readonly initialName?: string
    readonly onOpenChange: (open: boolean) => void
    readonly onSubmit: (name: string) => Promise<void>
    readonly open: boolean
    readonly submitIcon?: ReactNode
    readonly submitLabel: string
    readonly title: string
}

export function ProjectTagDialog({
    initialName = '',
    onOpenChange,
    onSubmit,
    open,
    submitIcon,
    submitLabel,
    title,
}: ProjectTagDialogProps) {
    useLanguage()
    const inputId = useId()
    const [name, setName] = useState(initialName)
    const [error, setError] = useState<string | null>(null)
    const [pending, setPending] = useState(false)

    useEffect(() => {
        if (!open) return
        setName(initialName)
        setError(null)
    }, [initialName, open])

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        // Portal events still bubble through the surrounding publication form.
        event.stopPropagation()
        const trimmedName = name.trim()
        if (trimmedName === '' || pending) return

        setPending(true)
        setError(null)
        try {
            await onSubmit(trimmedName)
            onOpenChange(false)
        } catch (caughtError) {
            setError(formatProjectTagMutationError(caughtError))
        } finally {
            setPending(false)
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={nextOpen => {
                if (nextOpen || !pending) onOpenChange(nextOpen)
            }}>
            <DialogContent className="w-[calc(100%-2rem)] max-w-sm">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>
                <form className="space-y-4" onSubmit={handleSubmit}>
                    <Field className="gap-1.5">
                        <FieldLabel htmlFor={inputId}>{m.project_tags_name()}</FieldLabel>
                        <Input
                            id={inputId}
                            aria-invalid={error !== null}
                            autoFocus
                            disabled={pending}
                            maxLength={120}
                            onChange={event => setName(event.target.value)}
                            placeholder={m.project_tags_name_placeholder()}
                            required
                            value={name}
                        />
                        <FieldError errors={error === null ? [] : [{ message: error }]} />
                    </Field>
                    <DialogFooter>
                        <Button
                            disabled={pending}
                            onClick={() => onOpenChange(false)}
                            type="button"
                            variant="ghost">
                            {m.common_cancel()}
                        </Button>
                        <Button
                            aria-busy={pending}
                            disabled={pending || name.trim() === ''}
                            type="submit">
                            {submitIcon}
                            {submitLabel}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
