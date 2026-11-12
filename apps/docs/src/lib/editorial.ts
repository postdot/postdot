import { loader } from 'fumadocs-core/source'
import { pageSchema } from 'fumadocs-core/source/schema'
import { defineCollections } from 'fumadocs-mdx/macro'

const editorialSchema = pageSchema.extend({
    date: pageSchema.shape.title.regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    author: pageSchema.shape.title.optional(),
})

const blog = defineCollections({
    type: 'doc',
    dir: './content/blog',
    schema: editorialSchema,
    async: true,
    postprocess: { includeProcessedMarkdown: true },
})
const comparisons = defineCollections({
    type: 'doc',
    dir: './content/alternatives',
    schema: editorialSchema,
    async: true,
    postprocess: { includeProcessedMarkdown: true },
})
const features = defineCollections({
    type: 'doc',
    dir: './content/features',
    schema: editorialSchema,
    async: true,
    postprocess: { includeProcessedMarkdown: true },
})

export const blogSource = loader({ baseUrl: '/blog', source: blog.toFumadocsSource() })
export const comparisonSource = loader({
    baseUrl: '/alternatives',
    source: comparisons.toFumadocsSource(),
})
export const featureSource = loader({ baseUrl: '/features', source: features.toFumadocsSource() })

export const editorialSections = [
    {
        key: 'blog',
        title: 'Blog',
        description: 'Measurements, publishing workflows and the choices behind Postdot.',
        source: blogSource,
    },
    {
        key: 'alternatives',
        title: 'Alternatives',
        description:
            'Compare social media publishing tools by their workflows, teams, integrations and ownership.',
        source: comparisonSource,
    },
    {
        key: 'features',
        title: 'Publishing with Postdot',
        description: 'One workspace for your publishing, from manual channels to agent workflows.',
        source: featureSource,
    },
] as const

export type EditorialSection = (typeof editorialSections)[number]['key']
export type EditorialPage = (typeof blogSource)['$inferPage']

export function getEditorialSection(section: EditorialSection) {
    return editorialSections.find(item => item.key === section)!
}

export function editorialImage(path: string) {
    return `/og${path}/image.png`
}

export function editorialMarkdown(path: string) {
    return `${path}.md`
}

export function sortedArticles() {
    return blogSource
        .getPages()
        .toSorted((a, b) => (b.data.date ?? '').localeCompare(a.data.date ?? ''))
}
