import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { Badge } from '@herald/ui/components/badge'
import { Card, CardContent } from '@herald/ui/components/card'

import { PublicationTargetEditor } from '@/components/publication-target-editor'
import type { PublicationEditorState } from '@/lib/api'

type Profile = PublicationEditorState['profile']['profile']
type ReviewState = PublicationEditorState['draft']['reviewState']

interface PublicationEditorTargetSectionProps {
    readonly profile: Profile
    readonly reviewState: ReviewState
    readonly validationIssues: readonly Record<string, unknown>[]
    readonly target: Record<string, unknown> | null
    readonly targetText: string
    readonly disabled: boolean
    readonly onTargetChange: (target: Record<string, unknown>) => void
    readonly onRawTextChange: (value: string) => void
    readonly targetError: string | null
    readonly issueCode: (issue: Record<string, unknown>) => string
    readonly issueMessage: (issue: Record<string, unknown>) => string
}

export function PublicationEditorTargetSection({
    profile,
    reviewState,
    validationIssues,
    target,
    targetText,
    disabled,
    onTargetChange,
    onRawTextChange,
    targetError,
    issueCode,
    issueMessage,
}: PublicationEditorTargetSectionProps) {
    return (
        <section className="min-w-0">
            <Card>
                <CardContent className="p-6 sm:p-7">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                        <div>
                            <p className="text-xs font-medium text-muted-foreground">
                                Channel target
                            </p>
                            <h2 className="mt-2 font-heading text-2xl font-[580] leading-[1.03] tracking-[-0.05em]">
                                Editable structured payload
                            </h2>
                            <p className="mt-3 text-sm leading-6 text-muted-foreground">
                                The channel profile owns this shape. JSON keeps custom channels
                                expressive without inventing a new table for every destination.
                            </p>
                        </div>
                        <Badge
                            variant="outline"
                            className={
                                reviewState === 'compatible'
                                    ? 'border-0 bg-transparent px-0 text-state-published'
                                    : 'border-0 bg-transparent px-0 text-state-attention'
                            }>
                            <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                            {reviewState === 'compatible' ? 'Compatible' : 'Review required'}
                        </Badge>
                    </div>

                    <PublicationTargetEditor
                        profile={profile}
                        target={target}
                        rawText={targetText}
                        onTargetChange={onTargetChange}
                        onRawTextChange={onRawTextChange}
                        disabled={disabled}
                    />
                    {targetError ? (
                        <Alert variant="destructive" className="mt-4 rounded-md">
                            <AlertTitle>Invalid target JSON</AlertTitle>
                            <AlertDescription>{targetError}</AlertDescription>
                        </Alert>
                    ) : null}
                    {validationIssues.length > 0 ? (
                        <Alert className="mt-4 rounded-md border-state-attention/35 bg-state-attention/10">
                            <AlertTitle>The profile reported validation issues</AlertTitle>
                            <AlertDescription>
                                <ul className="mt-1 space-y-1">
                                    {validationIssues.map((issue, index) => (
                                        <li key={`${issueCode(issue)}-${index}`}>
                                            {issueMessage(issue)}
                                        </li>
                                    ))}
                                </ul>
                            </AlertDescription>
                        </Alert>
                    ) : null}
                </CardContent>
            </Card>
        </section>
    )
}
