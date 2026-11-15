import { Alert, AlertDescription, AlertTitle } from '@postdot/ui/components/alert'
import { Button } from '@postdot/ui/components/button'
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { compareReleaseIdentities } from '@/lib/release-identity'
import { studioRelease } from '@/lib/studio-release'
import * as m from '@/paraglide/messages.js'

export function ReleaseSettings() {
    const release = useQuery({
        queryKey: ['application-release'],
        queryFn: api.getReleaseInfo,
        staleTime: 0,
        refetchOnMount: 'always',
        refetchOnWindowFocus: true,
    })
    const apiRelease = release.isError ? undefined : release.data
    const comparison = apiRelease ? compareReleaseIdentities(studioRelease, apiRelease) : undefined
    const identity = (version: string | null | undefined, revision: string | null | undefined) =>
        version || revision
            ? [version, revision ? revision.slice(0, 7) : null].filter(Boolean).join(' · ')
            : m.release_unversioned()
    return (
        <section
            className="mt-10 w-full border-t border-border pt-8"
            aria-labelledby="release-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="release-title" className="font-heading text-base font-semibold">
                    {m.release_title()}
                </h2>
                <Button
                    variant="ghost"
                    size="sm"
                    disabled={release.isFetching}
                    aria-describedby={release.isFetching ? 'release-state' : undefined}
                    onClick={() => void release.refetch()}>
                    {release.isError ? m.common_retry() : m.release_check_api()}
                </Button>
            </div>
            <dl
                className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface-raised text-sm"
                data-release-identity="true">
                <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
                    <dt className="text-muted-foreground">{m.release_studio()}</dt>
                    <dd className="min-w-0 break-all text-right" data-release-studio="true">
                        {identity(studioRelease.version, studioRelease.revision)}
                    </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
                    <dt className="text-muted-foreground">{m.release_api()}</dt>
                    <dd className="min-w-0 break-all text-right" data-release-api="true">
                        {apiRelease
                            ? identity(apiRelease.version, apiRelease.revision)
                            : release.isPending
                              ? m.common_loading()
                              : '—'}
                    </dd>
                </div>
            </dl>
            {release.isFetching ? (
                <p id="release-state" className="mt-2 text-xs text-muted-foreground" role="status">
                    {m.release_checking()}
                </p>
            ) : release.isError ? (
                <p className="mt-2 text-sm" role="alert">
                    {m.release_load_failed()}
                </p>
            ) : comparison === 'mismatch' ? (
                <Alert className="mt-3">
                    <AlertTitle>{m.release_mismatch_title()}</AlertTitle>
                    <AlertDescription>{m.release_mismatch_help()}</AlertDescription>
                </Alert>
            ) : (
                <p className="mt-2 text-xs text-muted-foreground" role="status">
                    {comparison === 'match' ? m.release_match() : m.release_unknown()}
                </p>
            )}
        </section>
    )
}
