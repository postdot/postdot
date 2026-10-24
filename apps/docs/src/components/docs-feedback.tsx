import { Button } from '@postdot/ui/components/button'
import { Textarea } from '@postdot/ui/components/textarea'
import { DislikeIcon } from '@solar-icons/react/linear/dislike'
import { LikeIcon } from '@solar-icons/react/linear/like'
import { useRouterState } from '@tanstack/react-router'
import { type FormEvent, useEffect, useState } from 'react'

type Opinion = 'good' | 'bad'
type Sent = { opinion: Opinion; githubUrl: string }

const endpoint = '/api/feedback'

/**
 * Sends the opinion of a reader to the feedback Worker, which adds it to the
 * GitHub discussion of the page. The answer is kept in the browser so a page
 * is not rated twice.
 */
export function DocsFeedback() {
    const path = useRouterState({ select: state => state.location.pathname })
    const storageKey = `docs-feedback-${path}`
    const [opinion, setOpinion] = useState<Opinion | null>(null)
    const [message, setMessage] = useState('')
    const [sent, setSent] = useState<Sent | null>(null)
    const [pending, setPending] = useState(false)
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        setOpinion(null)
        setFailed(false)
        try {
            const stored = localStorage.getItem(storageKey)
            setSent(stored ? (JSON.parse(stored) as Sent) : null)
        } catch {
            setSent(null)
        }
    }, [storageKey])

    async function submit(event: FormEvent) {
        event.preventDefault()
        if (!opinion || !message.trim()) return
        setPending(true)
        setFailed(false)
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ url: path, opinion, message }),
            })
            const result = (await response.json()) as { githubUrl?: string }
            if (!response.ok || !result.githubUrl) throw new Error('Feedback refused')
            const next = { opinion, githubUrl: result.githubUrl }
            localStorage.setItem(storageKey, JSON.stringify(next))
            setSent(next)
            setMessage('')
            setOpinion(null)
        } catch {
            setFailed(true)
        } finally {
            setPending(false)
        }
    }

    return (
        <section aria-labelledby="docs-feedback-title" className="mt-12 border-t py-5">
            <div className="flex flex-wrap items-center gap-3">
                <h2 id="docs-feedback-title" className="text-sm font-medium">
                    Was this page helpful?
                </h2>
                {sent ? null : (
                    <div className="flex gap-2">
                        <Button
                            variant={opinion === 'good' ? 'secondary' : 'outline'}
                            aria-pressed={opinion === 'good'}
                            onClick={() => setOpinion('good')}>
                            <LikeIcon aria-hidden="true" />
                            Yes
                        </Button>
                        <Button
                            variant={opinion === 'bad' ? 'secondary' : 'outline'}
                            aria-pressed={opinion === 'bad'}
                            onClick={() => setOpinion('bad')}>
                            <DislikeIcon aria-hidden="true" />
                            No
                        </Button>
                    </div>
                )}
            </div>
            {sent ? (
                <p className="mt-3 text-sm text-fd-muted-foreground" role="status">
                    Thank you for your feedback.{' '}
                    <a
                        className="underline underline-offset-4"
                        href={sent.githubUrl}
                        target="_blank"
                        rel="noreferrer noopener">
                        Open the discussion on GitHub
                    </a>
                    .
                </p>
            ) : opinion ? (
                <form className="mt-3 flex flex-col items-start gap-3" onSubmit={submit}>
                    <Textarea
                        required
                        maxLength={2000}
                        value={message}
                        onChange={event => setMessage(event.target.value)}
                        aria-label="Your feedback"
                        placeholder={
                            opinion === 'good' ? 'What worked well?' : 'What is missing or unclear?'
                        }
                    />
                    <div className="flex items-center gap-3">
                        <Button type="submit" disabled={pending || !message.trim()}>
                            {pending ? 'Sending' : 'Send feedback'}
                        </Button>
                        <p className="text-xs text-fd-muted-foreground">
                            Your message is posted publicly in the GitHub discussion of this page.
                        </p>
                    </div>
                    {failed ? (
                        <p role="alert" className="text-sm text-destructive">
                            The feedback could not be sent. Try again later.
                        </p>
                    ) : null}
                </form>
            ) : null}
        </section>
    )
}
