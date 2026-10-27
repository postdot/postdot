import { Alert, AlertDescription } from '@postdot/ui/components/alert'
import { Button } from '@postdot/ui/components/button'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, formatApiError } from '@/lib/api'
import * as m from '@/paraglide/messages.js'

export function PublicationCadenceStatus({
    projectId,
    publicationId,
    timeZone,
    locale,
    readOnly = false,
}: {
    projectId: string
    publicationId: string
    timeZone: string
    locale: string
    readOnly?: boolean
}) {
    const query = useQuery({
        queryKey: ['publication-cadence', projectId, publicationId],
        queryFn: () => api.getPublicationCadence(projectId, publicationId),
        refetchInterval: 15000,
    })
    const [confirming, setConfirming] = useState(false)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const data = query.data
    if (!data?.reason || data.eligibleAt <= Date.now()) return null
    return (
        <Alert className="mt-4">
            <AlertDescription>
                <p>
                    {m.cadence_delay({
                        time: new Intl.DateTimeFormat(locale, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                            timeZone,
                        }).format(data.eligibleAt),
                    })}
                </p>
                {readOnly ? null : confirming ? (
                    <div className="mt-3 space-y-3">
                        <p>{m.cadence_override_description()}</p>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                size="sm"
                                disabled={pending}
                                onClick={async () => {
                                    setPending(true)
                                    setError(null)
                                    try {
                                        await api.overridePublicationCadence(
                                            projectId,
                                            publicationId,
                                            data.confirmation
                                        )
                                        await query.refetch()
                                        setConfirming(false)
                                    } catch (caught) {
                                        setError(formatApiError(caught))
                                        await query.refetch()
                                    } finally {
                                        setPending(false)
                                    }
                                }}>
                                {m.cadence_confirm()}
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={pending}
                                onClick={() => setConfirming(false)}>
                                {m.common_cancel()}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <Button
                        className="mt-3"
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirming(true)}>
                        {m.cadence_override()}
                    </Button>
                )}
                {error ? (
                    <p role="alert" className="mt-2 text-destructive">
                        {error}
                    </p>
                ) : null}
            </AlertDescription>
        </Alert>
    )
}
