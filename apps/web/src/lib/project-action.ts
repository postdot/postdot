import { useState } from 'react'

import { formatApiError } from '@/lib/api'
import { useOptionalProjectAccess } from '@/lib/project-access'
import { useActionError } from '@/lib/use-action-error'

/** Action feedback belongs to the feature invoking the mutation. */
export function useProjectAction() {
    const access = useOptionalProjectAccess()
    const [pending, setPending] = useState(false)
    const [error, setError] = useActionError()
    async function runAction(action: () => Promise<void>): Promise<boolean> {
        if (access !== null && !access.canWrite()) return false
        setError(null)
        setPending(true)
        try {
            await action()
            return true
        } catch (caughtError) {
            access?.reportRefusal(caughtError)
            setError(formatApiError(caughtError))
            return false
        } finally {
            setPending(false)
        }
    }
    return { pending, error, setError, setPending, runAction }
}
