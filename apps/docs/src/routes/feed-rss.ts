import { createFileRoute } from '@tanstack/react-router'

import { sortedArticles } from '@/lib/editorial'
import { siteUrl } from '@/lib/social-metadata'

const xml = (value: string) =>
    value.replace(
        /[<>&"']/g,
        char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]!
    )

export const Route = createFileRoute('/feed-rss')({
    server: {
        handlers: {
            GET: () => {
                const items = sortedArticles()
                    .map(page => {
                        const url = xml(`${siteUrl}${page.url}`)
                        return `<item><title>${xml(page.data.title)}</title><link>${url}</link><guid isPermaLink="true">${url}</guid><description>${xml(page.data.description ?? '')}</description>${page.data.date ? `<pubDate>${new Date(`${page.data.date}T00:00:00Z`).toUTCString()}</pubDate>` : ''}</item>`
                    })
                    .join('')
                return new Response(
                    `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Postdot blog</title><link>${xml(siteUrl)}/blog</link><description>Measurements and publishing workflows from Postdot.</description><language>en</language>${items}</channel></rss>`,
                    {
                        headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
                    }
                )
            },
        },
    },
})
