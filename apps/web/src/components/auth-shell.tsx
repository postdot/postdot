import { PostdotLogo } from '@postdot/ui/components/postdot-logo'
import type { ReactNode } from 'react'

import { AuthDispatchStage } from '@/components/auth-dispatch-stage'

interface AuthShellProps {
    readonly children: ReactNode
}

export function AuthShell({ children }: AuthShellProps) {
    return (
        <div className="grid min-h-svh bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <main className="flex min-h-svh flex-col px-6 py-8 sm:px-10 lg:min-h-0 lg:px-16 lg:py-12">
                <BrandLockup />
                <div className="flex flex-1 items-center justify-center py-12">
                    <div className="w-full max-w-sm">{children}</div>
                </div>
            </main>

            <AuthDispatchStage />
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
