import { Button } from '@postbot/ui/components/button'
import { InfoCircleIcon } from '@solar-icons/react/linear/info-circle'
import { RefreshIcon } from '@solar-icons/react/linear/refresh'

import * as m from '@/paraglide/messages.js'

interface AppErrorStateProps {
    readonly reset: () => void
}

export function AppErrorState({ reset }: AppErrorStateProps) {
    function retry() {
        reset()
        window.location.reload()
    }

    return (
        <main className="flex min-h-svh items-center justify-center bg-surface-canvas px-6 py-12 text-foreground">
            <div className="w-full max-w-md text-center">
                <div className="mx-auto mb-5 flex size-11 items-center justify-center rounded-full bg-state-failed/10 text-state-failed">
                    <InfoCircleIcon aria-hidden="true" className="size-5" />
                </div>
                <h1 className="font-heading text-2xl font-semibold">{m.common_error_title()}</h1>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {m.common_error_description()}
                </p>
                <Button className="mt-6" onClick={retry}>
                    <RefreshIcon aria-hidden="true" />
                    {m.common_retry()}
                </Button>
            </div>
        </main>
    )
}
