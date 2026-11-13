import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { paraglideVitePlugin } from '@inlang/paraglide-js'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

import { splitLocales } from '../../scripts/i18n-split-locales'
import { readStudioBuildIdentity, type ReleaseIdentity } from './src/lib/release-identity'

function splitLocalesPlugin(): Plugin {
    return {
        name: 'postdot-i18n-split-locales',
        enforce: 'post',
        async buildStart() {
            await splitLocales()
        },
        async configureServer() {
            await splitLocales()
        },
    }
}

export default defineConfig(({ mode }) => {
    const environment = loadEnv(mode, process.cwd(), '')
    const apiOrigin = parseApiOrigin(environment.POSTDOT_API_ORIGIN)
    const allowedHost = parseAllowedHost(environment.POSTDOT_VITE_ALLOWED_HOST)
    const studioRelease = readStudioBuildIdentity(environment)

    return {
        define: { __POSTDOT_STUDIO_RELEASE__: JSON.stringify(studioRelease) },
        // Browser tests use development routes but repeatedly reload a fixed catalog.
        // Bundle its re-exports once, including shared locale state to avoid duplicates.
        ...(process.env.NODE_ENV === 'test'
            ? {
                  optimizeDeps: {
                      force: true,
                      include: [
                          '@/paraglide/messages.js',
                          '@/paraglide/runtime.js',
                          '@/lib/i18n-store.js',
                      ],
                  },
              }
            : {}),
        build: {
            manifest: true,
        },
        plugins: [
            studioBuildMetadata(studioRelease),
            tanstackRouter({
                target: 'react',
                autoCodeSplitting: true,
            }),
            paraglideVitePlugin({
                project: './project.inlang',
                outdir: './src/paraglide',
                strategy: ['localStorage', 'preferredLanguage', 'baseLocale'],
                outputStructure: 'message-modules',
            }),
            splitLocalesPlugin(),
            emojiDataAssets(),
            react(),
            tailwindcss(),
        ],
        resolve: {
            alias: {
                '@': fileURLToPath(new URL('./src', import.meta.url)),
            },
        },
        server: {
            ...(allowedHost === undefined ? {} : { allowedHosts: [allowedHost] }),
            port: 5173,
            proxy: {
                '/api': apiOrigin,
                '/oauth': apiOrigin,
            },
        },
    }
})

function studioBuildMetadata(identity: ReleaseIdentity): Plugin {
    return {
        name: 'postdot-studio-build-identity',
        generateBundle() {
            this.emitFile({
                type: 'asset',
                fileName: 'studio-build.json',
                source: JSON.stringify(identity),
            })
        },
    }
}

function parseApiOrigin(value: string | undefined): string {
    const rawValue = value ?? 'http://localhost:3000'
    let url: URL

    try {
        url = new URL(rawValue)
    } catch {
        throw new Error('POSTDOT_API_ORIGIN must be an absolute HTTP or HTTPS origin')
    }

    if (
        (url.protocol !== 'http:' && url.protocol !== 'https:') ||
        url.pathname !== '/' ||
        url.search !== '' ||
        url.hash !== ''
    ) {
        throw new Error('POSTDOT_API_ORIGIN must be an absolute HTTP or HTTPS origin')
    }

    return url.origin
}

function parseAllowedHost(value: string | undefined): string | undefined {
    const host = value?.trim()
    if (host === undefined || host === '') return undefined
    if (host.includes('/') || host.includes(':') || host.includes(' ')) {
        throw new Error('POSTDOT_VITE_ALLOWED_HOST must be a hostname without a scheme or port')
    }
    return host
}

/** Serve the picker datasets locally in both development and production. */
function emojiDataAssets(): Plugin {
    const assets = new Map<string, Buffer>()
    for (const locale of ['en', 'fr', 'es', 'de']) {
        for (const name of ['data', 'messages']) {
            assets.set(
                `emoji-data/17.0.0/${locale}/${name}.json`,
                readFileSync(
                    fileURLToPath(import.meta.resolve(`emojibase-data/${locale}/${name}.json`))
                )
            )
        }
    }
    assets.set(
        'emoji-data/17.0.0/LICENSE',
        readFileSync(fileURLToPath(import.meta.resolve('emojibase-data/LICENSE')))
    )
    return {
        name: 'postdot-emoji-data',
        configureServer(server) {
            server.middlewares.use((request, response, next) => {
                const source = assets.get((request.url ?? '').split('?')[0]!.slice(1))
                if (source === undefined) return next()
                response.setHeader('Content-Type', 'application/json; charset=utf-8')
                response.end(request.method === 'HEAD' ? undefined : source)
            })
        },
        generateBundle() {
            for (const [fileName, source] of assets)
                this.emitFile({ type: 'asset', fileName, source })
        },
    }
}
