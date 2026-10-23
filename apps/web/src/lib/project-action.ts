import { useState } from 'react'

import { formatApiError } from '@/lib/api'
import { useActionError } from '@/lib/use-action-error'

/** Action feedback belongs to the feature invoking the mutation. */
export function useProjectAction() {
    const [pending, setPending] = useState(false)
    const [error, setError] = useActionError()
    async function runAction(action: () => Promise<void>): Promise<boolean> {
        setError(null)
        setPending(true)
        try {
            await action()
            return true
        } catch (caughtError) {
            setError(formatApiError(caughtError))
            return false
        } finally {
            setPending(false)
        }
    }
    return { pending, error, setError, setPending, runAction }
}
