import { useSyncExternalStore } from 'react'

/**
 * The reader's analytics choice, kept in a first-party cookie. Audience
 * measurement is anonymous and cookieless and needs no choice; session replay
 * and heatmaps run only after the reader allows them here.
 */
export type Consent = { analytics: boolean }

const COOKIE = 'postdot-consent'
const EVENT = 'postdot:consent'

export function readConsent(): Consent | null {
    const entry = document.cookie.split('; ').find(row => row.startsWith(`${COOKIE}=`))
    if (!entry) return null
    try {
        const value = JSON.parse(decodeURIComponent(entry.slice(COOKIE.length + 1))) as Consent
        return typeof value.analytics === 'boolean' ? { analytics: value.analytics } : null
    } catch {
        return null
    }
}

export function writeConsent(consent: Consent) {
    const secure = location.protocol === 'https:' ? ';secure' : ''
    const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString()
    document.cookie = `${COOKIE}=${encodeURIComponent(JSON.stringify(consent))};path=/;expires=${expires};samesite=lax${secure}`
    window.dispatchEvent(new Event(EVENT))
}

/** Reopens the choice, e.g. from the footer. */
export function requestConsentPrompt() {
    window.dispatchEvent(new Event(`${EVENT}:open`))
}

function subscribe(callback: () => void) {
    window.addEventListener(EVENT, callback)
    return () => window.removeEventListener(EVENT, callback)
}

/** Calls back when something asks to show the choice again. */
export function onConsentPromptRequest(callback: () => void) {
    window.addEventListener(`${EVENT}:open`, callback)
    return () => window.removeEventListener(`${EVENT}:open`, callback)
}

/** `undefined` before hydration, then the stored choice or `null` when there is none. */
export function useConsent(): Consent | null | undefined {
    const raw = useSyncExternalStore(
        subscribe,
        () => document.cookie.split('; ').find(row => row.startsWith(`${COOKIE}=`)) ?? '',
        () => undefined
    )
    return raw === undefined ? undefined : readConsent()
}
