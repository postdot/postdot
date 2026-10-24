/**
 * The grain sits on every pigment surface. Pages that draw one fetch it with
 * the document, so it does not appear after the shader.
 */
export const materialLinks = [{ rel: 'preload', href: '/material/grain.png', as: 'image' }]

/** Adds the material preloads to the head of a page built with `seo()`. */
export function withMaterial<Head extends { links: object[] }>(head: Head) {
    return { ...head, links: [...head.links, ...materialLinks] }
}
