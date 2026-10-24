import { readdirSync } from 'node:fs'

import { createOpenAPI } from 'fumadocs-openapi/server'

/**
 * Server-only access to the operation fragments written by `sync:openapi`.
 * Import it from a server function or a server route, never from a component.
 */
const directory = './.openapi/operations'
export const openapi = createOpenAPI({
    input: Object.fromEntries(
        readdirSync(directory)
            .filter(file => file.endsWith('.json'))
            .sort()
            .map(file => [file, `${directory}/${file}`])
    ),
})
