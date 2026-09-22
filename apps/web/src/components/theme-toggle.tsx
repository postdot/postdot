import { Button } from '@herald/ui/components/button'
import { MoonIcon } from '@solar-icons/react/linear/moon'
import { SunIcon } from '@solar-icons/react/linear/sun'
import type { ComponentProps } from 'react'

import { useLanguage } from '@/lib/i18n'
import { useTheme } from '@/lib/theme'
import * as m from '@/paraglide/messages.js'

type ThemeToggleProps = Omit<ComponentProps<typeof Button>, 'children' | 'onClick'>

export function ThemeToggle({ className, ...props }: ThemeToggleProps) {
    useLanguage()
    const { resolvedTheme, setTheme } = useTheme()
    const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark'
    const label =
        resolvedTheme === undefined
            ? m.theme_switch()
            : m.theme_switch_to({
                  theme: nextTheme === 'dark' ? m.theme_dark() : m.theme_light(),
              })

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
