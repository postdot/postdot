import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const target = resolve(root, 'integrations/cli')
const manifest = JSON.parse(readFileSync(resolve(target, 'package.json'), 'utf8'))
const source = resolve(root, 'packages/cli/dist/cli.js')
const version = execFileSync(process.execPath, [source, '--version'], { encoding: 'utf8' }).trim()
if (manifest.name !== '@postdot/cli' || version !== manifest.version)
    throw new Error('Build the CLI again after versioning; bundle and public manifest must match')
mkdirSync(resolve(target, 'dist'), { recursive: true })
copyFileSync(source, resolve(target, 'dist/cli.js'))
chmodSync(resolve(target, 'dist/cli.js'), 0o755)
copyFileSync(resolve(root, 'LICENSE'), resolve(target, 'LICENSE'))
console.log(`Prepared ${manifest.name}@${version}`)
