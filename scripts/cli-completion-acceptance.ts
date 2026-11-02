import assert from 'node:assert/strict'
import { copyFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

type Child = (
    command: string[],
    cwd: string,
    environment: Record<string, string>
) => Promise<string>

export async function qualifyShellCompletion({
    command,
    entry,
    directory,
    child,
}: {
    command: string[]
    entry: string
    directory: string
    child: Child
}) {
    const quotedDirectory = join(directory, "shell's CLI path")
    await mkdir(quotedDirectory, { recursive: true })
    const copied = join(quotedDirectory, 'cli.js')
    await copyFile(entry, copied)
    const invocation = command.map(part => (part === entry ? copied : part))
    const brokenConfiguration = join(directory, 'completion-config')
    await mkdir(brokenConfiguration, { recursive: true })
    await Bun.write(join(brokenConfiguration, 'config.json'), 'not JSON')
    let requests = 0
    const tripwire = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch() {
            requests++
            return new Response('Completion must not contact a server', { status: 503 })
        },
    })
    const environment = {
        POSTDOT_URL: tripwire.url.origin,
        POSTDOT_API_KEY: 'completion-must-not-use-a-key',
        POSTDOT_CONFIG_DIR: brokenConfiguration,
    }
    try {
        for (const shell of ['bash', 'zsh', 'fish']) {
            assert.ok(Bun.which(shell), `${shell} is required for completion acceptance`)
            const script = join(directory, `postdot.${shell}`)
            await Bun.write(
                script,
                await child([...invocation, 'completion', shell], directory, environment)
            )
            await child([shell, '-n', script], directory, environment)
            const output = await child(
                ['python3', resolve(import.meta.dir, 'cli-completion-shell.py'), shell, script],
                directory,
                environment
            )
            assert.ok(output.includes('real Tab-completion cases passed'))
            console.log(output.trim())
        }
        const structured = JSON.parse(
            await child([...invocation, 'completion', 'bash', '--json'], directory, environment)
        )
        assert.equal(structured.shell, 'bash')
        assert.ok(structured.script.includes('COMPREPLY'))
        assert.equal(requests, 0, 'Completion contacted the configured server')
        console.log(
            'Completion ignores malformed configuration and credentials; no server request occurred.'
        )
    } finally {
        await tripwire.stop(true)
    }
}
