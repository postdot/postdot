import { Button } from '@postdot/ui/components/button'
import { ButtonGroup } from '@postdot/ui/components/button-group'
import { Input } from '@postdot/ui/components/input'
import { Kbd } from '@postdot/ui/components/kbd'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@postdot/ui/components/tooltip'
import { GalleryIcon } from '@solar-icons/react/linear/gallery'
import { ListIcon } from '@solar-icons/react/linear/list'
import { MagnifierIcon } from '@solar-icons/react/linear/magnifier'
import { Widget2Icon } from '@solar-icons/react/linear/widget-2'
import type { RegisterableHotkey } from '@tanstack/hotkeys'
import { useHotkeys } from '@tanstack/react-hotkeys'
import type { ReactNode } from 'react'

import { ActiveFilters, type FilterGroup, FilterMenu, SortMenu } from '@/components/filter-controls'
import { type MediaListDateFilter, type MediaListFamilyFilter, type MediaListSort } from '@/lib/api'
import type { MediaLibraryViewMode } from '@/lib/media-library-view'
import * as m from '@/paraglide/messages.js'

const MEDIA_VIEW_SHORTCUTS = {
    compact: 'C',
    grid: 'G',
    list: 'L',
} satisfies Record<MediaLibraryViewMode, RegisterableHotkey>

export interface MediaLibraryFeatureOptions {
    readonly search?: boolean
    readonly filters?: boolean
    readonly resultCount?: boolean
    readonly viewModes?: boolean
}

export interface MediaLibraryToolbarProps {
    readonly projectId: string
    readonly searchQuery: string
    readonly searchPending: boolean
    readonly mediaDateFilter: MediaListDateFilter
    readonly mediaFamilyFilter: MediaListFamilyFilter
    readonly mediaSort: MediaListSort
    readonly mediaViewMode: MediaLibraryViewMode
    readonly interactionDisabled: boolean
    readonly assetCount: number
    readonly totalAssets: number
    readonly className?: string
    readonly features?: MediaLibraryFeatureOptions
    readonly navigationAction?: ReactNode
    readonly showResultCount?: boolean
    readonly showViewControls?: boolean
    readonly onSearchQueryChange: (query: string) => void
    readonly onDateChange: (value: MediaListDateFilter) => void
    readonly onFamilyChange: (value: MediaListFamilyFilter) => void
    readonly onSortChange: (value: MediaListSort) => void
    readonly onViewModeChange: (value: MediaLibraryViewMode) => void
}

export function MediaLibraryToolbar({
    projectId,
    searchQuery,
    searchPending,
    mediaDateFilter,
    mediaFamilyFilter,
    mediaSort,
    mediaViewMode,
    interactionDisabled,
    assetCount,
    totalAssets,
    className,
    features,
    navigationAction,
    showResultCount: showResultCountProp = true,
    showViewControls: showViewControlsProp = true,
    onSearchQueryChange,
    onDateChange,
    onFamilyChange,
    onSortChange,
    onViewModeChange,
}: MediaLibraryToolbarProps) {
    const showSearch = features?.search ?? true
    const showFilters = features?.filters ?? true
    const showResultCount = (features?.resultCount ?? true) && showResultCountProp
    const showViewControls = (features?.viewModes ?? true) && showViewControlsProp

    const familyLabels: Record<MediaListFamilyFilter, string> = {
        all: m.media_filter_all_types(),
        image: m.media_filter_images(),
        video: m.media_filter_videos(),
        audio: m.media_filter_audio(),
        document: m.media_filter_documents(),
    }
    const dateLabels: Record<MediaListDateFilter, string> = {
        all: m.media_filter_all_dates(),
        last_24_hours: m.media_filter_last_24_hours(),
        last_7_days: m.media_filter_last_7_days(),
        last_30_days: m.media_filter_last_30_days(),
    }
    const sortLabels: Record<MediaListSort, string> = {
        newest: m.media_sort_newest(),
        oldest: m.media_sort_oldest(),
        name_asc: m.media_sort_name_asc(),
        name_desc: m.media_sort_name_desc(),
        largest: m.media_sort_largest(),
        smallest: m.media_sort_smallest(),
    }
    // One Filter menu and one Sort menu (DESIGN.md "Filters").
    const filterGroups: FilterGroup[] = [
        {
            anyValue: 'all',
            id: 'family',
            label: m.media_filter_type(),
            onChange: values => onFamilyChange((values[0] ?? 'all') as MediaListFamilyFilter),
            options: Object.entries(familyLabels).map(([value, label]) => ({ label, value })),
            selected: [mediaFamilyFilter],
        },
        {
            anyValue: 'all',
            id: 'date',
            label: m.media_filter_date(),
            onChange: values => onDateChange((values[0] ?? 'all') as MediaListDateFilter),
            options: Object.entries(dateLabels).map(([value, label]) => ({ label, value })),
            selected: [mediaDateFilter],
        },
    ]

    return (
        <div
            role="search"
            aria-label={m.media_search_label()}
            data-media-library-toolbar="true"
            className={`flex flex-col gap-3 ${className ?? ''}`}>
            <div className="flex flex-wrap items-center gap-2">
                {showSearch ? (
                    <div className="relative min-w-0 flex-1 sm:w-80 sm:flex-none">
                        <label className="sr-only" htmlFor={`media-search-${projectId}`}>
                            {m.media_search_label()}
                        </label>
                        <MagnifierIcon
                            aria-hidden="true"
                            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                        />
                        <Input
                            id={`media-search-${projectId}`}
                            type="search"
                            data-media-search="true"
                            value={searchQuery}
                            onChange={event => onSearchQueryChange(event.target.value)}
                            placeholder={m.media_search_placeholder()}
                            className="h-8 pl-9 text-sm"
                        />
                    </div>
                ) : null}
                <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
                    {showResultCount && searchPending ? (
                        <p aria-live="polite" className="mr-2 text-xs text-muted-foreground">
                            {m.media_searching()}
                        </p>
                    ) : showResultCount && assetCount > 0 && totalAssets > assetCount ? (
                        <p aria-live="polite" className="mr-2 text-xs text-muted-foreground">
                            {m.media_visible_count({ shown: assetCount, total: totalAssets })}
                        </p>
                    ) : null}
                    {showFilters ? (
                        <>
                            <FilterMenu groups={filterGroups} />
                            <SortMenu
                                onChange={value => onSortChange(value as MediaListSort)}
                                options={Object.entries(sortLabels).map(([value, label]) => ({
                                    label,
                                    value,
                                }))}
                                value={mediaSort}
                            />
                        </>
                    ) : null}
                    {showViewControls ? (
                        <MediaLibraryViewControls
                            disabled={interactionDisabled}
                            value={mediaViewMode}
                            onChange={onViewModeChange}
                        />
                    ) : null}
                    {navigationAction}
                </div>
            </div>
            {showFilters ? (
                <div className="empty:hidden">
                    <ActiveFilters groups={filterGroups} />
                </div>
            ) : null}
        </div>
    )
}

function MediaLibraryViewControls({
    disabled,
    value,
    onChange,
}: {
    readonly disabled: boolean
    readonly value: MediaLibraryViewMode
    readonly onChange: (value: MediaLibraryViewMode) => void
}) {
    useHotkeys(
        [
            {
                hotkey: MEDIA_VIEW_SHORTCUTS.grid,
                callback: () => onChange('grid'),
            },
            {
                hotkey: MEDIA_VIEW_SHORTCUTS.compact,
                callback: () => onChange('compact'),
            },
            {
                hotkey: MEDIA_VIEW_SHORTCUTS.list,
                callback: () => onChange('list'),
            },
        ],
        {
            enabled: !disabled,
            ignoreInputs: true,
            preventDefault: true,
            requireReset: true,
            stopPropagation: true,
        }
    )

    return (
        <TooltipProvider delay={450}>
            <ButtonGroup
                aria-label={m.media_view_modes()}
                data-media-view-controls="true"
                className="shrink-0">
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                className={mediaLibraryViewButtonClass(value === 'grid')}
                                aria-label={m.media_view_grid()}
                                aria-keyshortcuts={MEDIA_VIEW_SHORTCUTS.grid}
                                aria-pressed={value === 'grid'}
                                data-media-view-mode="grid"
                                disabled={disabled}
                                onClick={() => onChange('grid')}>
                                <GalleryIcon aria-hidden="true" />
                            </Button>
                        }
                    />
                    <TooltipContent>
                        <span>{m.media_view_grid()}</span>
                        <Kbd aria-hidden="true">{MEDIA_VIEW_SHORTCUTS.grid}</Kbd>
                    </TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                className={mediaLibraryViewButtonClass(value === 'compact')}
                                aria-label={m.media_view_compact()}
                                aria-keyshortcuts={MEDIA_VIEW_SHORTCUTS.compact}
                                aria-pressed={value === 'compact'}
                                data-media-view-mode="compact"
                                disabled={disabled}
                                onClick={() => onChange('compact')}>
                                <Widget2Icon aria-hidden="true" />
                            </Button>
                        }
                    />
                    <TooltipContent>
                        <span>{m.media_view_compact()}</span>
                        <Kbd aria-hidden="true">{MEDIA_VIEW_SHORTCUTS.compact}</Kbd>
                    </TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                className={mediaLibraryViewButtonClass(value === 'list')}
                                aria-label={m.media_view_list()}
                                aria-keyshortcuts={MEDIA_VIEW_SHORTCUTS.list}
                                aria-pressed={value === 'list'}
                                data-media-view-mode="list"
                                disabled={disabled}
                                onClick={() => onChange('list')}>
                                <ListIcon aria-hidden="true" />
                            </Button>
                        }
                    />
                    <TooltipContent>
                        <span>{m.media_view_list()}</span>
                        <Kbd aria-hidden="true">{MEDIA_VIEW_SHORTCUTS.list}</Kbd>
                    </TooltipContent>
                </Tooltip>
            </ButtonGroup>
        </TooltipProvider>
    )
}

function mediaLibraryViewButtonClass(active: boolean) {
    return active
        ? 'bg-surface-selected text-foreground shadow-none hover:bg-surface-selected'
        : 'text-muted-foreground shadow-none'
}
