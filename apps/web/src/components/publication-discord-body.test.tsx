import { expect, test } from 'bun:test'

import { renderToStaticMarkup } from 'react-dom/server'

import { PublicationDiscordBody } from './publication-discord-body'

test('distinguishes Discord underline from bold and preserves nested emphasis', () => {
    const html = renderToStaticMarkup(
        <PublicationDiscordBody body={'__underlined__ **bold** __*both*__\nnext line'} />
    )
    expect(html).toContain('<u>underlined</u>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<u><em>both</em></u>')
    expect(html).toContain('\nnext line')
})

test('keeps code and escaped underscores literal and renders message structure', () => {
    const html = renderToStaticMarkup(
        <PublicationDiscordBody
            body={
                '`__literal__` \\_\\_escaped\\_\\_\n\n## Update\n\n- One\n- Two\n\n> Quote\n\n```\n__code__\n```'
            }
        />
    )
    expect(html).toContain('<code>__literal__</code>')
    expect(html).toContain('__escaped__')
    expect(html).toContain('<h2>Update</h2>')
    expect(html).toContain('<li>One</li>')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<pre><code>__code__')
})

test('does not execute HTML, load remote images or navigate from preview links', () => {
    const html = renderToStaticMarkup(
        <PublicationDiscordBody
            body={
                '<script>alert(1)</script>\n\n![Image](https://example.com/a.png) [Link](javascript:alert(1))'
            }
        />
    )
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('href=')
})

test('renders double-tilde strikethrough with nested emphasis and underline', () => {
    const html = renderToStaticMarkup(
        <PublicationDiscordBody body={'~~outdated~~ ~~*emphasis*~~ ~~__underline__~~ ~literal~'} />
    )
    expect(html).toContain('<del>outdated</del>')
    expect(html).toContain('<del><em>emphasis</em></del>')
    expect(html).toContain('<del><u>underline</u></del>')
    expect(html).toContain('~literal~')
})

test('leaves escaped strikethrough markers and code untouched', () => {
    const html = renderToStaticMarkup(
        <PublicationDiscordBody body={'\\~\\~escaped\\~\\~ `~~inline~~`\n\n```\n~~code~~\n```'} />
    )
    expect(html).not.toContain('<del>')
    expect(html).toContain('~~escaped~~')
    expect(html).toContain('<code>~~inline~~</code>')
    expect(html).toContain('<pre><code>~~code~~')
})
