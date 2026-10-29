import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

import { api, ApiError, type ProjectMemberRole } from './api'
import {
    projectQueryKeys,
    restartProjectRealtime,
    subscribeProjectAccessRevocation,
} from './project-realtime'

type AccessStatus = 'confirmed' | 'verifying' | 'denied' | 'technical-error'

export function useProjectAccess(projectId: string, role: ProjectMemberRole) {
    const client = useQueryClient()
    const [revision, setRevision] = useState(0)
    const [status, setStatus] = useState<AccessStatus>('confirmed')
    const state = useRef({ status: 'confirmed' as AccessStatus, epoch: 0, role })
    useEffect(() => {
        state.current.role = role
    }, [role])
    const verify = useCallback(async () => {
        if (state.current.status === 'verifying' || state.current.status === 'denied') return
        const epoch = ++state.current.epoch
        state.current.status = 'verifying'
        setStatus('verifying')
        const current = () => state.current.epoch === epoch
        try {
            // Cancel this project's old reads before installing fresh membership.
            // Cancelling unrelated resources or clearing the shared cache is unnecessary.
            await client.cancelQueries({
                predicate: query => isProjectAccessQuery(query.queryKey, projectId),
            })
            const response = await api.getProjectMembership(projectId)
            if (!current()) return
            state.current.role = response.membership.role
            client.setQueryData(projectQueryKeys.membership(projectId), response)
            await client.invalidateQueries({
                predicate: query =>
                    isProjectAccessQuery(query.queryKey, projectId) &&
                    query.queryKey[3] !== 'membership',
                refetchType: 'active',
            })
            if (!current()) return
            setRevision(value => value + 1)
            state.current.status = 'confirmed'
            setStatus('confirmed')
            restartProjectRealtime(projectId)
        } catch (error) {
            if (!current()) return
            const next =
                error instanceof ApiError && (error.status === 403 || error.status === 404)
                    ? 'denied'
                    : 'technical-error'
            state.current.status = next
            setStatus(next)
        }
    }, [client, projectId])
    useEffect(() => {
        const unsubscribe = subscribeProjectAccessRevocation(projectId, () => {
            void verify()
        })
        const unsubscribeErrors = client.getQueryCache().subscribe(event => {
            if (event.type !== 'updated' || event.action.type !== 'error') return
            const key = event.query.queryKey
            const error = event.query.state.error
            if (
                key[0] === 'project' &&
                key[1] === projectId &&
                error instanceof ApiError &&
                (error.status === 403 || error.status === 404)
            )
                void verify()
        })
        return () => {
            state.current.epoch++
            unsubscribe()
            unsubscribeErrors()
        }
    }, [client, projectId, verify])
    return {
        status,
        revision,
        verify,
        canWrite: () => state.current.status === 'confirmed' && state.current.role !== 'viewer',
        captureEpoch: () => state.current.epoch,
        isCurrent: (epoch: number) =>
            state.current.epoch === epoch && state.current.status === 'confirmed',
        reportRefusal: (error: unknown) => {
            if (error instanceof ApiError && (error.status === 403 || error.status === 404))
                void verify()
        },
    }
}

export type ProjectAccess = ReturnType<typeof useProjectAccess>
export const ProjectAccessContext = createContext<ProjectAccess | null>(null)
export const useOptionalProjectAccess = () => useContext(ProjectAccessContext)

function isProjectAccessQuery(key: readonly unknown[], projectId: string) {
    return (
        (key[0] === 'project' && key[1] === projectId) ||
        (key[0] === 'resource-impact' && key[1] === 'project' && key[2] === projectId)
    )
}
