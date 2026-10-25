import { Button } from '@postdot/ui/components/button'
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import * as m from '@/paraglide/messages.js'

export function ReleaseSettings() {
    const release = useQuery({
        queryKey: ['application-release'],
        queryFn: api.getReleaseInfo,
        staleTime: Infinity,
    })
    return (
        <section
            className="mx-auto mt-10 w-full max-w-3xl border-t border-border/50 pt-8"
            aria-labelledby="release-title">
            <h2 id="release-title" className="font-heading text-xl font-semibold">
                {m.release_title()}
            </h2>
            {release.isPending ? (
                <p className="mt-3 text-sm" role="status">
                    {m.common_loading()}
                </p>
            ) : release.isError ? (
                <div className="mt-3">
                    <p role="alert">{m.release_load_failed()}</p>
                    <Button variant="outline" onClick={() => void release.refetch()}>
                        {m.common_retry()}
                    </Button>
                </div>
            ) : (
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-8">
                    <dt className="text-muted-foreground">{m.release_version()}</dt>
                    <dd>{release.data.version ?? m.release_unversioned()}</dd>
                    <dt className="text-muted-foreground">{m.release_revision()}</dt>
                    <dd className="min-w-0 break-all font-mono text-xs leading-5">
                        {release.data.revision ?? m.release_unknown_revision()}
                    </dd>
                </dl>
            )}
        </section>
    )
}
