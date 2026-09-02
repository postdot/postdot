import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'

import { cn } from '../lib/utils'

const badgeVariants = cva(
    'inline-flex items-center justify-center gap-1.5 rounded-sm border px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[background-color,border-color,color] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
    {
        variants: {
            variant: {
                default: 'border-transparent bg-primary/15 text-primary',
                secondary: 'border-transparent bg-secondary text-secondary-foreground',
                outline: 'border-border bg-transparent text-muted-foreground',
                destructive:
                    'border-transparent bg-destructive/10 text-destructive dark:bg-destructive/20',
            },
        },
        defaultVariants: {
            variant: 'default',
        },
    }
)

function Badge({
    className,
    variant = 'default',
    ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
    return (
        <span data-slot="badge" className={cn(badgeVariants({ variant, className }))} {...props} />
    )
}

export { Badge, badgeVariants }
