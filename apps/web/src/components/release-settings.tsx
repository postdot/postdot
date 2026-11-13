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
    return (
        <section
            className="mt-10 w-full border-t border-border/50 pt-8"
            aria-labelledby="release-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="release-title" className="font-heading text-xl font-semibold">
                    {m.release_title()}
                </h2>
                <Button
                    variant="outline"
                    disabled={release.isFetching}
                    aria-describedby={release.isFetching ? 'release-state' : undefined}
                    onClick={() => void release.refetch()}>
                    {release.isError ? m.common_retry() : m.release_check_api()}
                </Button>
            </div>
            <table className="mt-4 w-full table-fixed text-sm" aria-labelledby="release-title">
                <thead>
                    <tr className="border-b border-border/50">
                        <td className="w-20 sm:w-24" />
                        <th scope="col" className="px-2 pb-2 text-left font-medium">
                            {m.release_studio()}
                        </th>
                        <th scope="col" className="px-2 pb-2 text-left font-medium">
                            {m.release_api()}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <th
                            scope="row"
                            className="py-2 pr-3 text-left align-top font-normal text-muted-foreground">
                            {m.release_version()}
                        </th>
                        <td className="break-words px-2 py-2 align-top">
                            {studioRelease.version ?? m.release_unversioned()}
                        </td>
                        <td className="break-words px-2 py-2 align-top">
                            {apiRelease
                                ? (apiRelease.version ?? m.release_unversioned())
                                : release.isPending
                                  ? m.common_loading()
                                  : '—'}
                        </td>
                    </tr>
                    <tr>
                        <th
                            scope="row"
                            className="py-2 pr-3 text-left align-top font-normal text-muted-foreground">
                            {m.release_revision()}
                        </th>
                        <td className="break-all px-2 py-2 align-top font-mono text-xs leading-5">
                            {studioRelease.revision ?? m.release_unknown_revision()}
                        </td>
                        <td className="break-all px-2 py-2 align-top font-mono text-xs leading-5">
                            {apiRelease
                                ? (apiRelease.revision ?? m.release_unknown_revision())
                                : '—'}
                        </td>
                    </tr>
                </tbody>
            </table>
            {release.isFetching ? (
                <p id="release-state" className="mt-3 text-sm text-muted-foreground" role="status">
                    {m.release_checking()}
                </p>
            ) : release.isError ? (
                <p className="mt-3 text-sm" role="alert">
                    {m.release_load_failed()}
                </p>
            ) : comparison === 'mismatch' ? (
                <Alert className="mt-4">
                    <AlertTitle>{m.release_mismatch_title()}</AlertTitle>
                    <AlertDescription>{m.release_mismatch_help()}</AlertDescription>
                </Alert>
            ) : (
                <p className="mt-3 text-sm text-muted-foreground" role="status">
                    {comparison === 'match' ? m.release_match() : m.release_unknown()}
                </p>
            )}
        </section>
    )
}
