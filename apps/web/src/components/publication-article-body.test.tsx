import { expect, test } from 'bun:test'

import { renderToStaticMarkup } from 'react-dom/server'

import { PublicationArticleBody } from './publication-article-body'

test('renders article structure and emphasis without exposing Markdown punctuation', () => {
    const html = renderToStaticMarkup(
        <PublicationArticleBody
            body={
                '## Release\n\n**Ready** and *tested*.\n\n- First\n- Second\n\n> Quote\n\n```js\nconst ready = true\n```'
            }
        />
    )
    expect(html).toContain('<h2>Release</h2>')
    expect(html).toContain('<strong>Ready</strong>')
    expect(html).toContain('<em>tested</em>')
    expect(html).toContain('<li>First</li>')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<pre>')
})

test('does not execute HTML or turn preview links into navigation', () => {
    const html = renderToStaticMarkup(
        <PublicationArticleBody
            body={
                '<script>alert(1)</script>\n\n![Example](https://example.com/image.png)\n\n[Link](javascript:alert(1))'
            }
        />
    )
    expect(html).not.toContain('<script>')
    expect(html).toContain('<img src="https://example.com/image.png"')
    expect(html).toContain('referrerPolicy="no-referrer"')
    expect(html).toContain('max-h-48')
    expect(html).not.toContain('href=')
    expect(html).toContain('Example')
    expect(html).toContain('Link')
})

test('does not load embedded bytes, private addresses or credential-bearing article images', () => {
    for (const src of [
        'data:image/png;base64,AAAA',
        'http://127.0.0.1/image.png',
        'https://user:secret@example.com/image.png',
        'javascript:alert(1)',
    ]) {
        const html = renderToStaticMarkup(
            <PublicationArticleBody body={`![Unavailable](<${src}>)`} />
        )
        expect(html).not.toContain('<img')
        expect(html).toContain('Unavailable')
    }
})
