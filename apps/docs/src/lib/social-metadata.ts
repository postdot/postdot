export const siteName = 'Postdot'
export const siteDescription =
    'Prepare, adapt and schedule social posts in your own workspace. Self-hosted publishing for people, agents and scripts.'

/** Absolute URL base for canonical and social links. */
export const siteUrl = (import.meta.env.VITE_SITE_URL ?? 'http://127.0.0.1:5174').replace(
    /\/+$/,
    ''
)

export function getOGImageUrl(slugs: string[]) {
    return `/og/docs/${[...slugs, 'image.png'].map(encodeURIComponent).join('/')}`
}

/** Head tags shared by every page: title, description, canonical and social cards. */
export function seo({
    title,
    description,
    image,
    path,
    type = 'website',
}: {
    title: string
    description: string
    image: string
    path: string
    type?: 'website' | 'article'
}) {
    const imageUrl = `${siteUrl}${image}`
    const alt = path === '/' ? title : `${title} | ${siteName}`
    return {
        links: [{ rel: 'canonical', href: `${siteUrl}${path}` }],
        meta: [
            { title: path === '/' ? title : `${title} | ${siteName}` },
            ...(description ? [{ name: 'description', content: description }] : []),
            { property: 'og:title', content: title },
            ...(description ? [{ property: 'og:description', content: description }] : []),
            { property: 'og:site_name', content: siteName },
            { property: 'og:type', content: type },
            { property: 'og:url', content: `${siteUrl}${path}` },
            { property: 'og:image', content: imageUrl },
            { property: 'og:image:width', content: '1200' },
            { property: 'og:image:height', content: '630' },
            { property: 'og:image:alt', content: alt },
            { name: 'twitter:card', content: 'summary_large_image' },
            { name: 'twitter:title', content: title },
            ...(description ? [{ name: 'twitter:description', content: description }] : []),
            { name: 'twitter:image', content: imageUrl },
        ],
    }
}
