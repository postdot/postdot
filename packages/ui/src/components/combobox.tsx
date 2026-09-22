import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox'
import { AltArrowDownIcon } from '@solar-icons/react/linear/alt-arrow-down'
import { CheckIcon } from '@solar-icons/react/linear/check'
import * as React from 'react'

import { cn } from '../lib/utils'

const Combobox = ComboboxPrimitive.Root

function ComboboxLabel({ className, ...props }: ComboboxPrimitive.Label.Props) {
    return (
        <ComboboxPrimitive.Label data-slot="combobox-label" className={cn(className)} {...props} />
    )
}

function ComboboxTrigger({ className, children, ...props }: ComboboxPrimitive.Trigger.Props) {
    return (
        <ComboboxPrimitive.Trigger
            data-slot="combobox-trigger"
            className={cn(
                'flex h-10 w-full items-center justify-between gap-2 rounded-md bg-sidebar-accent/45 px-2.5 text-sm whitespace-nowrap shadow-none transition-[background-color,box-shadow] outline-none select-none hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-sidebar-accent disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
                className
            )}
            {...props}>
            {children}
            <ComboboxPrimitive.Icon
                render={
                    <AltArrowDownIcon
                        aria-hidden="true"
                        className="pointer-events-none size-4 shrink-0 text-muted-foreground"
                    />
                }
            />
        </ComboboxPrimitive.Trigger>
    )
}

const ComboboxValue = ComboboxPrimitive.Value

function ComboboxPortal({ ...props }: ComboboxPrimitive.Portal.Props) {
    return <ComboboxPrimitive.Portal data-slot="combobox-portal" {...props} />
}

function ComboboxPositioner({ className, ...props }: ComboboxPrimitive.Positioner.Props) {
    return (
        <ComboboxPrimitive.Positioner
            data-slot="combobox-positioner"
            className={cn('isolate z-50', className)}
            {...props}
        />
    )
}

function ComboboxPopup({ className, ...props }: ComboboxPrimitive.Popup.Props) {
    return (
        <ComboboxPrimitive.Popup
            data-slot="combobox-popup"
            className={cn(
                'relative isolate z-50 w-(--anchor-width) min-w-72 max-w-[calc(100vw-1rem)] origin-(--transform-origin) overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-overlay duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
                className
            )}
            {...props}
        />
    )
}

function ComboboxInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
    return (
        <ComboboxPrimitive.Input
            data-slot="combobox-input"
            className={cn(
                'h-9 w-full rounded-md bg-surface-control px-3 py-2 text-sm text-foreground shadow-none outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
                className
            )}
            {...props}
        />
    )
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
    return (
        <ComboboxPrimitive.List
            data-slot="combobox-list"
            className={cn('max-h-64 overflow-y-auto p-1', className)}
            {...props}
        />
    )
}

function ComboboxItem({ className, ...props }: ComboboxPrimitive.Item.Props) {
    return (
        <ComboboxPrimitive.Item
            data-slot="combobox-item"
            className={cn(
                'relative flex w-full cursor-default items-center gap-2 rounded-md px-2 py-2 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50',
                className
            )}
            {...props}
        />
    )
}

function ComboboxItemIndicator({ className, ...props }: ComboboxPrimitive.ItemIndicator.Props) {
    return (
        <ComboboxPrimitive.ItemIndicator
            data-slot="combobox-item-indicator"
            className={cn('ml-auto flex size-4 shrink-0 items-center justify-center', className)}
            {...props}>
            <CheckIcon aria-hidden="true" className="size-4" />
        </ComboboxPrimitive.ItemIndicator>
    )
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
    return (
        <ComboboxPrimitive.Empty
            data-slot="combobox-empty"
            className={cn('text-sm text-muted-foreground', className)}
            {...props}
        />
    )
}

export {
    Combobox,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxItemIndicator,
    ComboboxLabel,
    ComboboxList,
    ComboboxPopup,
    ComboboxPortal,
    ComboboxPositioner,
    ComboboxTrigger,
    ComboboxValue,
}
