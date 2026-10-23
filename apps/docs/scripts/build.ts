/**
 * Builds the static site: generated content, social images, prerender, then
 * the checks on the output. The prerenderer logs a render failure and still
 * exits 0, shipping a page without its server render, so the log is checked.
 */
import { appendFile, rm, writeFile } from 'node:fs/promises'

const log = 'build.log'
await writeFile(log, '')

async function run(command: string[], capture = false) {
    const process = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' })
    const pipe = async (stream: ReadableStream<Uint8Array>, target: typeof Bun.stdout) => {
        for await (const chunk of stream) {
            target.write(chunk)
            if (capture) await appendFile(log, chunk)
        }
    }
    await Promise.all([pipe(process.stdout, Bun.stdout), pipe(process.stderr, Bun.stderr)])
    if ((await process.exited) !== 0) throw new Error(`Failed: ${command.join(' ')}`)
}

await rm('dist', { recursive: true, force: true })
await run(['bun', 'run', 'sync:content'])
await run(['bun', 'run', 'generate:og'])
await run(['bunx', '--bun', 'vite', 'build'], true)
const output = await Bun.file(log).text()
if (/Error in render|\[prerender\][^\n]*\b(error|failed)\b/i.test(output)) {
    throw new Error(`The prerender reported errors; see ${log}.`)
}
await run(['bun', 'run', 'check:links'])
await run(['bun', 'run', 'check:llms'])
await run(['bun', 'run', 'check:og'])
