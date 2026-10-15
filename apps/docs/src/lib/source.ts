import { loader } from 'fumadocs-core/source'
import { docs } from 'fumadocs-mdx:collections/server'

import { openapi } from './openapi'

export const source = loader(docs.toFumadocsSource(), {
    baseUrl: '/docs',
    plugins: [openapi.loaderPlugin()],
})
