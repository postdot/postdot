import { PostdotLogo } from '@postdot/ui/components/postdot-logo'
import type { ReactNode } from 'react'

import * as m from '@/paraglide/messages.js'

interface AuthShellProps {
    readonly children: ReactNode
}

export function AuthShell({ children }: AuthShellProps) {
    return (
        <div className="grid min-h-svh bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <main className="flex min-h-svh flex-col px-6 py-8 sm:px-10 lg:min-h-0 lg:px-16 lg:py-12">
                <BrandLockup />
                <div className="flex flex-1 items-center py-12">
                    <div className="w-full max-w-sm">{children}</div>
                </div>
            </main>

            <aside
                aria-hidden="true"
                className="hidden items-center justify-center bg-surface-canvas p-12 lg:flex xl:p-20">
                <DispatchBoard />
            </aside>
        </div>
    )
}

function BrandLockup() {
    return (
        <div className="flex items-center gap-2.5">
            <PostdotLogo className="size-7" />
            <span className="font-heading text-lg font-semibold">Postdot</span>
        </div>
    )
}

const destinations = [
    { name: 'Mastodon', state: 'published' },
    { name: 'Bluesky', state: 'queued' },
    { name: 'LinkedIn', state: 'review' },
    { name: 'Newsletter', state: 'draft' },
] as const

const stateLabel = {
    published: () => m.publication_state_published(),
    queued: () => m.publication_state_queued(),
    review: () => m.publication_state_needs_review(),
    draft: () => m.publication_state_draft(),
} as const

const stateColor = {
    published: 'text-state-published',
    queued: 'text-state-queued',
    review: 'text-state-attention',
    draft: 'text-state-draft',
} as const

/** Static picture of the product's core relationship: one source, several accountable destinations. */
function DispatchBoard() {
    return (
        <figure className="w-full max-w-md">
            <div className="bg-surface-raised px-5 py-4 rounded-[3px]">
                <p className="text-xs text-muted-foreground">{m.auth_board_source_label()}</p>
                <p className="mt-1 font-heading text-lg font-semibold">
                    {m.auth_board_source_title()}
                </p>
            </div>
            <ul className="ml-6 border-l border-foreground/20">
                {destinations.map(destination => (
                    <li key={destination.name} className="relative pt-3">
                        <span
                            aria-hidden="true"
                            className="absolute top-[2.15rem] left-0 h-px w-5 bg-foreground/20"
                        />
                        <div className="ml-5 flex items-center justify-between bg-surface-raised px-4 py-3 rounded-[3px]">
                            <span className="text-sm font-medium">{destination.name}</span>
                            <span
                                className={`text-sm font-medium ${stateColor[destination.state]}`}>
                                {stateLabel[destination.state]()}
                            </span>
                        </div>
                    </li>
                ))}
            </ul>
            <figcaption className="mt-8 max-w-sm text-sm leading-6 text-muted-foreground">
                {m.auth_board_caption()}
            </figcaption>
        </figure>
    )
}
