import { Button } from '@postdot/ui/components/button'
import { ButtonGroup } from '@postdot/ui/components/button-group'
import { Input } from '@postdot/ui/components/input'
import { Kbd } from '@postdot/ui/components/kbd'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@postdot/ui/components/select'
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
import { type ReactNode, useId, useState } from 'react'

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
    readonly bulkSelectionMode: boolean
    readonly interactionDisabled: boolean
    readonly assetCount: number
    readonly totalAssets: number
    readonly className?: string
    readonly features?: MediaLibraryFeatureOptions
    readonly navigationAction?: ReactNode
    readonly showResultCount?: boolean
    readonly showSelectionMode?: boolean
    readonly showViewControls?: boolean
    readonly onSearchQueryChange: (query: string) => void
    readonly onDateChange: (value: MediaListDateFilter) => void
    readonly onFamilyChange: (value: MediaListFamilyFilter) => void
    readonly onSortChange: (value: MediaListSort) => void
    readonly onViewModeChange: (value: MediaLibraryViewMode) => void
    readonly onToggleSelectionMode?: () => void
}

export function MediaLibraryToolbar({
    projectId,
    searchQuery,
    searchPending,
    mediaDateFilter,
    mediaFamilyFilter,
    mediaSort,
    mediaViewMode,
    bulkSelectionMode,
    interactionDisabled,
    assetCount,
    totalAssets,
    className,
    features,
    navigationAction,
    showResultCount: showResultCountProp = true,
    showSelectionMode = true,
    showViewControls: showViewControlsProp = true,
    onSearchQueryChange,
    onDateChange,
    onFamilyChange,
    onSortChange,
    onViewModeChange,
    onToggleSelectionMode,
}: MediaLibraryToolbarProps) {
    const [filtersExpanded, setFiltersExpanded] = useState(false)
    const filterPanelId = useId()
    const showSearch = features?.search ?? true
    const showFilters = features?.filters ?? true
    const showResultCount = (features?.resultCount ?? true) && showResultCountProp
    const showViewControls = (features?.viewModes ?? true) && showViewControlsProp

    const filterLabels = {
        family: {
            all: m.media_filter_all_types(),
            image: m.media_filter_images(),
            video: m.media_filter_videos(),
            audio: m.media_filter_audio(),
            document: m.media_filter_documents(),
        },
        date: {
            all: m.media_filter_all_dates(),
            last_24_hours: m.media_filter_last_24_hours(),
            last_7_days: m.media_filter_last_7_days(),
            last_30_days: m.media_filter_last_30_days(),
        },
        sort: {
            newest: m.media_sort_newest(),
            oldest: m.media_sort_oldest(),
            name_asc: m.media_sort_name_asc(),
            name_desc: m.media_sort_name_desc(),
            largest: m.media_sort_largest(),
            smallest: m.media_sort_smallest(),
        },
    }
    const activeFilters = [
        mediaFamilyFilter !== 'all' ? filterLabels.family[mediaFamilyFilter] : null,
        mediaDateFilter !== 'all' ? filterLabels.date[mediaDateFilter] : null,
        mediaSort !== 'newest' ? filterLabels.sort[mediaSort] : null,
    ].filter(Boolean)

    return (
        <div
            role="search"
            aria-label={m.media_search_label()}
            data-media-library-toolbar="true"
            className={`flex flex-col gap-3 ${className ?? ''}`}>
            <div className="flex items-center gap-2">
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
                {showFilters ? (
                    <Button
                        type="button"
                        size="sm"
                        variant={
                            filtersExpanded || activeFilters.length > 0 ? 'secondary' : 'ghost'
                        }
                        className="shrink-0 sm:hidden"
                        aria-expanded={filtersExpanded}
                        aria-controls={filterPanelId}
                        onClick={() => setFiltersExpanded(current => !current)}>
                        {m.media_filters_toggle()}
                        {activeFilters.length > 0 ? (
                            <span className="text-xs tabular-nums">{activeFilters.length}</span>
                        ) : null}
                    </Button>
                ) : null}
            </div>
            {showFilters && !filtersExpanded && activeFilters.length > 0 ? (
                <p className="text-xs text-primary sm:hidden">{activeFilters.join(' · ')}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
                {showFilters ? (
                    <div
                        id={filterPanelId}
                        className={`${filtersExpanded ? 'block' : 'hidden'} order-1 w-full rounded-md bg-surface-inset/45 p-3 sm:order-none sm:block sm:w-auto sm:bg-transparent sm:p-0`}>
                        <MediaLibraryFilters
                            labels={filterLabels}
                            date={mediaDateFilter}
                            family={mediaFamilyFilter}
                            sort={mediaSort}
                            onDateChange={onDateChange}
                            onFamilyChange={onFamilyChange}
                            onSortChange={onSortChange}
                        />
                    </div>
                ) : null}
                <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
                    {showResultCount && searchPending ? (
                        <p aria-live="polite" className="text-xs text-muted-foreground">
                            {m.media_searching()}
                        </p>
                    ) : showResultCount && assetCount > 0 && totalAssets > assetCount ? (
                        <p aria-live="polite" className="text-xs text-muted-foreground">
                            {m.media_visible_count({ shown: assetCount, total: totalAssets })}
                        </p>
                    ) : null}
                    {showSelectionMode ? (
                        <Button
                            type="button"
                            variant={bulkSelectionMode ? 'secondary' : 'outline'}
                            size="sm"
                            className="shadow-none"
                            aria-pressed={bulkSelectionMode}
                            data-media-selection-mode-toggle="true"
                            disabled={interactionDisabled}
                            onClick={onToggleSelectionMode}>
                            {bulkSelectionMode
                                ? m.media_bulk_exit_selection_mode()
                                : m.media_bulk_select_mode()}
                        </Button>
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

function MediaLibraryFilters({
    date,
    family,
    sort,
    labels,
    onDateChange,
    onFamilyChange,
    onSortChange,
}: {
    readonly date: MediaListDateFilter
    readonly family: MediaListFamilyFilter
    readonly sort: MediaListSort
    readonly labels: {
        readonly family: Record<MediaListFamilyFilter, string>
        readonly date: Record<MediaListDateFilter, string>
        readonly sort: Record<MediaListSort, string>
    }
    readonly onDateChange: (value: MediaListDateFilter) => void
    readonly onFamilyChange: (value: MediaListFamilyFilter) => void
    readonly onSortChange: (value: MediaListSort) => void
}) {
    return (
        <div className="flex flex-wrap items-center gap-2" data-media-filters="true">
            <Select
                items={labels.family}
                value={family}
                onValueChange={value => onFamilyChange((value ?? 'all') as MediaListFamilyFilter)}>
                <SelectTrigger
                    size="sm"
                    className="w-auto min-w-32"
                    aria-label={m.media_filter_type()}
                    data-media-filter="family">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                    <SelectItem value="all">{m.media_filter_all_types()}</SelectItem>
                    <SelectItem value="image">{m.media_filter_images()}</SelectItem>
                    <SelectItem value="video">{m.media_filter_videos()}</SelectItem>
                    <SelectItem value="audio">{m.media_filter_audio()}</SelectItem>
                    <SelectItem value="document">{m.media_filter_documents()}</SelectItem>
                </SelectContent>
            </Select>
            <Select
                items={labels.date}
                value={date}
                onValueChange={value => onDateChange((value ?? 'all') as MediaListDateFilter)}>
                <SelectTrigger
                    size="sm"
                    className="w-auto min-w-36"
                    aria-label={m.media_filter_date()}
                    data-media-filter="date">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                    <SelectItem value="all">{m.media_filter_all_dates()}</SelectItem>
                    <SelectItem value="last_24_hours">{m.media_filter_last_24_hours()}</SelectItem>
                    <SelectItem value="last_7_days">{m.media_filter_last_7_days()}</SelectItem>
                    <SelectItem value="last_30_days">{m.media_filter_last_30_days()}</SelectItem>
                </SelectContent>
            </Select>
            <Select
                items={labels.sort}
                value={sort}
                onValueChange={value => onSortChange((value ?? 'newest') as MediaListSort)}>
                <SelectTrigger
                    size="sm"
                    className="w-auto min-w-36"
                    aria-label={m.media_sort()}
                    data-media-filter="sort">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                    <SelectItem value="newest">{m.media_sort_newest()}</SelectItem>
                    <SelectItem value="oldest">{m.media_sort_oldest()}</SelectItem>
                    <SelectItem value="name_asc">{m.media_sort_name_asc()}</SelectItem>
                    <SelectItem value="name_desc">{m.media_sort_name_desc()}</SelectItem>
                    <SelectItem value="largest">{m.media_sort_largest()}</SelectItem>
                    <SelectItem value="smallest">{m.media_sort_smallest()}</SelectItem>
                </SelectContent>
            </Select>
        </div>
    )
}
