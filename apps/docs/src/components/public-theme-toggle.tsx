'use client'

import { Button } from '@postbot/ui/components/button'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@postbot/ui/components/tooltip'
import { MoonIcon } from '@solar-icons/react/linear/moon'
import { SunIcon } from '@solar-icons/react/linear/sun'
import { useTheme } from 'fumadocs-ui/provider/base'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

export function PublicThemeToggle() {
    const { theme, resolvedTheme, setTheme } = useTheme()
    const reducedMotion = useReducedMotion()
    const dark = (resolvedTheme ?? theme ?? 'light') === 'dark'
    return (
        <TooltipProvider delay={400}>
            <Tooltip>
                <TooltipTrigger
                    render={<Button variant="ghost" className="home-theme-toggle" />}
                    aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
                    onClick={() => setTheme(dark ? 'light' : 'dark')}>
                    <AnimatePresence initial={false} mode="wait">
                        <motion.span
                            key={dark ? 'sun' : 'moon'}
                            initial={{ rotate: reducedMotion ? 0 : -70, opacity: 0 }}
                            animate={{ rotate: 0, opacity: 1 }}
                            exit={{ rotate: reducedMotion ? 0 : 70, opacity: 0 }}
                            transition={{ duration: reducedMotion ? 0 : 0.16 }}>
                            {dark ? (
                                <SunIcon size={19} aria-hidden="true" />
                            ) : (
                                <MoonIcon size={19} aria-hidden="true" />
                            )}
                        </motion.span>
                    </AnimatePresence>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="home-theme-tooltip">
                    {dark ? 'Light theme' : 'Dark theme'}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}
