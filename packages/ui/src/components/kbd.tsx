import type { ComponentProps } from 'react'

import { cn } from '../lib/utils'

function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
    return (
        <kbd
            data-slot="kbd"
            className={cn(
                'pointer-events-none inline-flex h-4 min-w-4 items-center justify-center rounded-sm bg-surface-field px-1 font-mono text-[0.625rem] leading-none font-[650] text-foreground shadow-none',
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
