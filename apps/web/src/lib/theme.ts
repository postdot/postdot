import { createThemes } from '@wrksz/themes/client'

export const { ThemeProvider, useTheme } = createThemes({
    themes: ['light', 'dark'] as const,
    defaultTheme: 'dark',
    attribute: 'class',
    storage: 'localStorage',
    storageKey: 'herald-theme',
    enableSystem: false,
    enableColorScheme: true,
    themeColor: {
        light: '#f3f2ef',
        dark: '#20201f',
    },
    disableTransitionOnChange: 'background-color 0s, color 0s, border-color 0s',
})
