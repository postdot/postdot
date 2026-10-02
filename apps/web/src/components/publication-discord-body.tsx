import { gfmStrikethroughFromMarkdown } from 'mdast-util-gfm-strikethrough'
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough'
import { useState, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import { spoilerPlugin } from 'remark-inline-spoiler'

import * as m from '@/paraglide/messages.js'

interface MessageNode {
    type: string
    value?: string
    children?: MessageNode[]
    position?: { start: { offset?: number }; end: { offset?: number } }
    data?: { hName?: string }
}

/** Adapt parsed emphasis without rewriting escaped text or code. */
function discordMessageFormatting(this: { data(): object }) {
    const data = this.data() as {
        micromarkExtensions?: ReturnType<typeof gfmStrikethrough>[]
        fromMarkdownExtensions?: ReturnType<typeof gfmStrikethroughFromMarkdown>[]
    }
    const syntax = data.micromarkExtensions ?? (data.micromarkExtensions = [])
    const nodes = data.fromMarkdownExtensions ?? (data.fromMarkdownExtensions = [])
    syntax.push(gfmStrikethrough({ singleTilde: false }))
    nodes.push(gfmStrikethroughFromMarkdown())
    return (tree: MessageNode, file: { value: unknown }) => {
        const source = String(file.value)
        function visit(node: MessageNode) {
            if (node.type === 'spoiler') node.data = { ...node.data, hName: 'mark' }
            if (node.type === 'strong' && node.position !== undefined) {
                const start = node.position.start.offset
                const end = node.position.end.offset
                if (start !== undefined && end !== undefined) {
                    const raw = source.slice(start, end)
                    if (raw.startsWith('__') && raw.endsWith('__')) {
                        node.data = { ...node.data, hName: 'u' }
                    }
                }
            }
            for (const child of node.children ?? []) visit(child)
        }
        visit(tree)
    }
}

function DiscordSpoiler({ children }: { readonly children: ReactNode }) {
    const [revealed, setRevealed] = useState(false)
    return (
        <button
            type="button"
            data-discord-spoiler="true"
            aria-label={revealed ? m.publication_spoiler_hide() : m.publication_spoiler_reveal()}
            aria-expanded={revealed}
            onClick={() => setRevealed(value => !value)}
            className={`inline rounded-sm px-1 text-left align-baseline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${revealed ? 'bg-black/10 dark:bg-white/10' : 'bg-zinc-700 dark:bg-zinc-800'}`}>
            <span aria-hidden={!revealed} className={revealed ? undefined : 'invisible'}>
                {children}
            </span>
        </button>
    )
}

export function PublicationDiscordBody({ body }: { readonly body: string }) {
    return (
        <div
            data-publication-preview-content="true"
            className="min-w-0 break-words text-sm leading-6 [&_p]:my-0 [&_p]:whitespace-pre-wrap [&_p+p]:mt-3 [&_h1]:my-2 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:my-2 [&_h2]:text-xl [&_h2]:font-bold [&_h3]:my-2 [&_h3]:text-lg [&_h3]:font-bold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:border-current [&_blockquote]:pl-3 [&_pre]:my-2 [&_pre]:max-w-full [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-black/5 [&_pre]:p-3 dark:[&_pre]:bg-black/20 [&_code]:font-mono [&_code]:text-xs">
            <Markdown
                key={body}
                remarkPlugins={[spoilerPlugin, discordMessageFormatting]}
                components={{
                    mark: ({ children }) => <DiscordSpoiler>{children}</DiscordSpoiler>,
                    a: ({ children }) => <span className="text-primary underline">{children}</span>,
                    img: ({ alt }) => <span>{alt}</span>,
                }}>
                {body}
            </Markdown>
        </div>
    )
}
