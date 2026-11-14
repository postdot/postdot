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

export const themeOptions = ['light', 'dark'] as const
export type ThemeOption = (typeof themeOptions)[number]

export function themeLabel(theme: ThemeOption) {
    return theme === 'dark' ? m.theme_option_dark() : m.theme_option_light()
}

export function ThemeSelect({ id }: { readonly id?: string }) {
    useLanguage()
    const { resolvedTheme, setTheme } = useTheme()
    const current: ThemeOption = resolvedTheme === 'light' ? 'light' : 'dark'

    return (
        <Select
            value={current}
            onValueChange={value => {
                if (value === 'light' || value === 'dark') setTheme(value)
            }}>
            <SelectTrigger
                aria-label={m.preferences_theme()}
                className="w-44"
                data-slot="theme-select"
                id={id}>
                <SelectValue>{themeLabel(current)}</SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
                {themeOptions.map(theme => (
                    <SelectItem key={theme} value={theme}>
                        {themeLabel(theme)}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}
