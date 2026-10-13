import { Input as InputPrimitive } from '@base-ui/react/input'
import * as React from 'react'

import { cn } from '../lib/utils'

const inputClassName =
    'h-10 w-full min-w-0 rounded-md border border-input bg-surface-field px-3 py-2 text-base shadow-field transition-[background-color,border-color,color,box-shadow] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-field-focus focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-field-focus disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
    return (
        <InputPrimitive
            type={type}
            data-slot="input"
            className={cn(inputClassName, className)}
            {...props}
        />
    )
}

export { Input, inputClassName }
