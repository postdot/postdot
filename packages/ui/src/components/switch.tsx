import { Switch as SwitchPrimitive } from '@base-ui/react/switch'

import { cn } from '../lib/utils'

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
    return (
        <SwitchPrimitive.Root
            data-slot="switch"
            className={cn(
                'group/switch relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-accent shadow-field transition-[background-color,box-shadow] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:bg-primary data-disabled:pointer-events-none data-disabled:opacity-50',
                className
            )}
            {...props}>
            <SwitchPrimitive.Thumb
                data-slot="switch-thumb"
                className="pointer-events-none block size-4 translate-x-0.5 rounded-full bg-white shadow-control transition-transform group-data-checked/switch:translate-x-[18px]"
            />
        </SwitchPrimitive.Root>
    )
}

export { Switch }
