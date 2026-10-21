import { Button } from '@postdot/ui/components/button'
import { InfoCircleIcon } from '@solar-icons/react/linear/info-circle'
import { RefreshIcon } from '@solar-icons/react/linear/refresh'

import { EmptyState } from '@/components/empty-state'
import * as m from '@/paraglide/messages.js'

export function QueryErrorState({
    className,
    onRetry,
}: {
    readonly className?: string
    readonly onRetry: () => void
}) {
    return (
        <EmptyState
            action={
                <Button onClick={onRetry} size="sm" variant="ghost">
                    <RefreshIcon aria-hidden="true" />
                    {m.common_retry()}
                </Button>
            }
            className={className}
            description={m.common_error_description()}
            icon={<InfoCircleIcon aria-hidden="true" className="size-5 text-state-failed" />}
            layout="compact"
            title={m.common_error_title()}
        />
    )
}
