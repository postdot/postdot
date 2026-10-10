import { Button } from '@herald/ui/components/button'
import {
    Command,
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@herald/ui/components/command'
import { Kbd } from '@herald/ui/components/kbd'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@herald/ui/components/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@herald/ui/components/tooltip'
import { DocumentTextIcon } from '@solar-icons/react/linear/document-text'
import { LinkIcon } from '@solar-icons/react/linear/link'
import { MagnifierIcon } from '@solar-icons/react/linear/magnifier'
import { SettingsIcon } from '@solar-icons/react/linear/settings'
import { Widget2Icon } from '@solar-icons/react/linear/widget-2'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { api } from '@/lib/api'
import { useDashboardGlobal } from '@/lib/dashboard-context'
import * as m from '@/paraglide/messages.js'

type SearchResult = Awaited<ReturnType<typeof api.search>>['results'][number]

export function DashboardSearch({
    projectId,
    workspaceId,
}: {
    projectId: string | null
    workspaceId: string | null
}) {
    const navigate = useNavigate()
    const { isInstanceAdmin, workspaces } = useDashboardGlobal()
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const [scope, setScope] = useState('all')
    const [results, setResults] = useState<SearchResult[]>([])
    const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
    const [attempt, setAttempt] = useState(0)
    const needle = query.trim()
    const selectedProject = scope === 'current' ? projectId : null
    const searching = needle.length >= 2

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (
                (event.metaKey || event.ctrlKey) &&
                event.key.toLowerCase() === 'k' &&
                !event.isComposing
            ) {
                event.preventDefault()
                setOpen(value => !value)
            }
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [])

    useEffect(() => {
        let active = true
        setResults([])
        if (!open || !searching) {
            setPhase('idle')
            return
        }
        setPhase('loading')
        const timer = window.setTimeout(() => {
            void api
                .search(needle, selectedProject ?? undefined)
                .then(response => {
                    if (active) {
                        setResults(response.results)
                        setPhase('ready')
                    }
                })
                .catch(() => {
                    if (active) setPhase('error')
                })
        }, 250)
        return () => {
            active = false
            window.clearTimeout(timer)
        }
    }, [open, needle, selectedProject, searching, attempt])

    const context = new URLSearchParams({
        projectId: projectId ?? 'none',
        ...(workspaceId === null ? {} : { workspaceId }),
    }).toString()
    const pages = [
        {
            title: m.nav_preferences_general(),
            href: `/dashboard/preferences?${context}`,
            keywords: m.search_aliases_preferences(),
        },
        {
            title: m.nav_preferences_account(),
            href: `/dashboard/preferences/account?${context}`,
            keywords: m.search_aliases_account(),
        },
        {
            title: m.nav_preferences_api_keys(),
            href: `/dashboard/preferences/api-keys?${context}`,
            keywords: m.search_aliases_api_keys(),
        },
        ...(isInstanceAdmin
            ? [
                  {
                      title: m.nav_installation(),
                      href: `/dashboard/settings?${context}`,
                      keywords: m.search_aliases_installation(),
                  },
                  {
                      title: m.nav_instance_access(),
                      href: `/dashboard/settings/access?${context}`,
                      keywords: m.search_aliases_instance_access(),
                  },
                  {
                      title: m.nav_instance_provider_apps(),
                      href: `/dashboard/settings/provider-applications?${context}`,
                      keywords: m.search_aliases_provider_apps(),
                  },
              ]
            : []),
        ...(workspaces.some(
            workspace =>
                workspace.id === workspaceId &&
                (workspace.role === 'owner' || workspace.role === 'admin')
        )
            ? [
                  {
                      title: m.nav_workspace_administration(),
                      href: `/dashboard/settings/workspace?${context}`,
                      keywords: m.search_aliases_workspace(),
                  },
              ]
            : []),
        ...(projectId === null
            ? []
            : [
                  {
                      title: m.nav_overview(),
                      href: `/dashboard/projects/${encodeURIComponent(projectId)}/overview`,
                      keywords: m.search_aliases_overview(),
                  },
                  {
                      title: m.nav_queue(),
                      href: `/dashboard/projects/${encodeURIComponent(projectId)}/queue`,
                      keywords: m.search_aliases_queue(),
                  },
                  {
                      title: m.nav_channels(),
                      href: `/dashboard/projects/${encodeURIComponent(projectId)}/channels`,
                      keywords: m.search_aliases_channels(),
                  },
                  {
                      title: m.nav_media(),
                      href: `/dashboard/projects/${encodeURIComponent(projectId)}/media`,
                      keywords: m.search_aliases_media(),
                  },
                  {
                      title: m.nav_performance(),
                      href: `/dashboard/projects/${encodeURIComponent(projectId)}/performance`,
                      keywords: m.search_aliases_performance(),
                  },
              ]),
    ].filter(page =>
        `${page.title} ${page.keywords}`.toLocaleLowerCase().includes(needle.toLocaleLowerCase())
    )

    function go(href: string) {
        setOpen(false)
        void navigate({ href })
    }

    return (
        <>
            <Tooltip>
                <TooltipTrigger
                    render={
                        <Button
                            variant="ghost"
                            size="sm"
                            aria-label={m.search_open()}
                            onClick={() => setOpen(true)}
                            className="gap-2"
                        />
                    }>
                    <MagnifierIcon aria-hidden="true" className="size-4" />
                    <span className="hidden lg:inline">{m.search_open()}</span>
                    <Kbd className="hidden sm:inline-flex">
                        {navigator.platform.includes('Mac') ? '⌘ K' : 'Ctrl K'}
                    </Kbd>
                </TooltipTrigger>
                <TooltipContent>{m.search_open()}</TooltipContent>
            </Tooltip>
            <CommandDialog open={open} onOpenChange={setOpen} title={m.search_open()}>
                <Command shouldFilter={false}>
                    <CommandInput
                        aria-label={m.search_open()}
                        placeholder={m.search_placeholder()}
                        value={query}
                        onValueChange={setQuery}
                        maxLength={200}
                    />
                    <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
                        <Select value={scope} onValueChange={value => setScope(value ?? 'all')}>
                            <SelectTrigger
                                size="sm"
                                className="w-auto border-0 bg-transparent shadow-none"
                                aria-label={m.search_scope()}>
                                <SelectValue>
                                    {scope === 'current' && projectId !== null
                                        ? m.search_current_project()
                                        : m.search_all_projects()}
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{m.search_all_projects()}</SelectItem>
                                {projectId !== null && (
                                    <SelectItem value="current">
                                        {m.search_current_project()}
                                    </SelectItem>
                                )}
                            </SelectContent>
                        </Select>
                    </div>
                    <CommandList aria-busy={phase === 'loading'}>
                        {pages.length > 0 && (
                            <CommandGroup heading={m.search_pages()}>
                                {pages.map(page => (
                                    <CommandItem
                                        key={page.href}
                                        value={page.href}
                                        onSelect={() => go(page.href)}>
                                        <SettingsIcon
                                            aria-hidden="true"
                                            className="size-5 shrink-0 text-muted-foreground"
                                        />
                                        <span>{page.title}</span>
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        )}
                        {(['post', 'channel', 'project'] as const).map(kind => {
                            const items = results.filter(result => result.kind === kind)
                            const Icon =
                                kind === 'post'
                                    ? DocumentTextIcon
                                    : kind === 'channel'
                                      ? LinkIcon
                                      : Widget2Icon
                            const heading =
                                kind === 'post'
                                    ? m.search_posts()
                                    : kind === 'channel'
                                      ? m.nav_channels()
                                      : m.search_projects()
                            return items.length === 0 ? null : (
                                <CommandGroup key={kind} heading={heading}>
                                    {items.map(result => (
                                        <CommandItem
                                            key={`${kind}:${result.id}`}
                                            value={`${kind}:${result.id}`}
                                            onSelect={() =>
                                                go(
                                                    `/dashboard/projects/${encodeURIComponent(result.projectId)}/${kind === 'post' ? `posts/${encodeURIComponent(result.id)}` : kind === 'channel' ? `channels#publisher-connection-${encodeURIComponent(result.id)}` : 'overview'}`
                                                )
                                            }>
                                            <Icon
                                                aria-hidden="true"
                                                className="size-5 shrink-0 text-muted-foreground"
                                            />
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate font-medium">
                                                    {result.title || m.search_untitled_post()}
                                                </div>
                                                <div className="truncate text-xs text-muted-foreground">
                                                    {result.projectName}
                                                    {result.description
                                                        ? ` · ${result.description}`
                                                        : ''}
                                                </div>
                                            </div>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            )
                        })}
                        {phase === 'loading' && (
                            <div role="status" className="px-3 py-4 text-sm text-muted-foreground">
                                {m.search_loading()}
                            </div>
                        )}
                        {phase === 'error' && (
                            <div
                                role="alert"
                                className="flex items-center justify-between gap-3 px-3 py-4 text-sm">
                                <span>{m.search_failed()}</span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setAttempt(value => value + 1)}>
                                    {m.common_retry()}
                                </Button>
                            </div>
                        )}
                        {phase !== 'loading' && phase !== 'error' && (
                            <CommandEmpty>
                                {searching ? m.search_empty() : m.search_start_typing()}
                            </CommandEmpty>
                        )}
                        {results.some(
                            result =>
                                results.filter(item => item.kind === result.kind).length === 10
                        ) && (
                            <p className="px-3 py-2 text-xs text-muted-foreground">
                                {m.search_refine()}
                            </p>
                        )}
                    </CommandList>
                </Command>
            </CommandDialog>
        </>
    )
}
