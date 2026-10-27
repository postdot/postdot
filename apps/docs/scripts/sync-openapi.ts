import { mkdir, copyFile, rm, readFile, writeFile, readdir } from 'node:fs/promises'

import { generateFiles, type OpenAPIV3 } from 'fumadocs-openapi'

// Only generated content lives here; authored introductions remain siblings.
const output = './content/docs/reference/(generated)'
const schema = JSON.parse(await readFile('./.openapi/postdot.json', 'utf8')) as OpenAPIV3.Document
if (!schema.paths) throw new Error('OpenAPI document has no paths')
const operationsDirectory = './.openapi/operations'
await rm(operationsDirectory, { recursive: true, force: true })
await mkdir(operationsDirectory, { recursive: true })
// Each rendered page preloads only its operation, not the entire API document.
let operationCount = 0
for (const [path, item] of Object.entries(schema.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const) {
        const operation = item?.[method]
        if (!operation) continue
        operationCount += 1
        const id = operation.operationId
        if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`Invalid operation ID: ${id}`)
        await writeFile(
            `${operationsDirectory}/${id}.json`,
            JSON.stringify({
                ...schema,
                servers: [
                    {
                        url: 'https://postdot.example',
                        description: 'Replace with your Postdot instance origin.',
                    },
                ],
                paths: {
                    [path]: {
                        ...(item.parameters ? { parameters: item.parameters } : {}),
                        [method]: operation,
                    },
                },
            })
        )
    }
}
await rm(output, { recursive: true, force: true })
const { openapi } = await import('../src/lib/openapi')
await generateFiles({
    input: openapi,
    output,
    per: 'operation',
    groupBy: 'tag',
    // Multiple schema inputs otherwise emit the same metadata paths concurrently.
    meta: false,
    beforeWrite(files) {
        if (files.length !== operationCount)
            throw new Error('Generated operation coverage mismatch')
        const paths = new Set<string>()
        for (const file of files) {
            if (paths.has(file.path)) throw new Error(`Duplicate generated path: ${file.path}`)
            paths.add(file.path)
        }
    },
    frontmatter: (title, description) => ({ title, description, full: true }),
})
const tagNames = new Map(
    (schema.tags ?? [])
        .filter(tag => tag.name)
        .map(tag => [tag.name!.toLowerCase().replaceAll(' ', '-'), tag.name!])
)
for (const item of Object.values(schema.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const) {
        for (const tag of item?.[method]?.tags ?? [])
            tagNames.set(tag.toLowerCase().replaceAll(' ', '-'), tag)
    }
}
const folders = (await readdir(output, { withFileTypes: true })).filter(entry =>
    entry.isDirectory()
)
for (const folder of folders) {
    const title = tagNames.get(folder.name) ?? folder.name
    await writeFile(
        `${output}/${folder.name}/meta.json`,
        JSON.stringify(
            {
                title,
                defaultOpen: false,
                pages: (await readdir(`${output}/${folder.name}`))
                    .filter(file => file.endsWith('.mdx'))
                    .map(file => file.slice(0, -4))
                    .sort(),
            },
            null,
            2
        )
    )
}
await writeFile(
    `${output}/meta.json`,
    JSON.stringify({ pages: folders.map(folder => folder.name).sort() }, null, 2)
)
await mkdir('./public/reference', { recursive: true })
await copyFile('./.openapi/postdot.json', './public/reference/postdot-openapi.json')
