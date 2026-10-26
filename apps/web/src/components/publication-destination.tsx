import { Button } from '@postdot/ui/components/button'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { PublicationTargetEditor } from '@/components/publication-target-editor'
import { api } from '@/lib/api'
import { projectQueryKeys } from '@/lib/project-query-keys'
import * as m from '@/paraglide/messages.js'

export function PublicationDestination({
    projectId,
    publicationId,
    targetRevisionId,
    automatic,
    editable,
    disabled,
    onReviewCurrent,
    selectedContent,
    selectedProfile,
}: {
    projectId: string
    publicationId: string
    targetRevisionId: string | null
    automatic: boolean
    editable: boolean
    disabled: boolean
    onReviewCurrent: () => Promise<void>
    selectedContent: Record<string, unknown> | null
    selectedProfile: unknown
}) {
    const client = useQueryClient()
    const key = [
        ...projectQueryKeys.publicationDestinations(projectId),
        publicationId,
        'destination',
    ]
    const query = useQuery({
        queryKey: key,
        queryFn: () => api.getPublicationDestination(projectId, publicationId),
        enabled: automatic,
    })
    const mutation = useMutation({
        mutationFn: (revision: number) =>
            api.confirmPublicationDestination(projectId, publicationId, {
                expectedRevision: revision,
                expectedTargetRevisionId: targetRevisionId,
            }),
        onSuccess: value => {
            client.setQueryData(key, value)
        },
    })
    if (!automatic) return null
    if (query.isError || mutation.isError)
        return (
            <div className="space-y-2" data-publication-destination>
                <p role="alert" className="text-sm text-destructive">
                    {m.destination_refresh_failed()}
                </p>
                <Button
                    variant="secondary"
                    disabled={disabled || query.isFetching || mutation.isPending}
                    onClick={() => {
                        mutation.reset()
                        void onReviewCurrent().then(() => query.refetch())
                    }}>
                    {m.common_retry()}
                </Button>
            </div>
        )
    const state = query.data?.destination
    if (!state) return null
    const currentLabel =
        state.current?.destinationName ??
        state.current?.externalAccountName ??
        state.current?.destinationId ??
        state.current?.externalAccountId ??
        m.destination_unrecorded()
    const currentId = state.current?.destinationId ?? state.current?.externalAccountId
    const currentIdentity = [
        currentLabel,
        currentId !== currentLabel ? currentId : null,
        state.current?.endpointOrigin,
    ]
        .filter(value => typeof value === 'string' && value !== '')
        .join(' · ')
    return (
        <div className="space-y-3" data-publication-destination>
            {state.requiresConfirmation ? (
                <div className="space-y-2">
                    <p role="status" className="text-sm text-state-attention">
                        {m.destination_changed()}
                    </p>
                    <p className="break-words text-sm">
                        {m.destination_current({ name: currentIdentity })}
                    </p>
                    {!state.connected ? (
                        <p className="text-sm text-muted-foreground">{m.destination_reconnect()}</p>
                    ) : null}
                    {selectedContent !== null ? (
                        <div className="space-y-2">
                            <h3 className="text-sm font-medium">
                                {m.destination_selected_content()}
                            </h3>
                            <PublicationTargetEditor
                                readOnly
                                profile={selectedProfile}
                                target={selectedContent}
                                rawText={JSON.stringify(selectedContent, null, 2)}
                                onTargetChange={() => {}}
                                onRawTextChange={() => {}}
                            />
                        </div>
                    ) : null}
                    {editable ? (
                        <Button
                            variant="secondary"
                            disabled={
                                disabled ||
                                !state.connected ||
                                query.isFetching ||
                                mutation.isPending
                            }
                            onClick={() => mutation.mutate(state.revision)}>
                            {m.destination_confirm()}
                        </Button>
                    ) : null}
                    <p className="text-sm text-muted-foreground">
                        {m.destination_confirmation_effect()}
                    </p>
                </div>
            ) : null}
            {state.history.length ? (
                <details>
                    <summary className="cursor-pointer text-sm text-muted-foreground">
                        {m.destination_history()}
                    </summary>
                    <ul className="mt-3 space-y-2 text-sm">
                        {state.history.map(entry => (
                            <li key={entry.id} className="break-words">
                                {entry.destination === null
                                    ? m.destination_unrecorded()
                                    : historyLabel(entry.destination)}
                            </li>
                        ))}
                    </ul>
                </details>
            ) : null}
        </div>
    )
}
function historyLabel(identity: Record<string, unknown>): string {
    const label =
        identity.destinationName ??
        identity.externalAccountName ??
        identity.destinationId ??
        identity.externalAccountId
    const id = identity.destinationId ?? identity.externalAccountId
    return [identity.providerId, label, label !== id ? id : null, identity.endpointOrigin]
        .filter(value => typeof value === 'string' && value !== '')
        .join(' · ')
}
