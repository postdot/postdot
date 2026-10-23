import { BookIcon } from '@solar-icons/react/linear/book'
import { CodeIcon } from '@solar-icons/react/linear/code'
import { DocumentIcon } from '@solar-icons/react/linear/document'
import { ServerIcon } from '@solar-icons/react/linear/server'
import { loader } from 'fumadocs-core/source'
import { defineDocs } from 'fumadocs-mdx/macro'
import { openapiPlugin } from 'fumadocs-openapi/server'
import { createElement } from 'react'

/**
 * `async: true` keeps the frontmatter in the client bundle and splits every
 * page body into its own chunk, loaded on demand.
 */
const docs = defineDocs({
    dir: './content/docs',
    docs: {
        async: true,
        postprocess: {
            includeProcessedMarkdown: {
                filterElement(node) {
                    if (
                        node.type === 'mdxJsxFlowElement' &&
                        (node.name === 'Steps' || node.name === 'Step')
                    ) {
                        return 'children-only'
                    }
                    return true
                },
            },
        },
    },
})

export const source = loader({
    baseUrl: '/docs',
    source: docs.toFumadocsSource(),
    icon(name) {
        const icons = { book: BookIcon, code: CodeIcon, document: DocumentIcon, server: ServerIcon }
        const Icon = name ? icons[name as keyof typeof icons] : undefined
        return Icon ? createElement(Icon, { size: 16, 'aria-hidden': true }) : undefined
    },
    plugins: [openapiPlugin()],
})
