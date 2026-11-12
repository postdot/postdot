import { notFound } from '@tanstack/react-router'

import {
    editorialImage,
    editorialMarkdown,
    getEditorialSection,
    type EditorialSection,
} from './editorial'
import { seo, siteUrl } from './social-metadata'

export async function loadEditorialPage(section: EditorialSection, slug: string) {
    const page = getEditorialSection(section).source.getPage(slug.split('/').filter(Boolean))
    if (!page) throw notFound()
    await page.data.preload()
    const head = seo({
        title: page.data.title,
        description: page.data.description ?? '',
        image: editorialImage(page.url),
        path: page.url,
        type: section === 'blog' ? 'article' : 'website',
    })
    const jsonLd = {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': section === 'blog' ? 'BlogPosting' : 'WebPage',
                '@id': `${siteUrl}${page.url}#page`,
                url: `${siteUrl}${page.url}`,
                headline: page.data.title,
                description: page.data.description,
                ...(section === 'blog' && page.data.date ? { datePublished: page.data.date } : {}),
                ...(page.data.author
                    ? {
                          author: {
                              '@type': 'Person',
                              name: page.data.author,
                              url: 'https://github.com/saoudi-h',
                          },
                      }
                    : {}),
                image: `${siteUrl}${editorialImage(page.url)}`,
                isPartOf: { '@id': `${siteUrl}/#website` },
                ...(section === 'blog' ? { mainEntityOfPage: `${siteUrl}${page.url}` } : {}),
                publisher: { '@type': 'Organization', name: 'Postdot', url: siteUrl },
            },
            {
                '@type': 'BreadcrumbList',
                itemListElement: [
                    { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
                    {
                        '@type': 'ListItem',
                        position: 2,
                        name: getEditorialSection(section).title,
                        item: `${siteUrl}/${section}`,
                    },
                    {
                        '@type': 'ListItem',
                        position: 3,
                        name: page.data.title,
                        item: `${siteUrl}${page.url}`,
                    },
                ],
            },
        ],
    }
    return {
        slug,
        head: {
            ...head,
            links: [
                ...head.links,
                { rel: 'alternate', type: 'text/markdown', href: editorialMarkdown(page.url) },
            ],
            scripts: [
                {
                    type: 'application/ld+json',
                    children: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
                },
            ],
        },
    }
}
