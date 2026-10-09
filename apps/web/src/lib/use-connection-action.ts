import { useRef, useState } from 'react'

import { formatApiError } from '@/lib/api'
import * as m from '@/paraglide/messages.js'

/** A connection attempt belongs to its form, including failure and retry. */
export function useConnectionAction() {
    const inFlight = useRef(false)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function run(action: () => Promise<boolean | void>): Promise<boolean> {
        if (inFlight.current) return false
        inFlight.current = true
        setSubmitting(true)
        setError(null)
        try {
            const result = await action()
            if (result === false) {
                setError(m.api_request_failed())
                return false
            }
            return true
        } catch (caughtError) {
            setError(formatApiError(caughtError))
            return false
        } finally {
            inFlight.current = false
            setSubmitting(false)
        }
    }

    return { submitting, error, setError, run }
}
