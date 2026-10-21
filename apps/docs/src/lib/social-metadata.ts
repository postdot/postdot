import type { Metadata } from 'next'

export function getSocialMetadata(title: string, description: string, image: string): Metadata {
    const images = [{ url: image, width: 1200, height: 630, alt: `${title} | Postdot` }]
    return {
        openGraph: { title, description, siteName: 'Postdot', type: 'website', images },
        twitter: { card: 'summary_large_image', title, description, images },
    }
}

export function getOGImageUrl(slugs: string[]) {
    return `/og/docs/${[...slugs, 'image.png'].map(encodeURIComponent).join('/')}`
}
