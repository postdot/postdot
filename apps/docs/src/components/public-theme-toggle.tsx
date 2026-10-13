'use client'

import { Button } from '@postbot/ui/components/button'
import { MoonIcon } from '@solar-icons/react/linear/moon'
import { SunIcon } from '@solar-icons/react/linear/sun'
import { useTheme } from 'fumadocs-ui/provider/base'
import { motion, useReducedMotion } from 'motion/react'

export function PublicThemeToggle() {
    const { theme, resolvedTheme, setTheme } = useTheme()
    const reducedMotion = useReducedMotion()
    const dark = (resolvedTheme ?? theme ?? 'dark') === 'dark'
    return (
        <Button
            variant="ghost"
            className="home-theme-toggle"
            aria-label="Dark theme"
            aria-pressed={dark}
            onClick={() => setTheme(dark ? 'light' : 'dark')}>
            <motion.span
                className="home-theme-thumb"
                initial={false}
                animate={{ x: dark ? 28 : 0 }}
                transition={
                    reducedMotion
                        ? { duration: 0 }
                        : { type: 'spring', stiffness: 480, damping: 34 }
                }
            />
            <SunIcon size={16} aria-hidden="true" />
            <MoonIcon size={16} aria-hidden="true" />
        </Button>
    )
}
