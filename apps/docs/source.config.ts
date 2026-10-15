import { remarkSteps } from 'fumadocs-core/mdx-plugins/remark-steps'
import { defineConfig, defineDocs, frontmatterSchema } from 'fumadocs-mdx/config'

export const docs = defineDocs({
    dir: 'content/docs',
    docs: {
        schema: frontmatterSchema.passthrough(),
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
export default defineConfig({ mdxOptions: { remarkPlugins: [remarkSteps] } })
