import { useLocation } from '@tanstack/react-router'
import { useState } from 'react'

/** Keep action feedback on the navigation entry that initiated it. */
export function useActionError() {
    const scope = useLocation({ select: location => location.state.__TSR_key ?? location.href })
    const [feedback, setFeedback] = useState<{ scope: string; message: string | null }>({
        scope,
        message: null,
    })

    // Reset before children render the new route, and ignore late failures from an old entry.
    if (feedback.scope !== scope) setFeedback({ scope, message: null })

    function setError(message: string | null) {
        setFeedback(current => (current.scope === scope ? { scope, message } : current))
    }

    return [feedback.scope === scope ? feedback.message : null, setError] as const
}
