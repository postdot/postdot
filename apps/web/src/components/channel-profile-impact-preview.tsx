import { Button } from '@postdot/ui/components/button'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { api, type ChannelProfileAssessment, type PublicationSummary } from '@/lib/api'
import * as m from '@/paraglide/messages.js'

type Impact = ChannelProfileAssessment['workingDrafts'][number]

function groupProfileImpact(assessment: ChannelProfileAssessment) {
    const publications = new Map<string, { id: string; impacts: Impact[] }>()
    for (const impact of [...assessment.workingDrafts, ...assessment.pendingTargets]) {
        const row = publications.get(impact.id) ?? { id: impact.id, impacts: [] }
        row.impacts.push(impact)
        publications.set(impact.id, row)
    }
    return [...publications.values()].sort((left, right) => {
        const needsReview = (impacts: Impact[]) => impacts.some(i => i.state === 'review_required')
        return Number(needsReview(right.impacts)) - Number(needsReview(left.impacts))
    })
}

export function ChannelProfileImpactPreview({
    assessment,
    activated = false,
    projectId,
    onInspect,
}: {
    assessment: ChannelProfileAssessment
    activated?: boolean
    projectId: string
    onInspect: () => void
}) {
    const rows = groupProfileImpact(assessment)
    const identities = useQuery({
        queryKey: [
            'project',
            projectId,
            'profile-impact-identities',
            rows.map(row => row.id).sort(),
        ],
        queryFn: async () => {
            const missing = new Set(rows.map(row => row.id))
            const found = new Map<string, PublicationSummary>()
            let cursor: string | undefined
            do {
                const page = await api.listPublications(projectId, { limit: 100, cursor })
                for (const publication of page.publications) {
                    if (!missing.delete(publication.id)) continue
                    found.set(publication.id, publication)
                }
                cursor = page.nextCursor ?? undefined
            } while (missing.size > 0 && cursor !== undefined)
            return found
        },
        enabled: rows.length > 0,
        retry: false,
        refetchOnWindowFocus: false,
    })

    return (
        <section aria-label={m.profile_impact_title()} data-profile-impact>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-medium">{m.profile_impact_title()}</h3>
                <p className="text-xs text-muted-foreground">
                    {m.profile_impact_versions({
                        current: assessment.currentProfileVersion,
                        proposed: assessment.proposedProfileVersion,
                    })}
                </p>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
                {activated
                    ? assessment.hasReviewRequired
                        ? m.profile_activation_review_remains()
                        : m.profile_activation_compatible()
                    : assessment.hasReviewRequired
                      ? m.profile_review_required()
                      : m.profile_ready()}
            </p>
            {rows.length === 0 ? (
                <p className="mt-4 text-sm">{m.profile_impact_empty()}</p>
            ) : (
                <>
                    {identities.isPending ? <p role="status">{m.common_loading()}</p> : null}
                    {identities.isError ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            <p role="alert" className="text-sm">
                                {m.profile_impact_names_failed()}
                            </p>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void identities.refetch()}>
                                {m.common_retry()}
                            </Button>
                        </div>
                    ) : null}
                    <ul className="mt-4 divide-y divide-border">
                        {rows.map(row => {
                            const publication = identities.data?.get(row.id)
                            const title =
                                publication?.postTitle?.trim() || publication?.sourceExcerpt?.trim()
                            return (
                                <li
                                    key={row.id}
                                    className="min-w-0 py-3 first:pt-0"
                                    data-profile-impact-publication={row.id}>
                                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                                        <p className="min-w-0 flex-1 break-words font-medium">
                                            {title || m.profile_impact_publication({ id: row.id })}
                                        </p>
                                        <Link
                                            to="/dashboard/projects/$projectId/publications/$publicationId"
                                            params={{ projectId, publicationId: row.id }}
                                            onClick={onInspect}
                                            className="shrink-0 text-sm text-primary underline underline-offset-4">
                                            {m.profile_impact_inspect()}
                                        </Link>
                                    </div>
                                    <div className="mt-2 space-y-2">
                                        {row.impacts.map(impact => (
                                            <div key={impact.kind}>
                                                <p className="text-xs text-muted-foreground">
                                                    {impact.kind === 'working_draft'
                                                        ? m.profile_impact_draft()
                                                        : m.profile_impact_target()}
                                                    {' · '}
                                                    <span
                                                        className={
                                                            impact.state === 'review_required'
                                                                ? 'text-destructive'
                                                                : undefined
                                                        }>
                                                        {impact.state === 'review_required'
                                                            ? m.profile_impact_review()
                                                            : m.editor_target_compatible()}
                                                    </span>
                                                </p>
                                                {impact.issues.length > 0 ? (
                                                    <ul className="mt-1 space-y-1 text-sm">
                                                        {impact.issues.map((issue, index) => (
                                                            <li key={index} className="break-words">
                                                                {issue.path ? (
                                                                    <code className="mr-2 text-xs">
                                                                        {issue.path}
                                                                    </code>
                                                                ) : null}
                                                                {issue.message}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                ) : null}
                                            </div>
                                        ))}
                                    </div>
                                </li>
                            )
                        })}
                    </ul>
                </>
            )}
            {assessment.changes.length > 0 ? (
                <details className="mt-4 text-sm">
                    <summary className="cursor-pointer text-muted-foreground">
                        {m.common_change_count({ count: assessment.changes.length })}
                    </summary>
                    <ul className="mt-2 space-y-1">
                        {assessment.changes.map((change, index) => (
                            <li key={index} className="break-words">
                                <code className="mr-2 text-xs">{change.path}</code>
                                {change.message}
                            </li>
                        ))}
                    </ul>
                </details>
            ) : null}
            {!activated && rows.length > 0 ? (
                <p className="mt-3 text-xs text-muted-foreground">
                    {m.profile_impact_adaptation_note()}
                </p>
            ) : null}
        </section>
    )
}
