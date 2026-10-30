import { chmod, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const directory = import.meta.dir
const standalone = process.argv.includes('--compile')
await mkdir(join(directory, 'dist'), { recursive: true })
if (standalone) {
    const child = Bun.spawn(
        [
            process.execPath,
            'build',
            join(directory, 'src/main.ts'),
            '--compile',
            '--minify',
            '--outfile',
            join(directory, 'dist', process.platform === 'win32' ? 'postdot.exe' : 'postdot'),
        ],
        { stdout: 'inherit', stderr: 'inherit' }
    )
    if ((await child.exited) !== 0) throw new Error('Standalone compilation failed')
} else {
    const build = await Bun.build({
        entrypoints: [join(directory, 'src/main.ts')],
        target: 'node',
        format: 'esm',
        naming: 'cli.js',
        outdir: join(directory, 'dist'),
        minify: true,
        banner: '#!/usr/bin/env node',
    })
    if (!build.success) throw new AggregateError(build.logs, 'CLI bundling failed')
    await chmod(join(directory, 'dist/cli.js'), 0o755)
}
