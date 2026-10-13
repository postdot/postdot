import { Skeleton } from '@postbot/ui/components/skeleton'

import * as m from '@/paraglide/messages.js'

export function EmojiGridSkeleton() {
    return (
        <div aria-hidden="true" className="grid grid-cols-8 gap-1 py-3">
            {Array.from({ length: 40 }, (_, index) => (
                <Skeleton
                    key={index}
                    className="size-7 justify-self-center rounded-md bg-foreground/10 motion-reduce:animate-none"
                />
            ))}
        </div>
    )
}

export function PublicationEmojiPickerSkeleton() {
    return (
        <div role="status" className="h-[312px]">
            <span className="sr-only">{m.common_loading()}</span>
            <div aria-hidden="true" className="p-2">
                <Skeleton className="h-10 bg-foreground/10 motion-reduce:animate-none" />
            </div>
            <div className="h-64 px-2">
                <EmojiGridSkeleton />
            </div>
        </div>
    )
}
