import { Button } from '@postdot/ui/components/button'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@postdot/ui/components/tooltip'
import { MoonIcon } from '@solar-icons/react/linear/moon'
import { SunIcon } from '@solar-icons/react/linear/sun'
import { useTheme } from '@wrksz/themes/client'
import { useState } from 'react'

export function PublicThemeToggle() {
    const { setTheme } = useTheme()
    const [interacted, setInteracted] = useState(false)
    return (
        <TooltipProvider delay={400}>
            <Tooltip>
                <TooltipTrigger
                    render={
                        <Button variant="ghost" className="home-theme-toggle public-theme-toggle" />
                    }
                    aria-label="Switch theme"
                    data-interacted={interacted}
                    onClick={() => {
                        setInteracted(true)
                        setTheme(
                            document.documentElement.classList.contains('dark') ? 'light' : 'dark'
                        )
                    }}>
                    <span className="public-theme-symbol public-theme-light">
                        <SunIcon size={19} aria-hidden="true" />
                    </span>
                    <span className="public-theme-symbol public-theme-dark">
                        <MoonIcon size={19} aria-hidden="true" />
                    </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="home-theme-tooltip">
                    Switch theme
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}
