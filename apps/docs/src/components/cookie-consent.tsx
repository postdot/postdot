import { Button } from '@postdot/ui/components/button'
import { ShieldCheckIcon } from '@solar-icons/react/linear/shield-check'
import { useEffect, useState } from 'react'

import { onConsentPromptRequest, useConsent, writeConsent } from '@/lib/consent'

import './cookie-consent.css'
import { Link } from './site-link'

/**
 * Asks once whether session replay and heatmaps may run. Both choices have the
 * same weight, nothing runs before the answer, and the footer reopens it.
 */
export function CookieConsent() {
    const consent = useConsent()
    const [reopened, setReopened] = useState(false)

    useEffect(() => onConsentPromptRequest(() => setReopened(true)), [])

    if (consent === undefined || (consent !== null && !reopened)) return null

    function choose(analytics: boolean) {
        const changed = (consent?.analytics ?? false) !== analytics
        writeConsent({ analytics })
        setReopened(false)
        // A page runs either the audience script or the replay scripts, never both.
        if (changed) location.reload()
    }

    return (
        <section aria-labelledby="consent-title" className="consent">
            <div className="consent-head">
                <ShieldCheckIcon size={20} aria-hidden="true" />
                <h2 id="consent-title">Help improve the site</h2>
            </div>
            <p>
                We measure visits anonymously, without cookies. May we also record a sample of
                sessions, with text hidden, to see where readers get stuck?{' '}
                <Link href="/privacy">Privacy policy</Link>
            </p>
            <div className="consent-actions">
                <Button className="consent-button" onClick={() => choose(false)}>
                    Decline
                </Button>
                <Button className="consent-button" onClick={() => choose(true)}>
                    Allow
                </Button>
            </div>
        </section>
    )
}
