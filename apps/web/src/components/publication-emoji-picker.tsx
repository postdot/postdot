import { EmojiPicker } from 'frimousse'

import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

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
            className="flex min-w-0 flex-col">
            <div className="flex items-center gap-2 p-2">
                <EmojiPicker.Search
                    aria-label={m.publication_emoji_search()}
                    placeholder={m.publication_emoji_search()}
                    className="min-w-0 flex-1 rounded-md bg-surface-inset px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
                <EmojiPicker.SkinToneSelector className="size-9 shrink-0 rounded-md text-xl hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary" />
            </div>
            <EmojiPicker.Viewport className="h-64 overflow-auto px-2 pb-2">
                <EmojiPicker.Loading className="p-4 text-sm text-muted-foreground">
                    {m.common_loading()}
                </EmojiPicker.Loading>
                <EmojiPicker.Empty className="p-4 text-sm text-muted-foreground">
                    {m.publication_emoji_empty()}
                </EmojiPicker.Empty>
                <EmojiPicker.List
                    components={{
                        // Frimousse 0.4.0 exposes zero-based grid indices; ARIA requires one-based indices.
                        Row: props => (
                            <div
                                {...props}
                                aria-rowindex={
                                    props['aria-rowindex'] === undefined
                                        ? undefined
                                        : props['aria-rowindex'] + 1
                                }
                            />
                        ),
                        CategoryHeader: ({ category, ...props }) => (
                            <div
                                {...props}
                                className="bg-popover px-1 py-2 text-xs font-medium text-muted-foreground">
                                {category.label}
                            </div>
                        ),
                        Emoji: ({ emoji, ...props }) => (
                            <button
                                {...props}
                                aria-colindex={
                                    props['aria-colindex'] === undefined
                                        ? undefined
                                        : props['aria-colindex'] + 1
                                }
                                type="button"
                                disabled={emoji.emoji.length > remainingCharacters}
                                className="flex size-9 items-center justify-center rounded-md text-2xl disabled:opacity-30 hover:bg-accent focus-visible:bg-accent focus-visible:outline-2 focus-visible:outline-primary">
                                {emoji.emoji}
                            </button>
                        ),
                    }}
                />
            </EmojiPicker.Viewport>
        </EmojiPicker.Root>
    )
}
