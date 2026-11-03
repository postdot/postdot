import { Button } from '@postdot/ui/components/button'
import {
    Command,
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@postdot/ui/components/command'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@postdot/ui/components/empty'
import { Kbd, KbdGroup } from '@postdot/ui/components/kbd'
import { Switch } from '@postdot/ui/components/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@postdot/ui/components/tooltip'
import { ArchiveIcon } from '@solar-icons/react/linear/archive'
import { CalendarAddIcon } from '@solar-icons/react/linear/calendar-add'
import { CalendarMinimalisticIcon } from '@solar-icons/react/linear/calendar-minimalistic'
import { ChartSquareIcon } from '@solar-icons/react/linear/chart-square'
import { DocumentTextIcon } from '@solar-icons/react/linear/document-text'
import { FileTextIcon } from '@solar-icons/react/linear/file-text'
import { GalleryIcon } from '@solar-icons/react/linear/gallery'
import { KeyboardIcon } from '@solar-icons/react/linear/keyboard'
import { LinkIcon } from '@solar-icons/react/linear/link'
import { ListIcon } from '@solar-icons/react/linear/list'
import { MagnifierIcon } from '@solar-icons/react/linear/magnifier'
import { SettingsIcon } from '@solar-icons/react/linear/settings'
import { Widget2Icon } from '@solar-icons/react/linear/widget-2'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { EmptyIllustration } from '@/components/empty-state'
import { api } from '@/lib/api'
import { useDashboardGlobal } from '@/lib/dashboard-context'
import {
    getAppShortcuts,
    getShortcutCategoryTitle,
    isMac,
    isShortcutsQuery,
    type ShortcutCategory,
} from '@/lib/shortcuts'
import * as m from '@/paraglide/messages.js'

type SearchResult = Awaited<ReturnType<typeof api.search>>['results'][number]

function isEditableTarget(target: EventTarget | null): boolean {
    return (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            target instanceof HTMLSelectElement)
    )
}

function getShortcutIcon(category: ShortcutCategory) {
    switch (category) {
        case 'composer':
            return FileTextIcon
        case 'calendar':
            return CalendarMinimalisticIcon
        case 'media':
            return GalleryIcon
        case 'general':
        default:
            return KeyboardIcon
    }
}

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
    const isShortcutsMode = isShortcutsQuery(needle)
    const selectedProject = scope === 'current' ? projectId : null
    const searching = needle.length >= 2 && !isShortcutsMode
    const allShortcuts = getAppShortcuts()

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.isComposing) return
            const hasMod = event.metaKey || event.ctrlKey
            if (hasMod && event.key.toLowerCase() === 'k') {
                event.preventDefault()
                setOpen(value => !value)
            } else if (hasMod && event.key.toLowerCase() === 'n' && projectId !== null) {
                if (!isEditableTarget(event.target)) {
                    event.preventDefault()
                    setOpen(false)
                    void navigate({
                        href: `/dashboard/projects/${encodeURIComponent(projectId)}/publications/new`,
                    })
                }
            }
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [navigate, projectId])

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

    const pages = isShortcutsMode
        ? []
        : [
              {
                  title: m.nav_projects(),
                  href: `/dashboard?${new URLSearchParams({ projectId: 'none', ...(workspaceId === null ? {} : { workspaceId }) })}`,
                  keywords: m.search_projects(),
              },
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
              {
                  title: m.lifecycle_archives(),
                  href: `/dashboard/settings/archives?${context}`,
                  keywords: m.nav_resources(),
              },
              ...(isInstanceAdmin
                  ? [
                        {
                            title: m.nav_instance(),
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
              `${page.title} ${page.keywords}`
                  .toLocaleLowerCase()
                  .includes(needle.toLocaleLowerCase())
          )

    const matchingShortcuts = allShortcuts.filter(item => {
        if (isShortcutsMode) return true
        if (!searching) return false
        const text = `${item.title()} ${item.keywords}`.toLowerCase()
        return text.includes(needle.toLowerCase())
    })

    function go(href: string) {
        setOpen(false)
        void navigate({ href })
    }

    const shortcutCategories: readonly ShortcutCategory[] = [
        'composer',
        'general',
        'calendar',
        'media',
    ]

    const hasAnyContent =
        pages.length > 0 ||
        results.length > 0 ||
        matchingShortcuts.length > 0 ||
        isShortcutsMode ||
        (!searching && !isShortcutsMode)

    return (
        <>
            <Tooltip>
                <TooltipTrigger
                    render={
                        <Button
                            variant="ghost"
                            size="sm"
                            className="gap-2 px-2"
                            aria-label={m.search_open()}
                            onClick={() => setOpen(true)}
                        />
                    }>
                    <MagnifierIcon aria-hidden="true" className="size-4" />
                    <Kbd className="hidden sm:inline-flex">{isMac() ? '⌘ K' : 'Ctrl K'}</Kbd>
                </TooltipTrigger>
                <TooltipContent className="flex items-center gap-2">
                    {m.search_open()}
                    <Kbd>{isMac() ? '⌘ K' : 'Ctrl K'}</Kbd>
                </TooltipContent>
            </Tooltip>
            <CommandDialog
                open={open}
                onOpenChange={setOpen}
                title={m.search_open()}
                contentClassName="top-[min(18dvh,8rem)] translate-y-0">
                <Command shouldFilter={false}>
                    <CommandInput
                        aria-label={m.search_open()}
                        placeholder={m.search_placeholder()}
                        value={query}
                        onValueChange={setQuery}
                        maxLength={200}
                    />
                    <div className="flex h-14 shrink-0 items-center justify-between px-4 pb-2 pt-3">
                        {projectId !== null && !isShortcutsMode ? (
                            <label className="flex cursor-pointer items-center gap-2.5 text-xs text-muted-foreground">
                                <Switch
                                    className="bg-surface-selected data-checked:bg-foreground/35 dark:data-checked:bg-foreground/30 [&_[data-slot=switch-thumb]]:bg-white"
                                    checked={scope === 'all'}
                                    onCheckedChange={checked =>
                                        setScope(checked ? 'all' : 'current')
                                    }
                                />
                                {m.search_all_projects()}
                            </label>
                        ) : (
                            <span />
                        )}
                    </div>
                    <CommandList
                        className="relative h-[min(20rem,calc(82dvh-11rem))] max-h-none px-2 pb-3"
                        aria-busy={phase === 'loading'}>
                        {!searching && !isShortcutsMode && (
                            <CommandGroup heading={m.search_actions()}>
                                {projectId !== null ? (
                                    <CommandItem
                                        value="action:new_publication"
                                        onSelect={() =>
                                            go(
                                                `/dashboard/projects/${encodeURIComponent(projectId)}/publications/new`
                                            )
                                        }>
                                        <CalendarAddIcon
                                            aria-hidden="true"
                                            className="size-5 shrink-0 text-muted-foreground"
                                        />
                                        <div className="min-w-0 flex-1">
                                            <div className="font-medium">
                                                {m.search_action_new_publication()}
                                            </div>
                                            <div className="text-xs text-muted-foreground">
                                                {m.search_action_new_publication_desc()}
                                            </div>
                                        </div>
                                        <KbdGroup className="shrink-0">
                                            <Kbd>{isMac() ? '⌘' : 'Ctrl'}</Kbd>
                                            <Kbd>N</Kbd>
                                        </KbdGroup>
                                    </CommandItem>
                                ) : null}
                                <CommandItem
                                    value="action:shortcuts"
                                    onSelect={() => setQuery('?')}>
                                    <KeyboardIcon
                                        aria-hidden="true"
                                        className="size-5 shrink-0 text-muted-foreground"
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="font-medium">
                                            {m.search_action_shortcuts()}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {m.search_shortcuts_hint()}
                                        </div>
                                    </div>
                                    <KbdGroup className="shrink-0">
                                        <Kbd>?</Kbd>
                                    </KbdGroup>
                                </CommandItem>
                            </CommandGroup>
                        )}

                        {isShortcutsMode &&
                            shortcutCategories.map(category => {
                                const items = allShortcuts.filter(s => s.category === category)
                                if (items.length === 0) return null
                                const CategoryIcon = getShortcutIcon(category)
                                return (
                                    <CommandGroup
                                        key={category}
                                        heading={getShortcutCategoryTitle(category)}>
                                        {items.map(item => (
                                            <CommandItem
                                                key={item.id}
                                                value={`shortcut:${item.id}`}
                                                onSelect={() => {
                                                    const href = item.getHref?.({
                                                        projectId,
                                                        workspaceId,
                                                    })
                                                    if (href) {
                                                        go(href)
                                                    } else {
                                                        setOpen(false)
                                                    }
                                                }}>
                                                <CategoryIcon
                                                    aria-hidden="true"
                                                    className="size-5 shrink-0 text-muted-foreground"
                                                />
                                                <span className="min-w-0 flex-1 font-medium">
                                                    {item.title()}
                                                </span>
                                                <KbdGroup className="shrink-0">
                                                    {item.keys.map(k => (
                                                        <Kbd key={k}>{k}</Kbd>
                                                    ))}
                                                </KbdGroup>
                                            </CommandItem>
                                        ))}
                                    </CommandGroup>
                                )
                            })}

                        {searching && !isShortcutsMode && matchingShortcuts.length > 0 && (
                            <CommandGroup heading={m.search_shortcuts()}>
                                {matchingShortcuts.map(item => {
                                    const CategoryIcon = getShortcutIcon(item.category)
                                    return (
                                        <CommandItem
                                            key={`matching:${item.id}`}
                                            value={`matching:${item.id}`}
                                            onSelect={() => {
                                                const href = item.getHref?.({
                                                    projectId,
                                                    workspaceId,
                                                })
                                                if (href) {
                                                    go(href)
                                                } else {
                                                    setOpen(false)
                                                }
                                            }}>
                                            <CategoryIcon
                                                aria-hidden="true"
                                                className="size-5 shrink-0 text-muted-foreground"
                                            />
                                            <span className="min-w-0 flex-1 font-medium">
                                                {item.title()}
                                            </span>
                                            <KbdGroup className="shrink-0">
                                                {item.keys.map(k => (
                                                    <Kbd key={k}>{k}</Kbd>
                                                ))}
                                            </KbdGroup>
                                        </CommandItem>
                                    )
                                })}
                            </CommandGroup>
                        )}

                        {pages.length > 0 && (
                            <CommandGroup heading={m.search_pages()}>
                                {pages.map(page => {
                                    const PageIcon = page.href.startsWith(
                                        '/dashboard/settings/archives'
                                    )
                                        ? ArchiveIcon
                                        : page.href.endsWith('/overview')
                                          ? Widget2Icon
                                          : page.href.endsWith('/queue')
                                            ? ListIcon
                                            : page.href.endsWith('/channels')
                                              ? LinkIcon
                                              : page.href.endsWith('/media')
                                                ? GalleryIcon
                                                : page.href.endsWith('/performance')
                                                  ? ChartSquareIcon
                                                  : SettingsIcon
                                    return (
                                        <CommandItem
                                            key={page.href}
                                            value={page.href}
                                            onSelect={() => go(page.href)}>
                                            <PageIcon
                                                aria-hidden="true"
                                                className="size-5 shrink-0 text-muted-foreground"
                                            />
                                            <span>{page.title}</span>
                                        </CommandItem>
                                    )
                                })}
                            </CommandGroup>
                        )}

                        {(['post', 'channel', 'project', 'media'] as const).map(kind => {
                            const items = results.filter(result => result.kind === kind)
                            const Icon =
                                kind === 'post'
                                    ? DocumentTextIcon
                                    : kind === 'channel'
                                      ? LinkIcon
                                      : kind === 'media'
                                        ? GalleryIcon
                                        : Widget2Icon
                            const heading =
                                kind === 'post'
                                    ? m.search_posts()
                                    : kind === 'channel'
                                      ? m.nav_channels()
                                      : kind === 'media'
                                        ? m.nav_media()
                                        : m.search_projects()
                            return items.length === 0 ? null : (
                                <CommandGroup key={kind} heading={heading}>
                                    {items.map(result => (
                                        <CommandItem
                                            key={`${kind}:${result.id}`}
                                            value={`${kind}:${result.id}`}
                                            onSelect={() =>
                                                go(
                                                    `/dashboard/projects/${encodeURIComponent(result.projectId)}/${kind === 'post' ? `posts/${encodeURIComponent(result.id)}` : kind === 'channel' ? `channels#publisher-connection-${encodeURIComponent(result.id)}` : kind === 'media' ? `media?assetId=${encodeURIComponent(result.id)}` : 'overview'}`
                                                )
                                            }>
                                            {kind === 'media' &&
                                            result.contentType?.startsWith('image/') ? (
                                                <img
                                                    src={api.mediaContentUrl(
                                                        result.projectId,
                                                        result.id,
                                                        'thumbnail'
                                                    )}
                                                    alt=""
                                                    loading="lazy"
                                                    className="size-12 shrink-0 rounded-md bg-surface-inset object-cover"
                                                />
                                            ) : (
                                                <Icon
                                                    aria-hidden="true"
                                                    className="size-5 shrink-0 text-muted-foreground"
                                                />
                                            )}
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
                            <div
                                role="status"
                                aria-label={m.search_loading()}
                                className={
                                    pages.length === 0 && matchingShortcuts.length === 0
                                        ? 'absolute inset-0 flex items-center justify-center'
                                        : 'flex justify-center py-10'
                                }>
                                <MagnifierIcon
                                    aria-hidden="true"
                                    className="size-9 text-muted-foreground motion-safe:animate-[postdot-search-scan_1.4s_ease-in-out_infinite]"
                                />
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

                        {phase !== 'loading' && phase !== 'error' && !hasAnyContent && (
                            <CommandEmpty>
                                <Empty className="py-6">
                                    <EmptyMedia>
                                        <EmptyIllustration name="result" className="w-36 sm:w-36" />
                                    </EmptyMedia>
                                    <EmptyHeader>
                                        <EmptyTitle>
                                            {searching
                                                ? m.search_empty()
                                                : isShortcutsMode
                                                  ? m.search_shortcuts_empty()
                                                  : m.search_start_typing()}
                                        </EmptyTitle>
                                    </EmptyHeader>
                                </Empty>
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
                    <div className="flex h-11 shrink-0 items-center justify-between gap-4 px-4 text-xs text-muted-foreground">
                        <button
                            type="button"
                            onClick={() => setQuery(query === '?' ? '' : '?')}
                            className="flex cursor-pointer items-center gap-1.5 transition-colors hover:text-foreground">
                            <Kbd>?</Kbd>
                            <span>{m.search_shortcuts()}</span>
                        </button>
                        <div className="flex items-center gap-4">
                            <span className="flex items-center gap-1.5">
                                <Kbd>↑</Kbd>
                                <Kbd>↓</Kbd>
                                {m.search_navigate()}
                            </span>
                            <span className="flex items-center gap-1.5">
                                <Kbd>↵</Kbd>
                                {m.search_open_result()}
                            </span>
                            <span className="flex items-center gap-1.5">
                                <Kbd>Esc</Kbd>
                                {m.search_close()}
                            </span>
                        </div>
                    </div>
                </Command>
            </CommandDialog>
        </>
    )
}
