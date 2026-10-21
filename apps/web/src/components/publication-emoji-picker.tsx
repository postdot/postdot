import { inputClassName } from '@postdot/ui/components/input'
import { MagnifierIcon } from '@solar-icons/react/linear/magnifier'
import { EmojiPicker } from 'frimousse'
import { createContext, useContext, type ComponentProps } from 'react'

import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

import { ActionTooltip } from './action-tooltip'
import { EmojiGridSkeleton } from './publication-emoji-picker-skeleton'

const RemainingCharactersContext = createContext(Infinity)

// Stable component identities preserve focus across background saves.
const emojiComponents: NonNullable<ComponentProps<typeof EmojiPicker.List>['components']> = {
    // Frimousse 0.4.0 exposes zero-based grid indices; ARIA requires one-based indices.
    Row: props => (
        <div
            {...props}
            aria-rowindex={
                props['aria-rowindex'] === undefined ? undefined : props['aria-rowindex'] + 1
            }
        />
    ),
    CategoryHeader: ({ category, ...props }) => (
        <div {...props} className="bg-popover px-1 py-2 text-xs font-medium text-muted-foreground">
            {category.label}
        </div>
    ),
    Emoji: ({ emoji, ...props }) => {
        const remainingCharacters = useContext(RemainingCharactersContext)
        return (
            <button
                {...props}
                aria-colindex={
                    props['aria-colindex'] === undefined ? undefined : props['aria-colindex'] + 1
                }
                type="button"
                disabled={emoji.emoji.length > remainingCharacters}
                className="flex size-9 items-center justify-center rounded-md text-2xl disabled:opacity-30 hover:bg-accent focus-visible:bg-accent focus-visible:outline-2 focus-visible:outline-primary">
                {emoji.emoji}
            </button>
        )
    },
}

export default function PublicationEmojiPicker({
    onSelect,
    remainingCharacters = Infinity,
}: {
    readonly onSelect: (emoji: string) => void
    readonly remainingCharacters?: number
}) {
    const { locale } = useLanguage()
    return (
        <EmojiPicker.Root
            locale={locale}
            emojibaseUrl="/emoji-data/17.0.0"
            columns={8}
            onEmojiSelect={({ emoji }) => onSelect(emoji)}
            className="flex h-[312px] max-h-(--available-height) min-w-0 flex-col">
            <div className="flex items-center gap-2 p-2">
                <div className="relative min-w-0 flex-1">
                    <MagnifierIcon
                        aria-hidden="true"
                        className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground"
                    />
                    <EmojiPicker.Search
                        data-slot="input"
                        aria-label={m.publication_emoji_search()}
                        placeholder={m.publication_emoji_search()}
                        className={`${inputClassName} pl-9`}
                    />
                </div>
                <ActionTooltip label={m.publication_emoji_skin_tone()}>
                    <EmojiPicker.SkinToneSelector
                        aria-label={m.publication_emoji_skin_tone()}
                        className="size-10 shrink-0 rounded-md text-xl hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                    />
                </ActionTooltip>
            </div>
            <EmojiPicker.Viewport className="min-h-0 flex-1 overflow-auto px-2 pb-2">
                <EmojiPicker.Loading className="block" role="status">
                    <span className="sr-only">{m.common_loading()}</span>
                    <EmojiGridSkeleton />
                </EmojiPicker.Loading>
                <EmojiPicker.Empty className="p-4 text-sm text-muted-foreground">
                    {m.publication_emoji_empty()}
                </EmojiPicker.Empty>
                <RemainingCharactersContext value={remainingCharacters}>
                    <EmojiPicker.List components={emojiComponents} />
                </RemainingCharactersContext>
            </EmojiPicker.Viewport>
        </EmojiPicker.Root>
    )
}
