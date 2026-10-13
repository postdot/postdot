import { PostbotLogo } from '@postbot/ui/components/postbot-logo'
import type { ReactNode } from 'react'

interface AuthShellProps {
    readonly children: ReactNode
}

export function AuthShell({ children }: AuthShellProps) {
    return (
        <div className="relative isolate grid min-h-svh overflow-hidden bg-surface-canvas lg:grid-cols-[1.1fr_0.9fr]">
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 overflow-hidden lg:hidden">
                <div className="absolute -top-40 right-[-8rem] size-[30rem] rounded-full bg-primary/8 blur-3xl dark:bg-primary/10" />
                <div className="absolute bottom-[-12rem] left-[-10rem] size-[32rem] rounded-full bg-state-queued/6 blur-3xl dark:bg-state-queued/8" />
            </div>

            <section className="relative hidden overflow-hidden bg-primary p-8 text-primary-foreground lg:flex lg:flex-col xl:p-12">
                <BrandLockup inverse />
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -right-48 top-1/2 size-[38rem] -translate-y-1/2 rounded-full bg-primary-foreground/6 blur-3xl"
                />
                <div className="relative flex flex-1 items-center justify-center">
                    <BrandArtwork />
                </div>
            </section>

            <main className="relative flex min-h-svh items-center justify-center bg-surface-canvas p-6 sm:p-10 lg:min-h-0 lg:p-16">
                <div className="w-full max-w-sm">
                    <div className="mb-12 lg:hidden">
                        <BrandLockup />
                    </div>
                    {children}
                </div>
            </main>
        </div>
    )
}

function BrandLockup({ inverse = false }: { readonly inverse?: boolean }) {
    return (
        <div className="flex items-center gap-3">
            <span
                className={`flex size-9 items-center justify-center rounded-xl shadow-control ${inverse ? 'bg-primary-foreground text-primary' : 'bg-primary text-primary-foreground'}`}>
                <PostbotLogo className="size-7" />
            </span>
            <span
                className={`font-heading text-lg font-semibold ${inverse ? 'text-primary-foreground' : ''}`}>
                Postbot
            </span>
        </div>
    )
}

function BrandArtwork() {
    return (
        <div aria-hidden="true" className="relative size-72 rotate-[-6deg] sm:size-80">
            <div className="absolute inset-5 rounded-[3rem] bg-primary-foreground/10 shadow-surface" />
            <div className="absolute top-0 right-2 size-32 rounded-[2rem] bg-primary-foreground/12 shadow-surface" />
            <div className="absolute bottom-3 left-1 size-28 rounded-[2rem] bg-state-queued/25 shadow-surface" />
            <div className="absolute inset-16 flex rotate-[6deg] items-center justify-center rounded-[2.5rem] bg-primary-foreground text-primary shadow-overlay">
                <PostbotLogo className="size-36" />
            </div>
        </div>
    )
}
