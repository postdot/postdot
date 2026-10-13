import { MagnifierIcon } from '@solar-icons/react/linear/magnifier'
import { Command as CommandPrimitive } from 'cmdk'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from '../lib/utils'
import { Dialog, DialogContent, DialogTitle } from './dialog'

function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
    return (
        <CommandPrimitive
            data-slot="command"
            className={cn(
                'flex flex-col overflow-hidden bg-popover text-popover-foreground',
                className
            )}
            {...props}
        />
    )
}

function CommandDialog({
    title,
    children,
    contentClassName,
    ...props
}: Omit<ComponentProps<typeof Dialog>, 'children'> & {
    title: string
    children: ReactNode
    contentClassName?: string
}) {
    return (
        <Dialog {...props}>
            <DialogContent
                className={cn(
                    'w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0 sm:max-w-xl',
                    contentClassName
                )}
                showCloseButton={false}>
                <DialogTitle className="sr-only">{title}</DialogTitle>
                {children}
            </DialogContent>
        </Dialog>
    )
}

function CommandInput({ className, ...props }: ComponentProps<typeof CommandPrimitive.Input>) {
    return (
        <div className="m-3 mb-0 flex items-center gap-3 rounded-md border border-input bg-surface-field px-3 focus-within:border-field-focus focus-within:inset-ring-1 focus-within:inset-ring-field-focus">
            <MagnifierIcon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
            <CommandPrimitive.Input
                className={cn(
                    'h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground',
                    className
                )}
                {...props}
            />
        </div>
    )
}

function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
    return (
        <CommandPrimitive.List
            className={cn(
                'max-h-[min(24rem,60dvh)] overflow-y-auto overflow-x-hidden p-2',
                className
            )}
            {...props}
        />
    )
}

function CommandEmpty(props: ComponentProps<typeof CommandPrimitive.Empty>) {
    return (
        <CommandPrimitive.Empty
            className="px-3 py-8 text-center text-sm text-muted-foreground"
            {...props}
        />
    )
}

function CommandGroup({ className, ...props }: ComponentProps<typeof CommandPrimitive.Group>) {
    return (
        <CommandPrimitive.Group
            className={cn(
                '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground',
                className
            )}
            {...props}
        />
    )
}

function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
    return (
        <CommandPrimitive.Item
            className={cn(
                'flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm outline-none data-[selected=true]:bg-surface-selected data-[selected=true]:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
                className
            )}
            {...props}
        />
    )
}

export {
    Command,
    CommandDialog,
    CommandInput,
    CommandList,
    CommandEmpty,
    CommandGroup,
    CommandItem,
}
