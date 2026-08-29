import { join } from 'node:path'

import { staticPlugin } from '@elysia/static'

const serverPathPrefixes = ['/api', '/openapi', '/health']

export async function createWebAssets(directory: string) {
    const indexPath = join(directory, 'index.html')

    if (!(await Bun.file(indexPath).exists())) {
        throw new Error(`Web assets are missing an index.html file: ${indexPath}`)
    }

    const assets = await staticPlugin({
        alwaysStatic: true,
        assets: directory,
        indexHTML: true,
        maxAge: 0,
        prefix: '',
    })

    return assets.get('/*', ({ path }) => {
        if (isServerPath(path) || path.includes('.')) {
            return new Response('Not Found', { status: 404 })
        }

        return Bun.file(indexPath)
    })
}

function isServerPath(path: string) {
    return serverPathPrefixes.some(prefix => path === prefix || path.startsWith(`${prefix}/`))
}
