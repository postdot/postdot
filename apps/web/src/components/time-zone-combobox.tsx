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
import { Kbd } from '@postdot/ui/components/kbd'
import { MagnifierIcon } from '@solar-icons/react/linear/magnifier'
import { useMemo, useState } from 'react'

import { listSupportedProjectTimeZones } from '@/lib/date-time'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

interface TimeZoneComboboxProps {
    readonly disabled?: boolean
    readonly id: string
    readonly label: string
    readonly onValueChange: (timeZone: string) => void
    readonly value: string
}

export function TimeZoneCombobox({
    disabled = false,
    id,
    label,
    onValueChange,
    value,
}: TimeZoneComboboxProps) {
    useLanguage()
    const [open, setOpen] = useState(false)
    const timeZones = useMemo(() => listSupportedProjectTimeZones(value), [value])

    return (
        <Combobox
            autoHighlight
            disabled={disabled}
            items={timeZones}
            itemToStringLabel={item => item}
            onOpenChange={setOpen}
            onValueChange={next => {
                if (next !== null) onValueChange(next)
            }}
            open={open}
            value={value}>
            <ComboboxTrigger
                aria-label={label}
                className="bg-surface-control shadow-control hover:bg-surface-control-hover"
                disabled={disabled}
                id={id}>
                <ComboboxValue placeholder="UTC">
                    {(selected: string | null) => (
                        <span className="min-w-0 flex-1 truncate text-left">
                            {selected ?? value}
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
                                aria-label={m.project_timezone_search()}
                                className="pr-12 pl-8"
                                placeholder={m.project_timezone_search()}
                            />
                            <Kbd className="absolute top-1/2 right-4 -translate-y-1/2">Esc</Kbd>
                        </div>
                        <ComboboxList className="pt-0">
                            {(item, index) => {
                                const zone = item as string
                                return (
                                    <ComboboxItem index={index} key={zone} value={zone}>
                                        <span className="min-w-0 flex-1 truncate">{zone}</span>
                                        <ComboboxItemIndicator />
                                    </ComboboxItem>
                                )
                            }}
                        </ComboboxList>
                        <ComboboxEmpty>
                            <div className="px-3 py-6 text-center">
                                {m.project_timezone_empty()}
                            </div>
                        </ComboboxEmpty>
                    </ComboboxPopup>
                </ComboboxPositioner>
            </ComboboxPortal>
        </Combobox>
    )
}
