import { Alert, AlertDescription, AlertTitle } from '@postdot/ui/components/alert'
import { Button } from '@postdot/ui/components/button'
import { RefreshIcon } from '@solar-icons/react/linear/refresh'
import { UsersGroupTwoRoundedIcon } from '@solar-icons/react/linear/users-group-two-rounded'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { AccessPageHeader } from '@/components/access-page-header'
import { EmptyState } from '@/components/empty-state'
import { ResourceLifecycleSection } from '@/components/resource-lifecycle-section'
import { WorkspaceGroupsSection } from '@/components/workspace-groups-section'
import { api, formatApiError } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export function WorkspaceAdministrationPage({
    preferredWorkspaceId,
}: {
    readonly preferredWorkspaceId?: string
}) {
    const navigate = useNavigate()
    useLanguage()
    const [workspaceId, setWorkspaceId] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [reloadVersion, setReloadVersion] = useState(0)

    useEffect(() => {
        let cancelled = false

        async function load() {
            setLoading(true)
            setError(null)
            try {
                const response = await api.listWorkspaces()
                if (cancelled) return
                const manageableWorkspaces = response.workspaces.filter(
                    candidate => candidate.role === 'owner' || candidate.role === 'admin'
                )
                const workspace =
                    (preferredWorkspaceId === undefined
                        ? undefined
                        : manageableWorkspaces.find(
                              candidate => candidate.id === preferredWorkspaceId
                          )) ??
                    manageableWorkspaces.find(candidate => candidate.isDefault) ??
                    manageableWorkspaces[0] ??
                    null
                setWorkspaceId(workspace?.id ?? null)

                // Keep the address bar aligned with the context we actually
                // selected. A stale or copied workspace id must not leave the
                // user looking at one workspace while the URL claims another.
                if (
                    preferredWorkspaceId !== undefined &&
                    workspace !== null &&
                    workspace.id !== preferredWorkspaceId
                ) {
                    void navigate({
                        to: '/dashboard/settings/workspace',
                        search: { projectId: undefined, workspaceId: workspace.id },
                        replace: true,
                    })
                }
            } catch (caughtError) {
                if (!cancelled) setError(formatApiError(caughtError))
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        void load()
        return () => {
            cancelled = true
        }
    }, [navigate, preferredWorkspaceId, reloadVersion])

    return (
        <main className="min-w-0 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
            <div className="mx-auto w-full max-w-6xl">
                <AccessPageHeader title={m.access_workspace_title()} />

                <div className="mx-auto w-full max-w-xl">
                    {error ? (
                        <Alert className="mb-6" variant="destructive">
                            <AlertTitle>{m.access_action_failed()}</AlertTitle>
                            <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-2">
                                <span>{error}</span>
                                <Button
                                    className="shrink-0"
                                    disabled={loading}
                                    onClick={() => setReloadVersion(current => current + 1)}
                                    size="sm"
                                    type="button"
                                    variant="ghost">
                                    <RefreshIcon aria-hidden="true" />
                                    {m.common_retry()}
                                </Button>
                            </AlertDescription>
                        </Alert>
                    ) : null}

                    {loading ? (
                        <section className="bg-surface-raised p-5 shadow-surface sm:p-6">
                            <p className="text-sm text-muted-foreground" role="status">
                                {m.access_workspace_loading()}
                            </p>
                        </section>
                    ) : error !== null ? null : workspaceId === null ? (
                        <EmptyState
                            className="mt-2"
                            description={null}
                            icon={<UsersGroupTwoRoundedIcon aria-hidden="true" />}
                            layout="compact"
                            title={m.access_workspace_unavailable()}
                        />
                    ) : (
                        <WorkspaceGroupsSection workspaceId={workspaceId} />
                    )}
                </div>
                {workspaceId && <ResourceLifecycleSection kind="workspace" id={workspaceId} />}
            </div>
        </main>
    )
}
