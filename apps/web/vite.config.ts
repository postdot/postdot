import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
    const environment = loadEnv(mode, process.cwd(), '')
    const apiOrigin = parseApiOrigin(environment.HERALD_API_ORIGIN)

    return {
        build: {
            manifest: true,
        },
        plugins: [
            tanstackRouter({
                target: 'react',
                autoCodeSplitting: true,
            }),
            react(),
            tailwindcss(),
        ],
        resolve: {
            alias: {
                '@': fileURLToPath(new URL('./src', import.meta.url)),
            },
        },
        server: {
            port: 5173,
            proxy: {
                '/api': apiOrigin,
                '/oauth': apiOrigin,
            },
        },
    }
})

function parseApiOrigin(value: string | undefined): string {
    const rawValue = value ?? 'http://localhost:3000'
    let url: URL

    try {
        url = new URL(rawValue)
    } catch {
        throw new Error('HERALD_API_ORIGIN must be an absolute HTTP or HTTPS origin')
    }

    if (
        (url.protocol !== 'http:' && url.protocol !== 'https:') ||
        url.pathname !== '/' ||
        url.search !== '' ||
        url.hash !== ''
    ) {
        throw new Error('HERALD_API_ORIGIN must be an absolute HTTP or HTTPS origin')
    }

    return url.origin
}
