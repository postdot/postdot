import { Tooltip, TooltipContent, TooltipTrigger } from '@postbot/ui/components/tooltip'
import type { ReactElement } from 'react'

/** Compose primitive triggers into one hit area; keep the action's accessible name on its button. */
export function ActionTooltip({
    label,
    children,
}: {
    readonly label: string
    readonly children: ReactElement
}) {
    return (
        <Tooltip>
            <TooltipTrigger render={children} />
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    )
}
