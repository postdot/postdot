import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import bluesky from '@iconify-icons/logos/bluesky'
import discord from '@iconify-icons/logos/discord-icon'
import linkedin from '@iconify-icons/logos/linkedin-icon'
import mastodon from '@iconify-icons/logos/mastodon-icon'
import x from '@iconify-icons/logos/x'
import { PostbotLogo } from '@postbot/ui/components/postbot-logo'
import { ImageResponse } from 'next/og'

let assets:
    | Promise<{ regular: Buffer; semibold: Buffer; material: string; homeMaterial: string }>
    | undefined
function loadAssets() {
    assets ??= Promise.all([
        readFile(
            resolve(
                'node_modules/@fontsource/host-grotesk/files/host-grotesk-latin-400-normal.woff'
            )
        ),
        readFile(
            resolve(
                'node_modules/@fontsource/host-grotesk/files/host-grotesk-latin-600-normal.woff'
            )
        ),
        readFile(resolve('.og/material.png')),
        readFile(resolve('.og/home-material.png')),
    ]).then(([regular, semibold, material, homeMaterial]) => ({
        regular,
        semibold,
        material: `data:image/png;base64,${material.toString('base64')}`,
        homeMaterial: `data:image/png;base64,${homeMaterial.toString('base64')}`,
    }))
    return assets
}

export async function generateOGImage({
    title,
    description,
    section = 'Postbot',
    home = false,
}: {
    title: string
    description?: string
    section?: string
    home?: boolean
}) {
    const { regular, semibold, material, homeMaterial } = await loadAssets()
    const size = home ? 72 : title.length > 65 ? 50 : title.length > 42 ? 58 : 72
    return new ImageResponse(
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
            {/* oxlint-disable-next-line nextjs/no-img-element -- Local data URI for the static OG renderer. */}
            <img
                src={home ? homeMaterial : material}
                alt=""
                width={1200}
                height={630}
                style={{ position: 'absolute', top: 0, left: 0 }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <PostbotLogo width={44} height={44} style={{ color: '#1c1c1c' }} />
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
                            { name: 'Bluesky', icon: bluesky },
                            { name: 'LinkedIn', icon: linkedin },
                            { name: 'Mastodon', icon: mastodon },
                            { name: 'Discord', icon: discord },
                            { name: 'X', icon: x },
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
                                {/* oxlint-disable-next-line nextjs/no-img-element -- Bundled provider SVG rendered inside the OG image. */}
                                <img
                                    alt={name}
                                    width={44}
                                    height={44}
                                    src={`data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${icon.width ?? 256} ${icon.height ?? 256}">${icon.body}</svg>`).toString('base64')}`}
                                />
                            </div>
                        ))}
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
}
