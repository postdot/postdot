import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@postdot/ui/components/select'

import { useLanguage } from '@/lib/i18n'
import { useTheme } from '@/lib/theme'
import * as m from '@/paraglide/messages.js'

export const themeOptions = ['system', 'light', 'dark'] as const
export type ThemeOption = (typeof themeOptions)[number]

export function themeLabel(theme: ThemeOption) {
    return theme === 'system'
        ? m.theme_option_system()
        : theme === 'dark'
          ? m.theme_option_dark()
          : m.theme_option_light()
}

export function ThemeSelect({ id }: { readonly id?: string }) {
    useLanguage()
    const { theme, setTheme } = useTheme()
    const current = selectedThemeOption(theme)

    return (
        <Select
            value={current}
            onValueChange={value => {
                if (value === 'system' || value === 'light' || value === 'dark') setTheme(value)
            }}>
            <SelectTrigger
                aria-label={m.preferences_theme()}
                className="w-44"
                data-slot="theme-select"
                id={id}>
                <SelectValue>{themeLabel(current)}</SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
                {themeOptions.map(option => (
                    <SelectItem key={option} value={option}>
                        {themeLabel(option)}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}

/** The person's choice, which may be to follow the system. */
export function selectedThemeOption(theme: string | undefined): ThemeOption {
    return theme === 'light' || theme === 'dark' ? theme : 'system'
}
