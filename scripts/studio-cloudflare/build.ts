import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const output = fileURLToPath(new URL('./dist', import.meta.url))
if (!(await Bun.file(`${root}/apps/web/dist/index.html`).exists()))
    throw new Error('Build the matching Studio revision before packaging Cloudflare assets')
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await cp(`${root}/apps/web/dist`, output, { recursive: true })
await cp(`${root}/licenses`, `${output}/licenses`, { recursive: true })
await cp(`${root}/LICENSE`, `${output}/LICENSE`)
await writeFile(`${output}/robots.txt`, 'User-agent: *\nDisallow: /\n')
await writeFile(
    `${output}/_headers`,
    '/*\n  X-Robots-Tag: noindex, nofollow\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n'
)
console.info(`Packaged the matching Studio and distribution notices at ${output}`)
