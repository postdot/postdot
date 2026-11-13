import type { PublicationEditorState } from '@/lib/api'
import * as m from '@/paraglide/messages.js'

export function PublicationThreadProgress({
    messages,
}: {
    readonly messages: PublicationEditorState['threadMessages']
}) {
    if (!messages?.length) return null
    const confirmed = messages.filter(message => message.state === 'confirmed').length
    return (
        <details
            className="mt-3 min-w-0 rounded-md bg-surface-inset/35 px-3 py-2.5"
            data-thread-progress>
            <summary className="cursor-pointer text-sm">
                {m.thread_progress({ count: confirmed })}
            </summary>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {m.thread_progress_help()}
            </p>
            <ol className="mt-3 space-y-2 text-sm">
                {messages.map(message => (
                    <li key={message.position} className="min-w-0 space-y-1">
                        <p className="flex flex-wrap justify-between gap-2">
                            <span>{m.thread_message({ number: message.position + 1 })}</span>
                            <span className="text-muted-foreground">
                                {message.state === 'confirmed'
                                    ? m.publication_state_published()
                                    : message.state === 'failed'
                                      ? m.publication_state_failed()
                                      : message.state === 'ambiguous' || message.state === 'sending'
                                        ? m.thread_uncertain()
                                        : m.thread_pending()}
                            </span>
                        </p>
                        {message.externalId ? (
                            <p className="break-all text-xs text-muted-foreground">
                                {message.externalId}
                            </p>
                        ) : null}
                    </li>
                ))}
            </ol>
        </details>
    )
}
