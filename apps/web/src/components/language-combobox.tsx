import { Button } from '@postdot/ui/components/button'
import {
    Combobox,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxItemIndicator,
    ComboboxList,
    ComboboxPopup,
    ComboboxPortal,
    ComboboxPositioner,
    ComboboxTrigger,
    ComboboxValue,
} from '@postdot/ui/components/combobox'
import { CloseCircleIcon } from '@solar-icons/react/linear/close-circle'
import { MagnifierIcon } from '@solar-icons/react/linear/magnifier'
import { useMemo, useState } from 'react'

import { useLanguage } from '@/lib/i18n'
import { languageOptionMatches, listLanguageOptions, type LanguageOption } from '@/lib/languages'
import * as m from '@/paraglide/messages.js'

/**
 * Picks a content language by name. The stored value stays a BCP 47 tag, which is what
 * providers expect; an empty value means "not specified" and is offered as a clear action.
 */
export function LanguageCombobox({
    disabled = false,
    id,
    invalid,
    describedBy,
    onValueChange,
    value,
}: {
    readonly disabled?: boolean
    readonly id: string
    readonly invalid?: boolean
    readonly describedBy?: string
    readonly onValueChange: (tag: string) => void
    readonly value: string
}) {
    const { locale } = useLanguage()
    const [open, setOpen] = useState(false)
    const options = useMemo(() => listLanguageOptions(locale, value), [locale, value])
    const selected = options.find(option => option.tag === value) ?? null

    return (
        <div className="flex min-w-0 items-center gap-1.5">
            <Combobox<LanguageOption>
                autoHighlight
                disabled={disabled}
                filter={(item, query) => languageOptionMatches(item, query)}
                isItemEqualToValue={(item, current) => item.tag === current.tag}
                items={options}
                itemToStringLabel={item => item.label}
                onOpenChange={setOpen}
                onValueChange={next => {
                    if (next !== null) onValueChange(next.tag)
                }}
                open={open}
                value={selected}>
                <ComboboxTrigger
                    aria-describedby={describedBy}
                    aria-invalid={invalid || undefined}
                    className="min-w-0 flex-1 border border-input bg-surface-field hover:bg-surface-hover"
                    disabled={disabled}
                    id={id}>
                    <ComboboxValue placeholder={m.language_picker_placeholder()}>
                        {(current: LanguageOption | null) => (
                            <span
                                className={
                                    current === null
                                        ? 'min-w-0 flex-1 truncate text-left text-muted-foreground'
                                        : 'min-w-0 flex-1 truncate text-left'
                                }>
                                {current?.label ?? m.language_picker_placeholder()}
                            </span>
                        )}
                    </ComboboxValue>
                </ComboboxTrigger>

                <ComboboxPortal>
                    <ComboboxPositioner align="start" sideOffset={4}>
                        <ComboboxPopup>
                            <div className="relative p-2 pb-1">
                                <MagnifierIcon
                                    aria-hidden="true"
                                    className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground"
                                />
                                <ComboboxInput
                                    aria-label={m.language_picker_search()}
                                    className="pl-8"
                                    placeholder={m.language_picker_search()}
                                />
                            </div>
                            <ComboboxList className="pt-0">
                                {(item: LanguageOption, index: number) => (
                                    <ComboboxItem index={index} key={item.tag} value={item}>
                                        <span className="min-w-0 flex-1 truncate">
                                            {item.label}
                                        </span>
                                        {item.nativeLabel !== item.label ? (
                                            <span className="shrink-0 truncate text-xs text-muted-foreground">
                                                {item.nativeLabel}
                                            </span>
                                        ) : null}
                                        <ComboboxItemIndicator />
                                    </ComboboxItem>
                                )}
                            </ComboboxList>
                            <ComboboxEmpty>
                                <div className="px-3 py-6 text-center">
                                    {m.language_picker_empty()}
                                </div>
                            </ComboboxEmpty>
                        </ComboboxPopup>
                    </ComboboxPositioner>
                </ComboboxPortal>
            </Combobox>
            {value !== '' && !disabled ? (
                <Button
                    aria-label={m.language_picker_clear()}
                    onClick={() => onValueChange('')}
                    size="icon-sm"
                    type="button"
                    variant="ghost">
                    <CloseCircleIcon aria-hidden="true" />
                </Button>
            ) : null}
        </div>
    )
}
