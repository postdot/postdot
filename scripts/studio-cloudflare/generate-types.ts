const path = 'scripts/studio-cloudflare/worker-configuration.d.ts'
const result = await Bun.spawn(
    [
        'bun',
        'x',
        '--no-install',
        'wrangler',
        'types',
        path,
        '--config',
        'scripts/studio-cloudflare/wrangler.jsonc',
        '--env-interface',
        'StudioCloudflareBindings',
        '--include-runtime',
        'false',
        '--strict-vars',
        'false',
    ],
    { stdout: 'inherit', stderr: 'inherit' }
).exited
if (result !== 0) process.exit(result)
// Keep Worker bindings local to this module; they are not Node process environment requirements.
await Bun.write(
    path,
    `import type { Fetcher } from '@cloudflare/workers-types'\n${await Bun.file(path).text()}\nexport type { StudioCloudflareBindings }\n`
)
const formatted = await Bun.spawn(['bun', 'x', '--no-install', 'oxfmt', '--write', path], {
    stdout: 'inherit',
    stderr: 'inherit',
}).exited
if (formatted !== 0) process.exit(formatted)
