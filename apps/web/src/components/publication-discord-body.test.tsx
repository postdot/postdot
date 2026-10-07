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

test('hides spoilers while preserving nested formatting and literal code', () => {
    const html = renderToStaticMarkup(
        <PublicationDiscordBody
            body={
                '||**secret** __detail__|| \\|\\|escaped\\|\\| `||inline||`\n\n```\n||code||\n```'
            }
        />
    )
    expect(html).toContain('data-discord-spoiler="true"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-hidden="true" class="invisible"')
    expect(html).toContain('<strong>secret</strong> <u>detail</u>')
    expect(html).toContain('||escaped||')
    expect(html).toContain('<code>||inline||</code>')
    expect(html).toContain('<pre><code>||code||')
    expect(html.match(/data-discord-spoiler/g)).toHaveLength(1)
})

test('renders multiline Discord quotes as one quote through the end of the message', () => {
    const html = renderToStaticMarkup(
        <PublicationDiscordBody body={'Before\n\n>>> __Quote__\nnext\n\n**Last paragraph**'} />
    )
    expect(html.match(/<blockquote>/g)).toHaveLength(1)
    expect(html).toContain('<p>Before</p>')
    expect(html).toContain('<u>Quote</u>\nnext')
    expect(html).toContain('<strong>Last paragraph</strong></p>\n</blockquote>')
})

test('renders subtext only on its line with nested formatting intact', () => {
    const html = renderToStaticMarkup(
        <PublicationDiscordBody body={'Normal\n-# **Small** __detail__\nNormal again\n-# Last'} />
    )
    expect(html.match(/<small /g)).toHaveLength(2)
    expect(html).toContain('<strong>Small</strong> <u>detail</u></small>')
    expect(html).not.toContain('-#')
    expect(html).toContain('Normal again')
})

test('leaves escaped, inline-code and fenced-code quote and subtext markers literal', () => {
    const html = renderToStaticMarkup(
        <PublicationDiscordBody
            body={
                '\\>>> Escaped\n\\-# Escaped\n`>>> inline` `-# inline`\n\n```\n>>> fenced\n-# fenced\n```\n\n-#No space\nNormal -# text'
            }
        />
    )
    expect(html).not.toContain('<blockquote>')
    expect(html).not.toContain('<small')
    expect(html).toContain('<code>&gt;&gt;&gt; inline</code>')
    expect(html).toContain('<code>-# inline</code>')
    expect(html).toContain('&gt;&gt;&gt; fenced\n-# fenced')
    expect(html).toContain('-#No space')
})

test('keeps spoilers and unsafe content protections inside subtext and multiline quotes', () => {
    const html = renderToStaticMarkup(
        <PublicationDiscordBody
            body={
                '-# ||**Secret**|| [Link](javascript:alert(1))\n\n>>> Quote\n\n<script>alert(1)</script>\n\n![Image](https://example.com/a.png)'
            }
        />
    )
    expect(html).toContain('<small ')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('<strong>Secret</strong>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('href=')
})
