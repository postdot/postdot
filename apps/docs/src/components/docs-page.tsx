import type { OpenAPIPageProps_Preloaded } from 'fumadocs-openapi/ui'
import { Step, Steps } from 'fumadocs-ui/components/steps'
import { DocsPage, MarkdownCopyButton, ViewOptionsPopover } from 'fumadocs-ui/layouts/notebook/page'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import { DocsBody, DocsDescription, DocsTitle } from 'fumadocs-ui/page'
import { type ComponentProps, use, useMemo } from 'react'

import { getPageMarkdownUrl } from '@/lib/markdown'
import type { source } from '@/lib/source'

import { OpenAPIPage } from './api-page'

type Page = NonNullable<ReturnType<typeof source.getPage>>
type Preloaded = OpenAPIPageProps_Preloaded['preloaded']

/** Renders one documentation page; its body chunk is preloaded by the route loader. */
export function DocsPageView({ page, preloaded }: { page: Page; preloaded?: Preloaded }) {
    const { toc } = use(page.data.load())
    const Content = page.data.body
    const markdownUrl = getPageMarkdownUrl(page)
    const components = useMemo(
        () => ({
            ...defaultMdxComponents,
            Step,
            Steps,
            OpenAPIPage: (props: ComponentProps<typeof OpenAPIPage>) => (
                <OpenAPIPage {...(preloaded ? { preloaded } : {})} {...props} />
            ),
        }),
        [preloaded]
    )
    return (
        <DocsPage toc={toc} full={page.data.full === true}>
            <DocsTitle>{page.data.title}</DocsTitle>
            <DocsDescription>{page.data.description}</DocsDescription>
            <div className="mb-6 flex flex-wrap items-center gap-2">
                <MarkdownCopyButton markdownUrl={markdownUrl} />
                <ViewOptionsPopover markdownUrl={markdownUrl} />
            </div>
            <DocsBody>
                <Content components={components} />
            </DocsBody>
        </DocsPage>
    )
}
