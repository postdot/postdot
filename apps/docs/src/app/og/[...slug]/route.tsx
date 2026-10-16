import { notFound } from 'next/navigation'

import { generateOGImage } from '@/lib/og-image'
import { source } from '@/lib/source'

export const dynamic = 'force-static'

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string[] }> }) {
    const { slug } = await params
    if (slug.length === 1 && slug[0] === 'home.png') {
        return generateOGImage({
            title: 'Social publishing.\nFor you and your agents.',
            home: true,
            section: 'Self-hosted. Open source.',
        })
    }
    if (slug[0] !== 'docs' || slug.at(-1) !== 'image.png') notFound()
    const slugs = slug.slice(1, -1)
    const page = source.getPage(slugs)
    if (!page) notFound()
    const section = page.path.startsWith('(self-hosting)')
        ? 'Self-hosting'
        : page.path.startsWith('(developers)')
          ? 'Development'
          : page.path.startsWith('reference/')
            ? 'API reference'
            : 'Guides'
    return generateOGImage({
        title: page.data.title ?? 'Documentation',
        description: page.data.description,
        section: `Documentation / ${section}`,
    })
}

export function generateStaticParams() {
    return [
        { slug: ['home.png'] },
        ...source.getPages().map(page => ({ slug: ['docs', ...page.slugs, 'image.png'] })),
    ]
}
