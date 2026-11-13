import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ingressPort = Number(Bun.env.POSTDOT_E2E_CLOUDFLARE_INGRESS_PORT)
const apiPort = Number(Bun.env.POSTDOT_E2E_API_PORT)
const webPort = Number(Bun.env.POSTDOT_E2E_WEB_PORT)
const publicPort = Number(Bun.env.POSTDOT_E2E_TLS_PROXY_PORT)
if (
    Bun.env.NODE_ENV !== 'test' ||
    Bun.env.POSTDOT_E2E_CLOUDFLARE_STUDIO !== 'true' ||
    [ingressPort, apiPort, webPort, publicPort].some(
        port => !Number.isInteger(port) || port < 1 || port > 65535
    ) ||
    new Set([ingressPort, apiPort, webPort, publicPort]).size !== 4
)
    throw new Error('Cloudflare acceptance requires isolated loopback test ports')

const directory = await mkdtemp(join(tmpdir(), 'postdot-cloudflare-ingress-'))
const secret = 'e'.repeat(64) // Public isolated fixture only; never an installation secret.
const template = await readFile('scripts/studio-cloudflare/ingress.nginx.conf.template', 'utf8')
const snippet = template
    .replaceAll('${POSTDOT_INGRESS_SECRET}', secret)
    .replaceAll('${POSTDOT_API_UPSTREAM}', `127.0.0.1:${apiPort}`)
    .replaceAll('${POSTDOT_PUBLIC_HOST}', `127.0.0.1:${publicPort}`)
const configPath = join(directory, 'nginx.conf')
await writeFile(
    configPath,
    `events {}\nhttp { access_log off; server { listen 127.0.0.1:${ingressPort}; ${snippet} } }\n`
)
const containerName = `postdot-cloudflare-${process.pid}-${ingressPort}`
const nginx = Bun.spawn(
    [
        'docker',
        'run',
        '--rm',
        '--pull',
        'never',
        '--name',
        containerName,
        '--network',
        'host',
        '--volume',
        `${configPath}:/etc/nginx/nginx.conf:ro`,
        '--entrypoint',
        'nginx',
        'nginx:alpine',
        '-g',
        'daemon off;',
    ],
    { stderr: 'inherit', stdout: 'inherit' }
)
let worker: ReturnType<typeof Bun.spawn> | undefined
let stopped = false
async function cleanup() {
    if (stopped) return
    stopped = true
    worker?.kill('SIGTERM')
    await Bun.spawn(['docker', 'stop', '--time', '2', containerName], {
        stdout: 'ignore',
        stderr: 'ignore',
    }).exited
    nginx.kill('SIGTERM')
    await Promise.all([nginx.exited, worker?.exited])
    await rm(directory, { recursive: true, force: true })
}
for (const signal of ['SIGTERM', 'SIGINT'] as const)
    process.once(signal, () => void cleanup().then(() => process.exit(0)))

try {
    const deadline = Date.now() + 15_000
    while (true) {
        try {
            const response = await fetch(`http://127.0.0.1:${ingressPort}/api/auth/get-session`)
            if (response.status === 403) break
        } catch {
            /* Wait only for this isolated ingress listener. */
        }
        if (nginx.exitCode !== null || Date.now() > deadline)
            throw new Error('Test ingress failed to start')
        await Bun.sleep(100)
    }
    worker = Bun.spawn(
        [
            'bun',
            'x',
            '--no-install',
            'wrangler',
            'dev',
            '--config',
            'scripts/studio-cloudflare/wrangler.jsonc',
            '--ip',
            '127.0.0.1',
            '--port',
            String(webPort),
            '--inspector-port',
            '0',
            '--local-protocol',
            'https',
            '--var',
            `POSTDOT_API_ORIGIN:http://127.0.0.1:${ingressPort}`,
            '--var',
            `POSTDOT_PUBLIC_ORIGIN:https://127.0.0.1:${publicPort}`,
        ],
        {
            env: { ...Bun.env, POSTDOT_INGRESS_SECRET: secret, WRANGLER_SEND_METRICS: 'false' },
            stderr: 'inherit',
            stdout: 'inherit',
        }
    )
    const result = await Promise.race([nginx.exited, worker.exited])
    if (!stopped) throw new Error(`Cloudflare test runtime exited unexpectedly (${result})`)
} finally {
    await cleanup()
}
