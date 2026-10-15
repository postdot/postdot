import { docs } from 'fumadocs-mdx:collections/server'
import { DocsPage } from 'fumadocs-ui/layouts/notebook/page'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import { DocsBody, DocsDescription, DocsTitle } from 'fumadocs-ui/page'
import { notFound } from 'next/navigation'

import { source } from '@/lib/source'

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
    const { slug } = await params
    const page = source.getPage(slug)
    if (!page) notFound()
    const document = docs.docs.find(entry => entry.info.path === page.path)
    if (!document) notFound()
    const Content = document.body
    return (
        <DocsPage toc={document.toc}>
            <DocsTitle>{page.data.title}</DocsTitle>
            <DocsDescription>{page.data.description}</DocsDescription>
            <DocsBody>
                <Content components={defaultMdxComponents} />
            </DocsBody>
        </DocsPage>
    )
}

export function generateStaticParams() {
    return source.generateParams()
}
export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }) {
    const page = source.getPage((await params).slug)
    return { title: page?.data.title, description: page?.data.description }
}
