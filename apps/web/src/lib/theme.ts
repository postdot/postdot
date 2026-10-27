import { createThemes } from '@wrksz/themes/client'

export const { ThemeProvider, useTheme } = createThemes({
    themes: ['light', 'dark'] as const,
    defaultTheme: 'dark',
    attribute: 'class',
    storage: 'localStorage',
    storageKey: 'postdot-theme',
    enableSystem: false,
    enableColorScheme: true,
    themeColor: {
        light: '#f4f4f4',
        dark: '#171717',
    },
    disableTransitionOnChange: 'background-color 0s, color 0s, border-color 0s',
})
