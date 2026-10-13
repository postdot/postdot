'use client'

import { Button } from '@postbot/ui/components/button'
import { useTheme } from 'fumadocs-ui/provider/base'

export function PublicThemeToggle() {
    const { theme, resolvedTheme, setTheme } = useTheme()
    return (
        <Button
            variant="ghost"
            className="home-theme-toggle"
            aria-label="Toggle Theme"
            onClick={() =>
                setTheme((resolvedTheme ?? theme ?? 'dark') === 'dark' ? 'light' : 'dark')
            }>
            Light / Dark
        </Button>
    )
}
