import { Alert, AlertDescription, AlertTitle } from '@postdot/ui/components/alert'
import { Button } from '@postdot/ui/components/button'
import { useQuery } from '@tanstack/react-query'

import { SettingsCard, SettingsRow, SettingsSection } from '@/components/settings-layout'
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
        <SettingsSection
            action={
                <Button
                    variant="ghost"
                    size="sm"
                    disabled={release.isFetching}
                    aria-describedby={release.isFetching ? 'release-state' : undefined}
                    onClick={() => void release.refetch()}>
                    {release.isError ? m.common_retry() : m.release_check_api()}
                </Button>
            }
            id="release-title"
            title={m.release_title()}>
            <SettingsCard>
                <SettingsRow
                    control={
                        <span className="text-sm" data-release-studio="true">
                            {identity(studioRelease.version, studioRelease.revision)}
                        </span>
                    }
                    title={m.release_studio()}
                />
                <SettingsRow
                    control={
                        <span className="text-sm" data-release-api="true">
                            {apiRelease
                                ? identity(apiRelease.version, apiRelease.revision)
                                : release.isPending
                                  ? m.common_loading()
                                  : '-'}
                        </span>
                    }
                    title={m.release_api()}
                />
            </SettingsCard>
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
        </SettingsSection>
    )
}
