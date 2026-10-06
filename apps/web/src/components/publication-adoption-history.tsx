import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api } from '@/lib/api'
import * as m from '@/paraglide/messages.js'

export function PublicationAdoptionHistory({
    projectId,
    publicationId,
    revision,
}: {
    projectId: string
    publicationId: string
    revision: number
}) {
    const [open, setOpen] = useState(false)
    const history = useQuery({
        queryKey: ['project', projectId, 'publication-adoptions', publicationId, revision],
        queryFn: () => api.listPublicationDraftAdoptions(projectId, publicationId),
        enabled: open,
    })
    return (
        <details open={open} onToggle={event => setOpen(event.currentTarget.open)}>
            <summary className="cursor-pointer text-sm text-muted-foreground">
                {m.profile_adoption_history()}
            </summary>
            {history.isPending ? (
                <p role="status">{m.common_loading()}</p>
            ) : history.isError ? (
                <p role="alert">{m.profile_adoption_load_failed()}</p>
            ) : (
                history.data.adoptions.map(entry => (
                    <div key={entry.id} className="mt-3 space-y-2">
                        <p className="text-sm">
                            {m.profile_adoption_previous()} · {entry.draft.revision}
                        </p>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">
                            {JSON.stringify(entry.localContent ?? entry.draft.content, null, 2)}
                        </pre>
                        {entry.localContent !== null ? (
                            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">
                                {JSON.stringify(entry.draft.content, null, 2)}
                            </pre>
                        ) : null}
                    </div>
                ))
            )}
        </details>
    )
}
