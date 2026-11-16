import { Button, buttonVariants } from '@postdot/ui/components/button'
import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useReducer, useRef } from 'react'

import { EmptyState } from '@/components/empty-state'
import { api } from '@/lib/api'
import { useProjectDashboard } from '@/lib/dashboard-context'
import {
    classifyMembershipVerificationError,
    createProjectAccessState,
    projectAccessReducer,
} from '@/lib/project-access-verification'
import { subscribeProjectAccessRevocation } from '@/lib/project-realtime'
import * as m from '@/paraglide/messages.js'

/** The editor retains its working copy while access is checked and reconciled. */
export function usePostEditorAccess(projectId: string) {
    const { projectRole, access: projectAccess } = useProjectDashboard()
    const [access, dispatch] = useReducer(projectAccessReducer, undefined, createProjectAccessState)
    const current = useRef(access)
    current.current = access
    const verifying = useRef<number | null>(null)
    const verify = useCallback(
        (action: 'access-revoked' | 'refetch-refused' | 'retry-verification') => {
            const before = current.current
            if (
                action === 'retry-verification'
                    ? before.status !== 'technical-error'
                    : before.status !== 'confirmed'
            )
                return
            const epoch = before.epoch + 1
            if (verifying.current === epoch) return
            verifying.current = epoch
            // Advance synchronously so a second refusal in this microtask is quarantined too.
            current.current = projectAccessReducer(before, { type: action })
            dispatch({ type: action })
            void api
                .getProjectMembership(projectId)
                .then(({ membership }) => {
                    if (current.current.epoch === epoch)
                        dispatch({ type: 'verification-succeeded', role: membership.role })
                })
                .catch(error => {
                    if (current.current.epoch === epoch)
                        dispatch({ type: classifyMembershipVerificationError(error) })
                })
                .finally(() => {
                    if (verifying.current === epoch) verifying.current = null
                })
        },
        [projectId]
    )
    useEffect(
        () => subscribeProjectAccessRevocation(projectId, () => verify('access-revoked')),
        [projectId, verify]
    )
    useEffect(() => {
        if (current.current.role !== null) dispatch({ type: 'clear-role-override' })
    }, [projectRole])
    const onAccessRefused = useCallback(() => verify('refetch-refused'), [verify])
    const onAccessReconciled = useCallback(
        (succeeded: boolean) =>
            dispatch({ type: succeeded ? 'reconcile-succeeded' : 'reconcile-failed' }),
        []
    )
    const retry = () => {
        if (projectAccess.status === 'technical-error') void projectAccess.verify()
        verify('retry-verification')
    }
    const notice =
        access.status === 'denied' ? (
            <EmptyState
                title={m.editor_access_denied_title()}
                description={m.dashboard_select_project_description()}
                illustration="access"
                action={
                    <Link
                        className={buttonVariants({ variant: 'default' })}
                        to="/dashboard"
                        search={{ projectId: 'none' }}>
                        {m.nav_select_project()}
                    </Link>
                }
            />
        ) : access.status === 'technical-error' ? (
            <EmptyState
                layout="compact"
                title={m.editor_application_unconfirmed()}
                action={
                    <Button onClick={retry} size="sm" variant="ghost">
                        {m.common_retry()}
                    </Button>
                }
            />
        ) : access.status !== 'confirmed' ? (
            <p role="status" className="mb-4 text-sm text-muted-foreground">
                {access.status === 'verifying'
                    ? m.editor_access_checking()
                    : m.editor_access_reconciling()}
            </p>
        ) : null
    return {
        ...access,
        role: access.role ?? projectRole,
        onAccessRefused,
        onAccessReconciled,
        notice,
    }
}
