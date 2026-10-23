import { useEffect } from 'react'

import { useConsent } from '@/lib/consent'
import { siteUrl } from '@/lib/social-metadata'
import { umamiEnabled, umamiId, umamiUrl } from '@/lib/umami'

function load(src: string, attributes: Record<string, string>) {
    const script = document.createElement('script')
    script.defer = true
    script.src = src
    script.dataset.websiteId = umamiId
    script.dataset.hostUrl = umamiUrl
    script.dataset.domains = new URL(siteUrl).hostname
    script.dataset.doNotTrack = 'true'
    for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value)
    document.body.append(script)
}

/**
 * Audience measurement (`/s.js`) is anonymous and cookieless. Session replay
 * and heatmaps (`/p.js` and `/r.js`) load only once the reader allowed them.
 * A change of choice reloads the page (see the consent banner), so a page
 * never runs two trackers.
 */
export function Analytics() {
    const consent = useConsent()
    const allowed = consent?.analytics === true

    useEffect(() => {
        if (!umamiEnabled || consent === undefined) return
        if (allowed) {
            load('/p.js', { 'data-performance': 'true' })
            load('/r.js', {
                'data-sample-rate': '0.15',
                'data-mask-level': 'moderate',
                'data-max-duration': '300000',
            })
        } else {
            load('/s.js', { 'data-performance': 'true' })
        }
        // The choice is read once per page load; changing it reloads the page.
    }, [consent === undefined]) // oxlint-disable-line react/exhaustive-deps

    return null
}
