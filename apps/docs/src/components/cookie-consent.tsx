import { Button } from '@postdot/ui/components/button'
import { useEffect, useState } from 'react'

import { onConsentPromptRequest, useConsent, writeConsent } from '@/lib/consent'

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
        <section
            aria-labelledby="consent-title"
            className="fixed bottom-4 left-4 z-50 mr-4 max-w-sm rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg">
            <h2 id="consent-title" className="text-sm font-semibold">
                Help improve the site
            </h2>
            <p className="mt-1 text-xs/5 text-muted-foreground">
                We measure visits anonymously, without cookies. May we also record a sample of
                sessions, with text hidden, to see where readers get stuck?{' '}
                <Link href="/privacy" className="underline underline-offset-4">
                    Privacy policy
                </Link>
            </p>
            <div className="mt-3 flex gap-2">
                <Button variant="outline" onClick={() => choose(false)}>
                    Decline
                </Button>
                <Button variant="outline" onClick={() => choose(true)}>
                    Allow
                </Button>
            </div>
        </section>
    )
}
