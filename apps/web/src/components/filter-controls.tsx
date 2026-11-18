import { Button } from '@postdot/ui/components/button'
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@postdot/ui/components/dropdown-menu'
import { CloseIcon } from '@solar-icons/react/linear/close'
import { FilterIcon } from '@solar-icons/react/linear/filter'
import { SortVerticalIcon } from '@solar-icons/react/linear/sort-vertical'
import { Fragment, type ReactNode } from 'react'

import * as m from '@/paraglide/messages.js'

/**
 * Filters and sorting (owner review, 2026-11-15; DESIGN.md "Filters").
 * A list offers one `Filter` menu and one `Sort` menu, quiet text buttons at
 * the end of its toolbar. What is filtered shows as removable conditions next
 * to them. Rows of outline selects are not used for this.
 */
export interface FilterOption {
    readonly hint?: string
    readonly label: string
    /** An identity (channel avatar) shown before the label. */
    readonly media?: ReactNode
    readonly value: string
}

export interface FilterGroup {
    readonly id: string
    readonly label: string
    /** Several values may be chosen; otherwise one, and the default means "any". */
    readonly multiple?: boolean
    /** For single-choice groups: the value that means no filter. */
    readonly anyValue?: string
    readonly limit?: number
    readonly limitNote?: string
    readonly onChange: (values: string[]) => void
    readonly options: readonly FilterOption[]
    readonly selected: readonly string[]
}

function activeValues(group: FilterGroup) {
    return group.selected.filter(value => value !== group.anyValue)
}

/** Groups with fewer than two choices are not offered; a menu with no group is not shown. */
function usefulGroups(groups: readonly FilterGroup[]) {
    return groups.filter(group => group.options.length > 1 || activeValues(group).length > 0)
}

export function FilterMenu({ groups }: { readonly groups: readonly FilterGroup[] }) {
    const offered = usefulGroups(groups)
    if (offered.length === 0) return null
    const count = offered.reduce((total, group) => total + activeValues(group).length, 0)
    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                data-filter-menu="true"
                render={<Button size="sm" variant="ghost" />}>
                <FilterIcon aria-hidden="true" />
                {m.filter_label()}
                {count > 0 ? (
                    <span className="tabular-nums text-muted-foreground">{count}</span>
                ) : null}
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="end"
                className="max-h-96 w-64 max-w-[calc(100vw-2rem)] overflow-y-auto">
                {offered.map((group, index) => {
                    const limitReached =
                        group.multiple === true &&
                        group.limit !== undefined &&
                        group.selected.length >= group.limit
                    return (
                        <Fragment key={group.id}>
                            {index > 0 ? <DropdownMenuSeparator /> : null}
                            <DropdownMenuGroup>
                                <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
                                {group.multiple ? (
                                    <>
                                        {group.options.map(option => {
                                            const checked = group.selected.includes(option.value)
                                            return (
                                                <DropdownMenuCheckboxItem
                                                    checked={checked}
                                                    closeOnClick={false}
                                                    disabled={!checked && limitReached}
                                                    key={option.value}
                                                    onCheckedChange={nextChecked =>
                                                        group.onChange(
                                                            nextChecked
                                                                ? [...group.selected, option.value]
                                                                : group.selected.filter(
                                                                      value =>
                                                                          value !== option.value
                                                                  )
                                                        )
                                                    }>
                                                    {option.media}
                                                    <span className="truncate">{option.label}</span>
                                                    {option.hint ? (
                                                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                                                            {option.hint}
                                                        </span>
                                                    ) : null}
                                                </DropdownMenuCheckboxItem>
                                            )
                                        })}
                                        {limitReached && group.limitNote ? (
                                            <p className="px-2 py-1.5 text-xs text-muted-foreground">
                                                {group.limitNote}
                                            </p>
                                        ) : null}
                                    </>
                                ) : (
                                    <DropdownMenuRadioGroup
                                        onValueChange={value => group.onChange([String(value)])}
                                        value={group.selected[0] ?? group.anyValue ?? ''}>
                                        {group.options.map(option => (
                                            <DropdownMenuRadioItem
                                                closeOnClick
                                                key={option.value}
                                                value={option.value}>
                                                {option.media}
                                                <span className="truncate">{option.label}</span>
                                                {option.hint ? (
                                                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                                                        {option.hint}
                                                    </span>
                                                ) : null}
                                            </DropdownMenuRadioItem>
                                        ))}
                                    </DropdownMenuRadioGroup>
                                )}
                            </DropdownMenuGroup>
                        </Fragment>
                    )
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

/** The conditions in force, each removable, then one way to clear them all. */
export function ActiveFilters({ groups }: { readonly groups: readonly FilterGroup[] }) {
    const conditions = groups.flatMap(group =>
        activeValues(group).map(value => ({
            group,
            label: group.options.find(option => option.value === value)?.label ?? value,
            value,
        }))
    )
    if (conditions.length === 0) return null
    return (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5" data-active-filters="true">
            {conditions.map(({ group, label, value }) => (
                <span
                    className="inline-flex h-7 max-w-full items-center gap-1 rounded-md border border-border bg-surface-raised pr-0.5 pl-2 text-xs"
                    key={`${group.id}:${value}`}>
                    <span className="shrink-0 text-muted-foreground">{group.label}</span>
                    <span className="truncate font-medium">{label}</span>
                    <button
                        aria-label={m.filter_remove({ name: `${group.label} ${label}` })}
                        className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() =>
                            group.onChange(
                                group.multiple
                                    ? group.selected.filter(item => item !== value)
                                    : group.anyValue === undefined
                                      ? []
                                      : [group.anyValue]
                            )
                        }
                        type="button">
                        <CloseIcon aria-hidden="true" className="size-3.5" />
                    </button>
                </span>
            ))}
            {conditions.length > 1 ? (
                <Button
                    onClick={() => {
                        for (const group of groups) {
                            if (activeValues(group).length === 0) continue
                            group.onChange(
                                group.multiple || group.anyValue === undefined
                                    ? []
                                    : [group.anyValue]
                            )
                        }
                    }}
                    size="sm"
                    variant="ghost">
                    {m.filter_clear_all()}
                </Button>
            ) : null}
        </div>
    )
}

export interface SortOption {
    readonly label: string
    readonly value: string
}

/**
 * One choice that shapes the whole list without filtering it out (an order, a
 * period): a quiet button naming the choice in force, and a menu of the others.
 */
export function ChoiceMenu({
    ariaLabel,
    detail,
    heading,
    icon,
    onChange,
    options,
    value,
    ...rest
}: {
    readonly ariaLabel: string
    /** A short qualifier after the label, such as a time zone. */
    readonly detail?: ReactNode
    readonly heading: string
    readonly icon: ReactNode
    readonly onChange: (value: string) => void
    readonly options: readonly SortOption[]
    readonly value: string
    readonly [data: `data-${string}`]: string
}) {
    if (options.length < 2) return null
    const current = options.find(option => option.value === value) ?? options[0]
    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                aria-label={ariaLabel}
                render={<Button size="sm" variant="ghost" />}
                {...rest}>
                {icon}
                {current?.label}
                {detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuGroup>
                    <DropdownMenuLabel>{heading}</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                        onValueChange={next => onChange(String(next))}
                        value={value}>
                        {options.map(option => (
                            <DropdownMenuRadioItem
                                closeOnClick
                                key={option.value}
                                value={option.value}>
                                {option.label}
                            </DropdownMenuRadioItem>
                        ))}
                    </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

/** One sort menu; its button names the order in force. */
export function SortMenu({
    onChange,
    options,
    value,
}: {
    readonly onChange: (value: string) => void
    readonly options: readonly SortOption[]
    readonly value: string
}) {
    const current = options.find(option => option.value === value) ?? options[0]
    return (
        <ChoiceMenu
            ariaLabel={m.sort_menu_label({ order: current?.label ?? '' })}
            data-sort-menu="true"
            heading={m.sort_label()}
            icon={<SortVerticalIcon aria-hidden="true" />}
            onChange={onChange}
            options={options}
            value={value}
        />
    )
}
