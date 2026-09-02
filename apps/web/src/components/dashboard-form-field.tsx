import { Field as UiField, FieldDescription, FieldLabel } from '@herald/ui/components/field'
import type { ReactNode } from 'react'

export function DashboardFormField({
    children,
    hint,
    htmlFor,
    label,
}: {
    readonly children: ReactNode
    readonly hint?: string
    readonly htmlFor?: string
    readonly label: string
}) {
    return (
        <UiField className="min-w-0 gap-1.5">
            <FieldLabel htmlFor={htmlFor} className="text-muted-foreground">
                {label}
            </FieldLabel>
            {children}
            {hint ? (
                <FieldDescription className="text-xs leading-5">{hint}</FieldDescription>
            ) : null}
        </UiField>
    )
}
