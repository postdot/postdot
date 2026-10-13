import { Alert, AlertDescription, AlertTitle } from '@postbot/ui/components/alert'
import { Button } from '@postbot/ui/components/button'
import { Field, FieldLabel } from '@postbot/ui/components/field'
import { Input } from '@postbot/ui/components/input'
import { useState } from 'react'

import { formatApiError, type Publication } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export interface PublicationOutcomeResolutionInput {
    readonly resolution: 'published' | 'failed'
    readonly externalId?: string
    readonly externalUrl?: string
    readonly errorMessage?: string
}

interface PublicationOutcomePanelProps {
    readonly publication: Publication
    readonly onResolve: (input: PublicationOutcomeResolutionInput) => Promise<void>
}

export function PublicationOutcomePanel({ publication, onResolve }: PublicationOutcomePanelProps) {
    useLanguage()
    const [externalId, setExternalId] = useState('')
    const [externalUrl, setExternalUrl] = useState('')
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    if (publication.state !== 'ambiguous') return null

    async function resolve(resolution: PublicationOutcomeResolutionInput['resolution']) {
        setPending(true)
        setError(null)
        try {
            const trimmedExternalId = externalId.trim()
            const trimmedUrl = externalUrl.trim()
            if (resolution === 'published' && trimmedExternalId.length === 0) {
                setError(m.publication_outcome_external_id_required())
                setPending(false)
                return
            }
            await onResolve({
                resolution,
                ...(resolution === 'published'
                    ? {
                          externalId: trimmedExternalId,
                          ...(trimmedUrl.length > 0 ? { externalUrl: trimmedUrl } : {}),
                      }
                    : {}),
                ...(resolution === 'failed'
                    ? { errorMessage: publication.errorMessage ?? m.publication_outcome_failed() }
                    : {}),
            })
        } catch (caughtError) {
            setError(formatApiError(caughtError))
            setPending(false)
        }
    }

    return (
        <Alert className="mt-5 border-state-attention/40 bg-state-attention/10">
            <AlertTitle>{m.publication_outcome_title()}</AlertTitle>
            <AlertDescription>
                <p>{m.publication_outcome_ambiguous_description()}</p>
                {publication.errorMessage ? (
                    <p className="mt-2 text-xs text-muted-foreground">{publication.errorMessage}</p>
                ) : null}
            </AlertDescription>
            <div className="mt-4 space-y-3">
                <Field className="max-w-xl gap-1.5">
                    <FieldLabel htmlFor="publication-outcome-external-id">
                        {m.publication_outcome_external_id_label()}
                    </FieldLabel>
                    <Input
                        id="publication-outcome-external-id"
                        value={externalId}
                        onChange={event => setExternalId(event.target.value)}
                        placeholder={m.publication_outcome_external_id_placeholder()}
                        disabled={pending}
                    />
                </Field>
                <Field className="max-w-xl gap-1.5">
                    <FieldLabel htmlFor="publication-outcome-url">
                        {m.publication_outcome_external_url_label()}
                    </FieldLabel>
                    <Input
                        id="publication-outcome-url"
                        type="url"
                        value={externalUrl}
                        onChange={event => setExternalUrl(event.target.value)}
                        placeholder={m.publication_outcome_external_url_placeholder()}
                        disabled={pending}
                    />
                </Field>
                <div className="flex flex-wrap gap-2">
                    <Button disabled={pending} onClick={() => void resolve('published')}>
                        {pending
                            ? m.publication_outcome_saving()
                            : m.publication_outcome_mark_published()}
                    </Button>
                    <Button
                        variant="destructive"
                        disabled={pending}
                        onClick={() => void resolve('failed')}>
                        {pending
                            ? m.publication_outcome_saving()
                            : m.publication_outcome_mark_failed()}
                    </Button>
                </div>
                {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </div>
        </Alert>
    )
}
