/**
 * Renders the Open Graph images at build time. The site is static, so there
 * is no server to draw them on request: the home page and every documentation
 * page get a PNG in `public/og`, at the address their `og:image` tag uses.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import logos from '@iconify-json/logos/icons.json'
import { getIconData } from '@iconify/utils'
import { PostbotLogo } from '@postdot/ui/components/postbot-logo'
import { Resvg } from '@resvg/resvg-js'
import satori from 'satori'

import { appRoot, collectDocsSlugs } from './docs-paths'

/** Network logos from the same Iconify set the pages use, read from the local package. */
const logo = (name: string) => {
    const data = getIconData(logos, name)
    if (!data) throw new Error(`Missing logo: ${name}`)
    return data
}
const bluesky = logo('bluesky')
const discord = logo('discord-icon')
const linkedin = logo('linkedin-icon')
const mastodon = logo('mastodon-icon')
const x = logo('x')

const outputRoot = join(appRoot, 'public/og')
const fontFile = (name: string) =>
    readFile(join(appRoot, 'node_modules/@fontsource/host-grotesk/files', name))
const dataUri = async (name: string) =>
    `data:image/png;base64,${(await readFile(join(appRoot, '.og', name))).toString('base64')}`

const [regular, semibold, material, homeMaterial] = await Promise.all([
    fontFile('host-grotesk-latin-400-normal.woff'),
    fontFile('host-grotesk-latin-600-normal.woff'),
    dataUri('material.png'),
    dataUri('home-material.png'),
])

interface Card {
    title: string
    description?: string
    section: string
    home?: boolean
}

async function render(card: Card) {
    const { title, description, section, home = false } = card
    const size = home ? 72 : title.length > 65 ? 50 : title.length > 42 ? 58 : 72
    const svg = await satori(
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                width: '100%',
                height: '100%',
                padding: '52px 64px',
                backgroundColor: '#f4f4f4',
                color: '#1c1c1c',
                fontFamily: 'Host Grotesk',
                position: 'relative',
            }}>
            <img
                src={home ? homeMaterial : material}
                alt=""
                width={1200}
                height={630}
                style={{ position: 'absolute', top: 0, left: 0 }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {PostbotLogo({ width: 44, height: 44, style: { color: '#1c1c1c' } })}
                <span style={{ display: 'flex', fontSize: 34, letterSpacing: '-1.5px' }}>
                    <span style={{ fontWeight: 600 }}>post</span>
                    <span style={{ opacity: 0.6 }}>bot</span>
                </span>
            </div>
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    flexGrow: 1,
                    width: 870,
                    paddingBottom: 12,
                }}>
                <div
                    style={{
                        display: 'flex',
                        fontSize: size,
                        fontWeight: 600,
                        lineHeight: 1.05,
                        letterSpacing: '-2.5px',
                        whiteSpace: 'pre-wrap',
                        maxWidth: 870,
                    }}>
                    {title}
                </div>
                {home ? (
                    <div style={{ display: 'flex', gap: 24, alignItems: 'center', marginTop: 34 }}>
                        {[
                            { name: 'X', icon: x },
                            { name: 'LinkedIn', icon: linkedin },
                            { name: 'Discord', icon: discord },
                            { name: 'Bluesky', icon: bluesky },
                            { name: 'Mastodon', icon: mastodon },
                        ].map(({ name, icon }) => (
                            <div
                                key={name}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: 64,
                                    height: 64,
                                }}>
                                <img
                                    alt={name}
                                    width={44}
                                    height={44}
                                    src={`data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${icon.width ?? 256} ${icon.height ?? 256}">${icon.body}</svg>`).toString('base64')}`}
                                />
                            </div>
                        ))}
                        <span style={{ fontSize: 24, color: '#555555', marginLeft: 2 }}>
                            + more
                        </span>
                    </div>
                ) : null}
                {description ? (
                    <div
                        style={{
                            display: 'flex',
                            marginTop: 26,
                            fontSize: 27,
                            lineHeight: 1.35,
                            color: '#555555',
                            maxWidth: 740,
                        }}>
                        {description}
                    </div>
                ) : null}
            </div>
            <div style={{ display: 'flex', fontSize: 21, color: '#555555' }}>{section}</div>
        </div>,
        {
            width: 1200,
            height: 630,
            fonts: [
                { name: 'Host Grotesk', data: regular, weight: 400 },
                { name: 'Host Grotesk', data: semibold, weight: 600 },
            ],
        }
    )
    return new Resvg(svg).render().asPng()
}

async function write(file: string, card: Card) {
    const path = join(outputRoot, file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, await render(card))
}

const contentRoot = join(appRoot, 'content/docs')

/** Locates the MDX file of a slug, wherever its folders are grouped. */
async function frontmatterOf(slug: string) {
    const names = new Bun.Glob('**/*.mdx').scanSync({ cwd: contentRoot })
    for (const name of names) {
        const bare = name.replace(/\([^)/]+\)\//g, '').replace(/\.mdx$/, '')
        const resolved = bare.replace(/(^|\/)index$/, '').replace(/\/$/, '')
        if (resolved !== slug) continue
        const source = await readFile(join(contentRoot, name), 'utf8')
        const block = /^---\n([\s\S]*?)\n---/.exec(source)?.[1] ?? ''
        const data = Bun.YAML.parse(block) as { title?: string; description?: string } | null
        return { path: name, title: data?.title, description: data?.description }
    }
    throw new Error(`No document for ${slug || '/docs'}`)
}

function sectionOf(path: string) {
    if (path.startsWith('(self-hosting)')) return 'Self-hosting'
    if (path.startsWith('(developers)')) return 'Development'
    if (path.startsWith('reference/')) return 'API reference'
    return 'Guides'
}

await write('home.png', {
    title: 'Social publishing.\nFor you and your agents.',
    home: true,
    section: 'Self-hosted. Open source.',
})
const slugs = collectDocsSlugs()
for (const slug of slugs) {
    const { path, title, description } = await frontmatterOf(slug)
    const segments = slug ? slug.split('/').map(encodeURIComponent) : []
    await write(`docs/${[...segments, 'image.png'].join('/')}`, {
        title: title ?? 'Documentation',
        description,
        section: `Documentation / ${sectionOf(path)}`,
    })
}
console.log(`OG images: home and ${slugs.length} documentation pages.`)
