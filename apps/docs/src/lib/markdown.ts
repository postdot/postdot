export function getPageMarkdownUrl(page: { slugs: string[] }) {
    return `/llms.mdx/docs/${[...page.slugs, 'content.md'].map(encodeURIComponent).join('/')}`
}
