import { Kbd } from '@postdot/ui/components/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@postdot/ui/components/tooltip'
import type { ReactElement, ReactNode } from 'react'

/** Compose primitive triggers into one hit area; keep the action's accessible name on its button. */
export function ActionTooltip({
    label,
    shortcut,
    children,
}: {
    readonly label: string
    readonly shortcut?: ReactNode
    readonly children: ReactElement
}) {
    return (
        <Tooltip>
            <TooltipTrigger render={children} />
            <TooltipContent className="flex items-center gap-2">
                <span>{label}</span>
                {typeof shortcut === 'string' ? <Kbd>{shortcut}</Kbd> : shortcut}
            </TooltipContent>
        </Tooltip>
    )
}
