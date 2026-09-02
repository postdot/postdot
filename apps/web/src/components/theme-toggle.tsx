import { Button } from '@herald/ui/components/button'
import { MoonIcon } from '@solar-icons/react/bold/moon'
import { SunIcon } from '@solar-icons/react/bold/sun'
import type { ComponentProps } from 'react'

import { useTheme } from '@/lib/theme'

type ThemeToggleProps = Omit<ComponentProps<typeof Button>, 'children' | 'onClick'>

export function ThemeToggle({ className, ...props }: ThemeToggleProps) {
    const { resolvedTheme, setTheme } = useTheme()
    const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark'
    const label = resolvedTheme === undefined ? 'Switch theme' : `Switch to ${nextTheme} theme`

    return (
        <Button
            {...props}
            aria-label={label}
            className={className}
            size="icon-sm"
            title={label}
            variant="ghost"
            onClick={() => setTheme(nextTheme)}>
            {resolvedTheme === 'dark' ? (
                <SunIcon aria-hidden="true" />
            ) : (
                <MoonIcon aria-hidden="true" />
            )}
        </Button>
    )
}
