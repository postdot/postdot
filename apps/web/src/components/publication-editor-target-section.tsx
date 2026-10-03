import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { Badge } from '@herald/ui/components/badge'
import { AltArrowDownIcon } from '@solar-icons/react/linear/alt-arrow-down'

import { PublicationTargetEditor } from '@/components/publication-target-editor'
import type { PublicationEditorState } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

type Profile = PublicationEditorState['profile']['profile']
type ReviewState = PublicationEditorState['draft']['reviewState']

interface PublicationEditorTargetSectionProps {
    readonly experimentalEditor?: boolean
    readonly profile: Profile
    readonly reviewState: ReviewState
    readonly validationIssues: readonly Record<string, unknown>[]
    readonly target: Record<string, unknown> | null
    readonly targetText: string
    readonly disabled: boolean
    readonly readOnly?: boolean
    readonly open?: boolean
    readonly onOpenChange?: (open: boolean) => void
    readonly onTargetChange: (target: Record<string, unknown>) => void
    readonly onRawTextChange: (value: string) => void
    readonly targetError: string | null
    readonly issueCode: (issue: Record<string, unknown>) => string
    readonly issueMessage: (issue: Record<string, unknown>) => string
}

export function PublicationEditorTargetSection({
    experimentalEditor = false,
    profile,
    reviewState,
    validationIssues,
    target,
    targetText,
    disabled,
    readOnly = false,
    open,
    onOpenChange,
    onTargetChange,
    onRawTextChange,
    targetError,
    issueCode,
    issueMessage,
}: PublicationEditorTargetSectionProps) {
    useLanguage()
    return (
        <section className="min-w-0">
            <details
                data-publication-customization="true"
                className="group rounded-md bg-surface-inset/35 px-3 shadow-surface"
                open={open}
                onToggle={event => onOpenChange?.(event.currentTarget.open)}>
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0">
                        <span className="block font-medium">{m.editor_channel_details()}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                        {reviewState !== 'compatible' ||
                        validationIssues.length > 0 ||
                        targetError !== null ? (
                            <Badge
                                variant="outline"
                                className="border-0 bg-transparent px-0 text-state-attention">
                                <span
                                    className="size-1.5 rounded-full bg-current"
                                    aria-hidden="true"
                                />
                                {m.editor_target_review_required()}
                            </Badge>
                        ) : null}
                        <AltArrowDownIcon
                            aria-hidden="true"
                            className="size-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
                        />
                    </span>
                </summary>
                <div className="pb-4 pt-1">
                    <PublicationTargetEditor
                        experimentalEditor={experimentalEditor}
                        profile={profile}
                        target={target}
                        rawText={targetText}
                        onTargetChange={onTargetChange}
                        onRawTextChange={onRawTextChange}
                        disabled={disabled}
                        readOnly={readOnly}
                        compact
                    />
                    {targetError ? (
                        <Alert
                            variant="destructive"
                            className="mt-4 rounded-md border-0 bg-state-failed/10 shadow-surface">
                            <AlertTitle>{m.editor_target_invalid_json()}</AlertTitle>
                            <AlertDescription>{targetError}</AlertDescription>
                        </Alert>
                    ) : null}
                    {validationIssues.length > 0 ? (
                        <Alert className="mt-4 rounded-md border-0 bg-state-attention/10">
                            <AlertTitle>{m.editor_target_validation_issues()}</AlertTitle>
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
                </div>
            </details>
        </section>
    )
}
