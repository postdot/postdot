import { Button } from '@postdot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@postdot/ui/components/dialog'
import { Field, FieldLabel } from '@postdot/ui/components/field'
import { Input } from '@postdot/ui/components/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@postdot/ui/components/select'
import { toast } from '@postdot/ui/components/toast'
import { cn } from '@postdot/ui/lib/utils'
import { CheckIcon } from '@solar-icons/react/linear/check'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useRouter, useNavigate, useSearch, useParams } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'

import { AccessPageHeader } from '@/components/access-page-header'
import { ResourceAvatar } from '@/components/identity-visuals'
import { PageColumn } from '@/components/page-column'
import { QueryErrorState } from '@/components/query-error-state'
import { StatusText, type StatusTone } from '@/components/status-text'
import { ApiError, api, formatApiError } from '@/lib/api'
import { useDashboardGlobal } from '@/lib/dashboard-context'
import { formatNumber } from '@/lib/format'
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
function stateTone(state: string): StatusTone {
    switch (state) {
        case 'active':
            return 'positive'
        case 'archiving':
        case 'deleting':
            return 'progress'
        case 'deleted':
            return 'critical'
        default:
            return 'neutral'
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
    const { locale } = useLanguage()
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
    // pending includes comment work; only publication states count publications.
    const scheduled = (data.publications.scheduled ?? 0) + (data.publications.ready ?? 0)
    const channels = data.counts.channels ?? 0
    const media = data.counts.media_assets ?? 0
    const archiveLabel =
        kind === 'project' ? m.lifecycle_archive_project() : m.lifecycle_archive_workspace()
    const actionLabel =
        action === 'delete'
            ? m.lifecycle_delete()
            : action === 'restore'
              ? m.lifecycle_restore()
              : archiveLabel
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
        <section className="mt-10 border-t border-border pt-6" aria-label={m.lifecycle_title()}>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="flex min-w-0 items-center gap-3 font-heading text-lg font-medium">
                    {inArchives ? <ResourceAvatar kind={kind} name={data.name} seed={id} /> : null}
                    <span className="break-words">
                        {inArchives ? data.name : m.lifecycle_title()}
                    </span>
                </h2>
            </div>
            {inArchives ? (
                <p className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                    <span>{kind === 'project' ? m.nav_project() : m.nav_workspace()}</span>
                    <span aria-hidden="true">·</span>
                    <StatusText tone={stateTone(data.state)}>{stateLabel(data.state)}</StatusText>
                </p>
            ) : null}
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
                        ? m.lifecycle_cleanup_waiting()
                        : m.lifecycle_waiting()}
                </p>
            ) : (
                <div className="mt-4 space-y-6">
                    {data.state === 'active' ? (
                        <Button variant="outline" onClick={() => open('archive')}>
                            {archiveLabel}
                        </Button>
                    ) : (
                        <Button variant="outline" onClick={() => open('restore')}>
                            {m.lifecycle_restore()}
                        </Button>
                    )}
                    <div className="border-t border-border pt-4">
                        <Button
                            variant="ghost"
                            className="text-muted-foreground"
                            onClick={() => open('delete')}>
                            {m.lifecycle_delete()}
                        </Button>
                    </div>
                </div>
            )}
            <Dialog
                open={action !== null}
                onOpenChange={value => {
                    if (!pending && !value) setAction(null)
                }}>
                <DialogContent className="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col overflow-hidden sm:max-w-lg">
                    <DialogHeader className="shrink-0">
                        <DialogTitle>{actionLabel}</DialogTitle>
                        {action === 'restore' ? (
                            <DialogDescription>
                                {kind === 'workspace'
                                    ? m.lifecycle_restore_workspace_explanation()
                                    : m.lifecycle_restore_explanation()}
                            </DialogDescription>
                        ) : (
                            <DialogDescription
                                render={<div />}
                                className="space-y-2 leading-6"
                                data-lifecycle-consequences="true">
                                <p>
                                    {scheduled === 0
                                        ? m.lifecycle_no_scheduled()
                                        : m.lifecycle_scheduled_cancelled({
                                              count: scheduled,
                                              total: formatNumber(scheduled, locale),
                                          })}
                                </p>
                                <p>
                                    {action === 'delete'
                                        ? kind === 'project'
                                            ? m.lifecycle_project_channels_removed({
                                                  count: channels,
                                                  total: formatNumber(channels, locale),
                                              })
                                            : m.lifecycle_workspace_channels_deleted({
                                                  count: channels,
                                                  total: formatNumber(channels, locale),
                                              })
                                        : kind === 'project'
                                          ? m.lifecycle_project_channels_stopped({
                                                count: channels,
                                                total: formatNumber(channels, locale),
                                            })
                                          : m.lifecycle_workspace_channels_stopped({
                                                count: channels,
                                                total: formatNumber(channels, locale),
                                            })}
                                </p>
                                <p>
                                    {media === 0
                                        ? action === 'delete'
                                            ? m.lifecycle_posts_deleted()
                                            : m.lifecycle_posts_retained()
                                        : action === 'delete'
                                          ? m.lifecycle_media_deleted({
                                                count: media,
                                                total: formatNumber(media, locale),
                                            })
                                          : m.lifecycle_media_retained({
                                                count: media,
                                                total: formatNumber(media, locale),
                                            })}
                                </p>
                            </DialogDescription>
                        )}
                    </DialogHeader>
                    <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain">
                        <div className="flex items-center gap-2.5 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                            <ResourceAvatar kind={kind} name={data.name} seed={id} size="sm" />
                            <span className="min-w-0 truncate font-medium">{data.name}</span>
                        </div>
                        {action === 'delete' && (
                            <Field className="gap-1.5">
                                <FieldLabel htmlFor="lifecycle-confirm-name">
                                    {m.lifecycle_confirm_name({ name: data.name })}
                                </FieldLabel>
                                <Input
                                    id="lifecycle-confirm-name"
                                    value={confirmName}
                                    onChange={event => setConfirmName(event.target.value)}
                                    autoComplete="off"
                                />
                            </Field>
                        )}
                        {action !== 'restore' && data.pending > 0 && (
                            <LifecycleCheckbox
                                checked={cancelPending}
                                label={m.lifecycle_cancel_pending()}
                                onChange={setCancelPending}
                            />
                        )}
                        {action !== 'restore' && data.isDefault && (
                            <Field className="gap-2">
                                <FieldLabel htmlFor="lifecycle-replacement">
                                    {m.lifecycle_replacement()}
                                </FieldLabel>
                                <Select
                                    value={replacementWorkspaceId}
                                    onValueChange={value => setReplacement(value ?? '')}>
                                    <SelectTrigger
                                        className="w-full"
                                        id="lifecycle-replacement"
                                        aria-label={m.lifecycle_replacement()}>
                                        <SelectValue placeholder={m.lifecycle_replacement_hint()} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {workspaces.data?.workspaces
                                            .filter(
                                                workspace =>
                                                    workspace.id !== id &&
                                                    ['owner', 'admin'].includes(workspace.role)
                                            )
                                            .map(workspace => (
                                                <SelectItem value={workspace.id} key={workspace.id}>
                                                    {workspace.name}
                                                </SelectItem>
                                            ))}
                                    </SelectContent>
                                </Select>
                            </Field>
                        )}
                        {action === 'delete' && data.uncertain > 0 && (
                            <LifecycleCheckbox
                                checked={acknowledgeUncertain}
                                label={m.lifecycle_ack_uncertain()}
                                onChange={setAcknowledgeUncertain}
                            />
                        )}
                        {impact.isError ? (
                            <QueryErrorState onRetry={() => void impact.refetch()} />
                        ) : null}
                        {error && (
                            <p role="alert" className="text-sm text-destructive">
                                {error}
                            </p>
                        )}
                    </div>
                    <DialogFooter className="shrink-0">
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
                            {pending ? m.common_loading() : actionLabel}
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
            <AccessPageHeader column="management" title={m.lifecycle_archives()} />
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

function LifecycleCheckbox({
    checked,
    label,
    onChange,
}: {
    readonly checked: boolean
    readonly label: string
    readonly onChange: (checked: boolean) => void
}) {
    return (
        <label className="relative flex cursor-pointer items-start gap-2.5 text-sm">
            <input
                checked={checked}
                className="peer absolute left-0 top-0.5 size-4 cursor-pointer opacity-0"
                onChange={event => onChange(event.currentTarget.checked)}
                type="checkbox"
            />
            <span
                aria-hidden="true"
                className={cn(
                    'pointer-events-none mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-muted-foreground/45 bg-transparent text-transparent transition-[background-color,border-color,box-shadow]',
                    'peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
                    checked && 'border-primary bg-primary text-primary-foreground shadow-control'
                )}>
                {checked ? <CheckIcon className="size-3" /> : null}
            </span>
            <span>{label}</span>
        </label>
    )
}
