import { BookIcon } from '@solar-icons/react/linear/book'
import { CodeIcon } from '@solar-icons/react/linear/code'
import { DocumentIcon } from '@solar-icons/react/linear/document'
import { ServerIcon } from '@solar-icons/react/linear/server'
import { loader } from 'fumadocs-core/source'
import { docs } from 'fumadocs-mdx:collections/server'
import { createElement } from 'react'

import { openapi } from './openapi'

export const source = loader(docs.toFumadocsSource(), {
    icon(name) {
        const icons = { book: BookIcon, code: CodeIcon, document: DocumentIcon, server: ServerIcon }
        const Icon = name ? icons[name as keyof typeof icons] : undefined
        return Icon ? createElement(Icon, { size: 16, 'aria-hidden': true }) : undefined
    },
    baseUrl: '/docs',
    plugins: [openapi.loaderPlugin()],
})
