import type { ComponentProps } from 'react'

import { cn } from '../lib/utils'

function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
    return (
        <kbd
            data-slot="kbd"
            className={cn(
                'pointer-events-none inline-flex h-5 min-w-5 items-center justify-center rounded-[min(var(--radius-md),8px)] bg-muted px-1.5 font-mono text-[0.65rem] leading-none font-medium text-muted-foreground shadow-control',
                className
            )}
            {...props}
        />
    )
}

function KbdGroup({ className, ...props }: ComponentProps<'div'>) {
    return (
        <div
            data-slot="kbd-group"
            className={cn('inline-flex items-center gap-1', className)}
            {...props}
        />
    )
}

export { Kbd, KbdGroup }
