import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createContext, useContext } from 'react'

import { getLocale, getTextDirection, setLocale, type Locale } from '@/paraglide/runtime.js'

interface LanguageContextValue {
    readonly locale: Locale
    readonly setLocale: (locale: Locale) => Promise<void>
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { readonly children: ReactNode }) {
    const [locale, setCurrentLocale] = useState<Locale>(() => getLocale())

    useEffect(() => {
        document.documentElement.lang = locale
        document.documentElement.dir = getTextDirection(locale)
    }, [locale])

    const changeLocale = useCallback(async (nextLocale: Locale) => {
        await setLocale(nextLocale, { reload: false })
        setCurrentLocale(nextLocale)
    }, [])

    const value = useMemo<LanguageContextValue>(
        () => ({ locale, setLocale: changeLocale }),
        [changeLocale, locale]
    )

    return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage(): LanguageContextValue {
    const context = useContext(LanguageContext)
    if (context === null) {
        throw new Error('useLanguage must be used inside LanguageProvider')
    }
    return context
}
