import { notFound } from 'next/navigation'

import { docsLlms } from '@/lib/llms'
import { source } from '@/lib/source'

export const dynamic = 'force-static'

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string[] }> }) {
    const { slug } = await params
    if (slug.at(-1) !== 'content.md') notFound()
    const page = source.getPage(slug.slice(0, -1))
    if (!page) notFound()
    return new Response(await docsLlms.page(page), {
        headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
    })
}

export function generateStaticParams() {
    return source.getPages().map(page => ({ slug: [...page.slugs, 'content.md'] }))
}
