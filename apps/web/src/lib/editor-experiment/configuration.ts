import { Mark, type JSONContent } from '@tiptap/core'
import { MarkdownManager } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { Marked, type marked } from 'marked'

export type EditorProfile = 'plain' | 'discord' | 'article'

function delimitedMark(name: string, delimiter: string, tag: string) {
    return Mark.create({
        name,
        parseHTML: () => [{ tag }],
        renderHTML: () => [tag, 0],
        parseMarkdown(token, helpers) {
            return helpers.applyMark(name, helpers.parseInline(token.tokens ?? []))
        },
        renderMarkdown(node, helpers) {
            return `${delimiter}${helpers.renderChildren(node)}${delimiter}`
        },
        markdownTokenizer: {
            name,
            level: 'inline',
            start: source => source.indexOf(delimiter),
            tokenize(source, _tokens, lexer) {
                if (!source.startsWith(delimiter)) return undefined
                const end = source.indexOf(delimiter, delimiter.length)
                if (end <= delimiter.length) return undefined
                const text = source.slice(delimiter.length, end)
                return {
                    type: name,
                    raw: source.slice(0, end + delimiter.length),
                    text,
                    tokens: lexer.inlineTokens(text),
                }
            },
        },
    })
}

const DiscordUnderline = delimitedMark('discordUnderline', '__', 'u')
const DiscordSpoiler = delimitedMark('discordSpoiler', '||', 'mark')

/** A deliberately bounded proof, not the authoritative provider capability model. */
export function editorExtensions(profile: EditorProfile) {
    const rich = profile !== 'plain'
    const article = profile === 'article'
    return [
        StarterKit.configure({
            bold: rich ? {} : false,
            italic: rich ? {} : false,
            strike: rich ? {} : false,
            code: rich ? {} : false,
            codeBlock: rich ? {} : false,
            blockquote: rich ? {} : false,
            heading: article ? { levels: [2, 3] } : false,
            bulletList: article ? {} : false,
            orderedList: article ? {} : false,
            listItem: article ? {} : false,
            listKeymap: article ? {} : false,
            link: article ? { openOnClick: false } : false,
            underline: false,
            horizontalRule: false,
            trailingNode: false,
        }),
        ...(profile === 'discord' ? [DiscordUnderline, DiscordSpoiler] : []),
    ]
}

export function plainDocument(text: string): JSONContent {
    return {
        type: 'doc',
        content: text.split('\n').map(line => ({
            type: 'paragraph',
            ...(line ? { content: [{ type: 'text', text: line }] } : {}),
        })),
    }
}

export function plainText(document: JSONContent): string {
    function inline(node: JSONContent): string {
        if (node.type === 'hardBreak') return '\n'
        return node.text ?? node.content?.map(inline).join('') ?? ''
    }
    return document.content?.map(inline).join('\n') ?? ''
}

export function markdownCodec(profile: Exclude<EditorProfile, 'plain'>) {
    // The manager uses Marked's instance methods, but its declaration expects the callable singleton.
    // A separate instance prevents Discord tokenizers leaking into the article configuration.
    return new MarkdownManager({
        extensions: editorExtensions(profile),
        marked: new Marked() as unknown as typeof marked,
    })
}

/** Keep unsupported imported syntax in source mode instead of silently dropping it. */
export function requiresSourceMode(
    profile: EditorProfile,
    text: string,
    manager?: MarkdownManager
): boolean {
    if (profile === 'plain') return false
    const codec = manager ?? markdownCodec(profile)
    function unsupported(token: unknown): boolean {
        if (typeof token !== 'object' || token === null) return false
        const item = token as Record<string, unknown>
        if (['html', 'image', 'table', 'hr'].includes(String(item.type))) return true
        if (
            item.type === 'heading' &&
            (profile === 'discord' || ![2, 3].includes(Number(item.depth)))
        )
            return true
        if (
            profile === 'discord' &&
            (item.type === 'list' || (item.type === 'link' && item.text !== item.href))
        )
            return true
        return ['tokens', 'items'].some(
            key => Array.isArray(item[key]) && item[key].some(unsupported)
        )
    }
    return codec.instance.lexer(text).some(unsupported)
}
