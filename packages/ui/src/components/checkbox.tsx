'use client'

import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import type { ComponentProps } from 'react'

import { cn } from '../lib/utils'

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
    return (
        <CheckboxPrimitive.Root
            data-slot="checkbox"
            className={cn(
                'flex size-4 shrink-0 items-center justify-center rounded-sm border border-input bg-input/30 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground data-disabled:cursor-not-allowed data-disabled:opacity-50',
                className
            )}
            {...props}>
            <CheckboxPrimitive.Indicator>
                <svg viewBox="0 0 16 16" fill="none" className="size-3.5" aria-hidden="true">
                    <path d="m3 8 3 3 7-7" stroke="currentColor" strokeWidth="2" />
                </svg>
            </CheckboxPrimitive.Indicator>
        </CheckboxPrimitive.Root>
    )
}
