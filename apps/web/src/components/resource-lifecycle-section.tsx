import { Button } from '@postdot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@postdot/ui/components/dialog'
import { Input } from '@postdot/ui/components/input'
import { toast } from '@postdot/ui/components/toast'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useRouter, useNavigate, useSearch, useParams } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'

import { AccessPageHeader } from '@/components/access-page-header'
import { ResourceAvatar } from '@/components/identity-visuals'
import { PageColumn } from '@/components/page-column'
import { QueryErrorState } from '@/components/query-error-state'
import { ApiError, api, formatApiError } from '@/lib/api'
import { useDashboardGlobal } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import { useOptionalProjectAccess } from '@/lib/project-access'
import { projectQueryKeys } from '@/lib/project-query-keys'
import * as m from '@/paraglide/messages.js'

type Kind = 'project' | 'workspace'
function stateLabel(state: string) {
    switch (state) {
        case 'active':
            return m.lifecycle_state_active()
        case 'archived':
            return m.lifecycle_state_archived()
        case 'archiving':
            return m.lifecycle_state_archiving()
        case 'deleting':
            return m.lifecycle_state_deleting()
        default:
            return m.lifecycle_state_deleted()
    }
}
export function ResourceLifecycleSection({
    kind,
    id,
    inArchives = false,
}: {
    readonly kind: Kind
    readonly id: string
    readonly inArchives?: boolean
}) {
    useLanguage()
    const access = useOptionalProjectAccess()
    const global = useDashboardGlobal()
    const search = useSearch({ from: '/dashboard' })
    const params = useParams({ strict: false })
    const archiveContext = {
        workspaceId: global.selectedWorkspaceId ?? undefined,
        projectId: params.projectId ?? search.projectId ?? 'none',
    }
    const queryClient = useQueryClient()
    const router = useRouter()
    const navigate = useNavigate()
    const [action, setAction] = useState<'archive' | 'restore' | 'delete' | null>(null)
    const [confirmName, setConfirmName] = useState('')
    const [cancelPending, setCancelPending] = useState(false)
    const [acknowledgeUncertain, setAcknowledgeUncertain] = useState(false)
    const [replacementWorkspaceId, setReplacement] = useState('')
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [removed, setRemoved] = useState(false)
    const impact = useQuery({
        queryKey: ['resource-impact', kind, id],
        queryFn: () => api.getResourceImpact(kind, id),
        retry: false,
        refetchInterval: query =>
            ['archiving', 'deleting'].includes(query.state.data?.state ?? '') ? 1500 : false,
    })
    const workspaces = useQuery({
        queryKey: ['lifecycle-workspaces'],
        queryFn: () => api.listWorkspaces(),
        enabled: kind === 'workspace',
    })
    if (impact.error instanceof ApiError && [403, 404].includes(impact.error.status)) return null
    if (impact.isError && !impact.data)
        return (
            <div role="alert">
                {m.lifecycle_refresh_required()}{' '}
                <Button variant="outline" onClick={() => void impact.refetch()}>
                    {m.common_retry()}
                </Button>
            </div>
        )
    if (!impact.data) return <p role="status">{m.common_loading()}</p>
    const data = impact.data
    const busy = ['archiving', 'deleting'].includes(data.state)
    const countLabels: Record<string, () => string> = {
        channels: m.lifecycle_count_channels,
        posts: m.lifecycle_count_posts,
        publication_composer_drafts: m.lifecycle_count_drafts,
        publications: m.lifecycle_count_publications,
        media_assets: m.lifecycle_count_media,
        publishers: m.lifecycle_count_connections,
        audit_events: m.lifecycle_count_history,
        project_user_grants: m.lifecycle_count_members,
        project_team_grants: m.lifecycle_count_groups,
        mediaBytes: m.lifecycle_count_bytes,
        workspaceMembers: m.access_members_title,
        workspaceGroups: m.access_workspace_groups_title,
    }
    const publicationLabels: Record<string, () => string> = {
        draft: m.publication_state_draft,
        scheduled: m.publication_state_queued,
        ready: m.publication_state_ready,
        publishing: m.publication_state_publishing,
        published: m.publication_state_published,
        failed: m.publication_state_failed,
        ambiguous: m.publication_state_needs_review,
        cancelled: m.publication_state_cancelled,
    }
    async function submit() {
        if (!action || pending || (access !== null && !access.canWrite())) return
        setPending(true)
        setError(null)
        try {
            const result = await api.changeResource(kind, id, action, {
                fingerprint: data.fingerprint,
                cancelPending,
                confirmName,
                acknowledgeUncertain,
                ...(replacementWorkspaceId ? { replacementWorkspaceId } : {}),
            })
            queryClient.setQueryData(['resource-impact', kind, id], result)
            setAction(null)
            toast.add({
                title: action === 'delete' ? m.lifecycle_receipt() : stateLabel(result.state),
                type: 'success',
            })
            if (result.state === 'deleted') setRemoved(true)
            if (kind === 'project')
                await queryClient.invalidateQueries({
                    queryKey: [...projectQueryKeys.data(id), 'lifecycle'],
                })
            await queryClient.invalidateQueries({ queryKey: ['resource-archives'] })
            if (action === 'delete')
                await navigate({ to: '/dashboard/settings/archives', search: archiveContext })
            await router.invalidate()
        } catch (caught) {
            access?.reportRefusal(caught)
            setError(formatApiError(caught))
            await impact.refetch()
        } finally {
            setPending(false)
        }
    }
    function open(next: 'archive' | 'restore' | 'delete') {
        setAction(next)
        setConfirmName('')
        setCancelPending(false)
        setAcknowledgeUncertain(false)
        setReplacement('')
        setError(null)
        void impact.refetch()
    }
    return (
        <section className="mt-8 border-t border-border pt-6" aria-label={m.lifecycle_title()}>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="flex min-w-0 items-center gap-3 font-heading text-lg font-medium">
                    {inArchives ? <ResourceAvatar kind={kind} name={data.name} seed={id} /> : null}
                    <span className="break-words">
                        {inArchives ? data.name : m.lifecycle_title()}
                    </span>
                </h2>
                {!inArchives ? (
                    <Link
                        className="text-sm underline"
                        search={archiveContext}
                        to="/dashboard/settings/archives">
                        {m.lifecycle_archives()}
                    </Link>
                ) : null}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
                {inArchives
                    ? kind === 'project'
                        ? m.nav_project()
                        : m.nav_workspace()
                    : data.name}{' '}
                · {stateLabel(data.state)}
            </p>
            {impact.isError && action === null ? (
                <QueryErrorState className="mt-4" onRetry={() => void impact.refetch()} />
            ) : null}
            {removed || data.state === 'deleted' ? (
                <p role="status" className="mt-3">
                    {m.lifecycle_done()}
                </p>
            ) : busy ? (
                <p role="status" className="mt-3">
                    {data.cleanupPending > 0
                        ? m.lifecycle_cleanup_waiting({ count: data.cleanupPending })
                        : m.lifecycle_waiting()}
                </p>
            ) : (
                <div className="mt-4 flex flex-wrap gap-3">
                    {data.state === 'active' ? (
                        <Button variant="outline" onClick={() => open('archive')}>
                            {m.lifecycle_archive()}
                        </Button>
                    ) : (
                        <Button variant="outline" onClick={() => open('restore')}>
                            {m.lifecycle_restore()}
                        </Button>
                    )}
                    <Button variant="destructive" onClick={() => open('delete')}>
                        {m.lifecycle_delete()}
                    </Button>
                </div>
            )}
            <Dialog
                open={action !== null}
                onOpenChange={value => {
                    if (!pending && !value) setAction(null)
                }}>
                <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            {action === 'delete'
                                ? m.lifecycle_delete()
                                : action === 'restore'
                                  ? m.lifecycle_restore()
                                  : m.lifecycle_archive()}{' '}
                            — {data.name}
                        </DialogTitle>
                    </DialogHeader>
                    <DialogDescription className="text-sm leading-6">
                        {action === 'delete'
                            ? m.lifecycle_delete_explanation()
                            : action === 'restore'
                              ? kind === 'workspace'
                                  ? m.lifecycle_restore_workspace_explanation()
                                  : m.lifecycle_restore_explanation()
                              : m.lifecycle_archive_explanation()}
                    </DialogDescription>
                    <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-sm">
                        {Object.entries(data.counts).map(([key, value]) => (
                            <div key={key} className="contents">
                                <dt>{countLabels[key]?.() ?? key}</dt>
                                <dd>{value}</dd>
                            </div>
                        ))}
                        {Object.entries(data.publications).map(([state, count]) => (
                            <div className="contents" key={`publication-${state}`}>
                                <dt>
                                    {m.lifecycle_count_publications()} ·{' '}
                                    {publicationLabels[state]?.() ?? state}
                                </dt>
                                <dd>{count}</dd>
                            </div>
                        ))}
                        <dt>{m.lifecycle_pending()}</dt>
                        <dd>{data.pending}</dd>
                        <dt>{m.lifecycle_uncertain()}</dt>
                        <dd>{data.uncertain}</dd>
                        <dt>{m.lifecycle_active_operations()}</dt>
                        <dd>{data.active}</dd>
                    </dl>
                    {kind === 'workspace' && (
                        <ul className="space-y-1 text-sm">
                            {data.projects.map(project => (
                                <li key={project.id}>
                                    {project.name} · {stateLabel(project.state)}
                                </li>
                            ))}
                        </ul>
                    )}
                    {action !== 'restore' && data.pending > 0 && (
                        <label className="flex items-start gap-2 text-sm">
                            <input
                                type="checkbox"
                                checked={cancelPending}
                                onChange={event => setCancelPending(event.target.checked)}
                            />
                            {m.lifecycle_cancel_pending()}
                        </label>
                    )}
                    {action !== 'restore' && data.isDefault && (
                        <label className="grid gap-2 text-sm">
                            {m.lifecycle_replacement()}
                            <select
                                className="w-full rounded-md border border-input bg-background p-2"
                                value={replacementWorkspaceId}
                                onChange={event => setReplacement(event.target.value)}>
                                <option value="">{m.lifecycle_replacement_hint()}</option>
                                {workspaces.data?.workspaces
                                    .filter(
                                        workspace =>
                                            workspace.id !== id &&
                                            ['owner', 'admin'].includes(workspace.role)
                                    )
                                    .map(workspace => (
                                        <option value={workspace.id} key={workspace.id}>
                                            {workspace.name}
                                        </option>
                                    ))}
                            </select>
                        </label>
                    )}
                    {action === 'delete' && (
                        <>
                            <label className="grid gap-2 text-sm">
                                {m.lifecycle_confirm_name()}
                                <Input
                                    value={confirmName}
                                    onChange={event => setConfirmName(event.target.value)}
                                    autoComplete="off"
                                />
                            </label>
                            {data.uncertain > 0 && (
                                <label className="flex items-start gap-2 text-sm">
                                    <input
                                        type="checkbox"
                                        checked={acknowledgeUncertain}
                                        onChange={event =>
                                            setAcknowledgeUncertain(event.target.checked)
                                        }
                                    />
                                    {m.lifecycle_ack_uncertain()}
                                </label>
                            )}
                        </>
                    )}
                    {impact.isError ? (
                        <QueryErrorState onRetry={() => void impact.refetch()} />
                    ) : null}
                    {error && (
                        <p role="alert" className="text-sm text-destructive">
                            {error}
                        </p>
                    )}
                    <DialogFooter>
                        <Button
                            variant="outline"
                            disabled={pending}
                            onClick={() => setAction(null)}>
                            {m.common_cancel()}
                        </Button>
                        <Button
                            variant={action === 'delete' ? 'destructive' : 'default'}
                            disabled={
                                pending ||
                                impact.isFetching ||
                                impact.isError ||
                                (action !== 'restore' &&
                                    ((data.pending > 0 && !cancelPending) ||
                                        (data.isDefault && !replacementWorkspaceId))) ||
                                (action === 'delete' &&
                                    (confirmName !== data.name ||
                                        (data.uncertain > 0 && !acknowledgeUncertain)))
                            }
                            onClick={() => void submit()}>
                            {pending
                                ? m.common_loading()
                                : action === 'delete'
                                  ? m.lifecycle_delete()
                                  : action === 'restore'
                                    ? m.lifecycle_restore()
                                    : m.lifecycle_archive()}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </section>
    )
}

export function ResourceArchives() {
    useLanguage()
    const resources = useQuery({
        queryKey: ['resource-archives'],
        queryFn: async () => (await api.listResourceRetirements()).resources,
        retry: false,
    })
    return (
        <main className="min-w-0 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
            <AccessPageHeader title={m.lifecycle_archives()} />
            <PageColumn variant="management">
                {resources.isPending ? (
                    <p role="status">{m.common_loading()}</p>
                ) : resources.isError ? (
                    <QueryErrorState onRetry={() => void resources.refetch()} />
                ) : resources.data.length === 0 ? (
                    <p className="mt-4 text-muted-foreground">{m.lifecycle_empty()}</p>
                ) : (
                    resources.data.map(resource => (
                        <ResourceLifecycleSection
                            key={`${resource.kind}:${resource.id}`}
                            kind={resource.kind}
                            id={resource.id}
                            inArchives
                        />
                    ))
                )}
            </PageColumn>
        </main>
    )
}

export function ProjectLifecycleBoundary({
    projectId,
    children,
}: {
    readonly projectId: string
    readonly children: ReactNode
}) {
    useLanguage()
    const query = useProjectLifecycle(projectId)
    const readOnly = !query.data || query.data.state !== 'active'
    return (
        <>
            {readOnly && (
                <div role="status" className="border-b border-border bg-muted px-4 py-3 text-sm">
                    {query.isError
                        ? m.lifecycle_refresh_required()
                        : query.data?.state === 'archived'
                          ? m.lifecycle_archived_notice()
                          : m.lifecycle_waiting()}{' '}
                    <Link
                        className="underline"
                        search={{ projectId }}
                        to="/dashboard/settings/archives">
                        {m.lifecycle_manage()}
                    </Link>
                </div>
            )}
            <fieldset disabled={readOnly} className="contents">
                {children}
            </fieldset>
        </>
    )
}

export function useProjectLifecycle(projectId: string) {
    return useQuery({
        queryKey: [...projectQueryKeys.data(projectId), 'lifecycle'],
        queryFn: () => api.getProjectLifecycleState(projectId),
        refetchInterval: query =>
            ['archiving', 'deleting'].includes(query.state.data?.state ?? '') ? 1500 : false,
    })
}
