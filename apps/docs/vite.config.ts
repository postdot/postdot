import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { fumadocsMdx } from 'fumadocs-mdx/vite'
import Icons from 'unplugin-icons/vite'
import { defineConfig } from 'vite'

import { collectDocsSlugs, markdownOutputPath } from './scripts/docs-paths'

const slugs = collectDocsSlugs()

export default defineConfig({
    server: { port: 5174 },
    define: {
        'import.meta.env.VITE_SITE_URL': JSON.stringify(
            process.env.POSTBOT_SITE_URL ?? 'http://127.0.0.1:5174'
        ),
        'import.meta.env.VITE_UMAMI_ID': JSON.stringify(process.env.POSTBOT_UMAMI_ID ?? ''),
        'import.meta.env.VITE_UMAMI_URL': JSON.stringify(process.env.POSTBOT_UMAMI_URL ?? ''),
    },
    resolve: {
        // Two copies of Fumadocs or React mean two router providers, and links
        // would silently fall back to plain anchors.
        dedupe: ['fumadocs-core', 'fumadocs-ui', 'fumadocs-mdx', 'react', 'react-dom'],
        alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    plugins: [
        tailwindcss(),
        // Icons are imported as components (`~icons/<set>/<name>`) and inlined at build
        // time; a missing set is installed on demand during development.
        Icons({ compiler: 'jsx', jsx: 'react', autoInstall: true }),
        fumadocsMdx(),
        tanstackStart({
            prerender: {
                enabled: true,
                crawlLinks: true,
                autoSubfolderIndex: false,
                failOnError: true,
                // Anchors and query strings do not change the static output, and a
                // trailing slash names the same page as the path without it.
                filter: ({ path }) =>
                    !/[#?]|%23|%3F/i.test(path) && (path === '/' || !path.endsWith('/')),
            },
            pages: [
                { path: '/', prerender: { enabled: true } },
                { path: '/legal', prerender: { enabled: true } },
                { path: '/privacy', prerender: { enabled: true } },
                { path: '/404', prerender: { enabled: true, outputPath: '/404.html' } },
                { path: '/llms-txt', prerender: { enabled: true, outputPath: '/llms.txt' } },
                {
                    path: '/llms-full-txt',
                    prerender: { enabled: true, outputPath: '/llms-full.txt' },
                },
                { path: '/sitemap-xml', prerender: { enabled: true, outputPath: '/sitemap.xml' } },
                { path: '/api-search', prerender: { enabled: true, outputPath: '/api/search' } },
                ...slugs.flatMap(slug => [
                    { path: `/docs${slug ? `/${slug}` : ''}`, prerender: { enabled: true } },
                    {
                        path: `/llms-page/docs${slug ? `/${slug}` : ''}`,
                        prerender: { enabled: true, outputPath: markdownOutputPath(slug) },
                    },
                ]),
            ],
        }),
        viteReact(),
    ],
})
