import { docs } from 'fumadocs-mdx:collections/server'
import { Step, Steps } from 'fumadocs-ui/components/steps'
import { DocsPage, MarkdownCopyButton, ViewOptionsPopover } from 'fumadocs-ui/layouts/notebook/page'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import { DocsBody, DocsDescription, DocsTitle } from 'fumadocs-ui/page'
import { notFound } from 'next/navigation'

import { OpenAPIPage } from '@/components/api-page'
import { getPageMarkdownUrl } from '@/lib/markdown'
import { openapi } from '@/lib/openapi'
import { getOGImageUrl, getSocialMetadata } from '@/lib/social-metadata'
import { source } from '@/lib/source'

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
    const { slug } = await params
    const page = source.getPage(slug)
    if (!page) notFound()
    const document = docs.docs.find(entry => entry.info.path === page.path)
    if (!document) notFound()
    const Content = document.body
    const markdownUrl = getPageMarkdownUrl(page)
    const preloaded = await openapi.preloadOpenAPIPage(page)
    return (
        <DocsPage toc={document.toc} full={document.full === true}>
            <DocsTitle>{page.data.title}</DocsTitle>
            <DocsDescription>{page.data.description}</DocsDescription>
            <div className="mb-6 flex flex-wrap items-center gap-2">
                <MarkdownCopyButton markdownUrl={markdownUrl} />
                <ViewOptionsPopover markdownUrl={markdownUrl} />
            </div>
            <DocsBody>
                <Content
                    components={{
                        ...defaultMdxComponents,
                        Step,
                        Steps,
                        OpenAPIPage: props => <OpenAPIPage {...preloaded} {...props} />,
                    }}
                />
            </DocsBody>
        </DocsPage>
    )
}

export function generateStaticParams() {
    return source.generateParams()
}
export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }) {
    const page = source.getPage((await params).slug)
    return {
        ...getSocialMetadata(
            page?.data.title ?? 'Documentation',
            page?.data.description ?? '',
            getOGImageUrl(page?.slugs ?? [])
        ),
        title: page?.data.title,
        description: page?.data.description,
        alternates: page ? { types: { 'text/markdown': getPageMarkdownUrl(page) } } : undefined,
    }
}
