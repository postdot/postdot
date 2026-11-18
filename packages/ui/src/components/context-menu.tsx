import { ContextMenu as ContextMenuPrimitive } from '@base-ui/react/context-menu'

import { cn } from '../lib/utils'

/**
 * Right-click (or long-press) menu. Items, separators and labels are the
 * DropdownMenu ones: both menus share Base UI's menu parts, so they look and
 * behave the same.
 */
function ContextMenu({ ...props }: ContextMenuPrimitive.Root.Props) {
    return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}

function ContextMenuTrigger({ ...props }: ContextMenuPrimitive.Trigger.Props) {
    return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
}

function ContextMenuContent({ className, ...props }: ContextMenuPrimitive.Popup.Props) {
    return (
        <ContextMenuPrimitive.Portal>
            <ContextMenuPrimitive.Positioner className="isolate z-50 outline-none">
                <ContextMenuPrimitive.Popup
                    data-slot="context-menu-content"
                    className={cn(
                        'z-50 max-h-(--available-height) w-max min-w-44 max-w-[min(var(--available-width),calc(100vw-1rem))] origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-overlay duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95',
                        className
                    )}
                    {...props}
                />
            </ContextMenuPrimitive.Positioner>
        </ContextMenuPrimitive.Portal>
    )
}

export { ContextMenu, ContextMenuContent, ContextMenuTrigger }
