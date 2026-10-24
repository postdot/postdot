import { remarkSteps } from 'fumadocs-core/mdx-plugins/remark-steps'
import { defineConfig } from 'fumadocs-mdx/config'

/**
 * Global options shared by the collections. The collections themselves are
 * declared with the macro API in `src/lib/source.ts`.
 */
export default defineConfig({ mdxOptions: { remarkPlugins: [remarkSteps] } })
