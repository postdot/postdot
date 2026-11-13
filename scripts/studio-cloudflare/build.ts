import { cp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { verifyStudioReleaseDirectory } from '../studio-archive'

const root = fileURLToPath(new URL('../..', import.meta.url))
const output = fileURLToPath(new URL('./dist', import.meta.url))
const args = Bun.argv.slice(2)
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--release-dir' || !args[1]))
    throw new Error('Use build.ts [--release-dir <extracted-Studio-release>]')
const release = args.length === 0 ? undefined : await realpath(resolve(args[1]!))
if (
    release &&
    (release === output ||
        release.startsWith(`${output}${sep}`) ||
        output.startsWith(`${release}${sep}`))
)
    throw new Error('Keep release input and Cloudflare output in separate directories')
if (release) await verifyStudioReleaseDirectory(release)
const assets = release ? `${release}/public` : `${root}/apps/web/dist`
const notices = release ?? root
if (!(await Bun.file(`${assets}/index.html`).exists()))
    throw new Error('Build the matching Studio revision before packaging Cloudflare assets')
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await cp(assets, output, { recursive: true })
await cp(`${notices}/licenses`, `${output}/licenses`, { recursive: true })
await cp(`${notices}/LICENSE`, `${output}/LICENSE`)
await cp(`${notices}/THIRD_PARTY_NOTICES.md`, `${output}/THIRD_PARTY_NOTICES.md`)
if (release) await cp(`${release}/studio-release.json`, `${output}/studio-release.json`)
await writeFile(`${output}/robots.txt`, 'User-agent: *\nDisallow: /\n')
await writeFile(
    `${output}/_headers`,
    '/*\n  X-Robots-Tag: noindex, nofollow\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n'
)
console.info(`Packaged the matching Studio and distribution notices at ${output}`)
