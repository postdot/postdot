import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import * as React from 'react'

import { cn } from '../lib/utils'

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
    return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
    return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverPortal({ ...props }: PopoverPrimitive.Portal.Props) {
    return <PopoverPrimitive.Portal data-slot="popover-portal" {...props} />
}

function PopoverContent({
    align = 'start',
    alignOffset = 0,
    side = 'bottom',
    sideOffset = 8,
    className,
    ...props
}: PopoverPrimitive.Popup.Props &
    Pick<PopoverPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'>) {
    return (
        <PopoverPortal>
            <PopoverPrimitive.Positioner
                className="isolate z-50 outline-none"
                align={align}
                alignOffset={alignOffset}
                side={side}
                sideOffset={sideOffset}>
                <PopoverPrimitive.Popup
                    data-slot="popover-content"
                    className={cn(
                        'z-50 max-h-(--available-height) origin-(--transform-origin) overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-overlay ring-1 ring-foreground/8 duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
                        className
                    )}
                    {...props}
                />
            </PopoverPrimitive.Positioner>
        </PopoverPortal>
    )
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
    return (
        <PopoverPrimitive.Title
            data-slot="popover-title"
            className={cn('font-heading text-base font-medium text-foreground', className)}
            {...props}
        />
    )
}

function PopoverDescription({ className, ...props }: PopoverPrimitive.Description.Props) {
    return (
        <PopoverPrimitive.Description
            data-slot="popover-description"
            className={cn('text-sm text-muted-foreground', className)}
            {...props}
        />
    )
}

function PopoverClose({ ...props }: PopoverPrimitive.Close.Props) {
    return <PopoverPrimitive.Close data-slot="popover-close" {...props} />
}

export {
    Popover,
    PopoverClose,
    PopoverContent,
    PopoverDescription,
    PopoverPortal,
    PopoverTitle,
    PopoverTrigger,
}
