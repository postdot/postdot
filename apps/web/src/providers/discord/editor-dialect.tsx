import { Mark } from '@tiptap/core'

import * as m from '@/paraglide/messages.js'
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

export const discordEditorDialect = {
    extensions: [DiscordUnderline, DiscordSpoiler],
    marks: [
        { name: 'discordUnderline', label: m.editor_lab_underline, glyph: <u>U</u> },
        { name: 'discordSpoiler', label: m.editor_lab_spoiler, glyph: '||' },
    ],
    unsupported(item: Record<string, unknown>) {
        return (
            (item.type === 'blockquote' && /^ {0,3}>>>/m.test(String(item.raw ?? ''))) ||
            (item.type === 'text' &&
                /<(?:@!?\d+|@&\d+|#\d+|a?:[A-Za-z0-9_]+:\d+)>/.test(String(item.raw ?? ''))) ||
            item.type === 'heading' ||
            item.type === 'list' ||
            (item.type === 'link' && item.text !== item.href)
        )
    },
}
