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

test('does not execute HTML, fetch remote images or turn preview links into navigation', () => {
    const html = renderToStaticMarkup(
        <PublicationArticleBody
            body={
                '<script>alert(1)</script>\n\n![Example](https://example.com/image.png)\n\n[Link](javascript:alert(1))'
            }
        />
    )
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('href=')
    expect(html).toContain('Example')
    expect(html).toContain('Link')
})
