import { createFileRoute } from '@tanstack/react-router'

import { siteUrl } from '@/lib/social-metadata'
import { source } from '@/lib/source'

/** Prerendered to `/sitemap.xml`. */
export const Route = createFileRoute('/sitemap-xml')({
    server: {
        handlers: {
            GET: () => {
                const paths = ['/', ...source.getPages().map(page => page.url)]
                const urls = paths.map(path => `<url><loc>${siteUrl}${path}</loc></url>`).join('')
                return new Response(
                    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
                    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } }
                )
            },
        },
    },
})
