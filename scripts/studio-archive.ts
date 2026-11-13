import { createHash, randomUUID } from 'node:crypto'
import {
    chmod,
    cp,
    link,
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    stat,
    writeFile,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'

export interface StudioArchiveOptions {
    readonly image: string
    readonly version: string
    readonly revision: string
    readonly outputDirectory: string
}

export function validateStudioArchiveOptions(options: StudioArchiveOptions): void {
    if (!/^(?:sha256:|ghcr\.io\/postdot\/postdot@sha256:)[a-f\d]{64}$/.test(options.image))
        throw new Error(
            'Studio packaging requires an immutable image ID or Postdot registry digest'
        )
    if (
        !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:alpha|beta|rc)\.(0|[1-9]\d*))?$/.test(
            options.version
        )
    )
        throw new Error('Studio packaging requires an explicit release version')
    if (!/^[a-f\d]{40}$/.test(options.revision))
        throw new Error('Studio packaging requires the full source revision')
}

async function command(args: string[]): Promise<string> {
    const child = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ])
    if (code !== 0) throw new Error(`${args[0]} failed: ${stderr.trim()}`)
    return stdout.trim()
}

async function payloadFiles(directory: string, prefix = ''): Promise<string[]> {
    const paths: string[] = []
    const entries = await readdir(join(directory, prefix), { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) paths.push(...(await payloadFiles(directory, relative)))
        else if (entry.isFile()) paths.push(relative)
        else throw new Error(`Studio payload contains a non-regular entry: ${relative}`)
    }
    return paths
}

async function validatePayloadLayout(directory: string): Promise<void> {
    for (const path of ['public/index.html', 'LICENSE', 'THIRD_PARTY_NOTICES.md'])
        if (!(await stat(join(directory, path))).isFile())
            throw new Error(`Studio release requires a regular ${path} file`)
    if (!(await stat(join(directory, 'licenses'))).isDirectory())
        throw new Error('Studio release requires its distribution notices directory')
}

/** Package a stopped image's extracted payload, never a fresh independent web build. */
export async function assembleStudioArchive(source: string, options: StudioArchiveOptions) {
    validateStudioArchiveOptions(options)
    const identity = JSON.parse(await readFile(join(source, 'release.json'), 'utf8'))
    if (identity.version !== options.version || identity.revision !== options.revision)
        throw new Error('The image release identity does not match the requested Studio release')
    await validatePayloadLayout(source)
    // Reject symlinks/special files before copying an image's distributable tree.
    await payloadFiles(source)
    const outputDirectory = resolve(options.outputDirectory)
    await mkdir(outputDirectory, { recursive: true })
    const temporary = await mkdtemp(join(outputDirectory, '.studio-archive-'))
    const name = `postdot-studio-${options.version}`
    const payload = join(temporary, name)
    try {
        await cp(source, payload, { recursive: true })
        const files: Record<string, string> = {}
        for (const path of await payloadFiles(payload)) {
            await chmod(join(payload, path), 0o644)
            files[path] = createHash('sha256')
                .update(await readFile(join(payload, path)))
                .digest('hex')
        }
        await writeFile(
            join(payload, 'studio-release.json'),
            `${JSON.stringify(
                {
                    formatVersion: 1,
                    version: options.version,
                    revision: options.revision,
                    image: options.image,
                    assetDirectory: 'public',
                    files,
                },
                null,
                2
            )}\n`,
            { mode: 0o644 }
        )
        const archiveName = `${name}.tar.gz`
        const temporaryArchive = join(temporary, archiveName)
        await command([
            'tar',
            '--sort=name',
            '--mtime=@0',
            '--owner=0',
            '--group=0',
            '--numeric-owner',
            '--mode=u+rwX,go+rX,go-w',
            '-czf',
            temporaryArchive,
            '-C',
            temporary,
            name,
        ])
        const archive = join(outputDirectory, archiveName)
        // Atomic publication into the local output directory; refuse version replacement.
        await link(temporaryArchive, archive)
        return {
            archive,
            sha256: createHash('sha256')
                .update(await readFile(archive))
                .digest('hex'),
        }
    } finally {
        await rm(temporary, { recursive: true, force: true })
    }
}

/** Verify a downloaded/extracted release before using its files as hosting input. */
export async function verifyStudioReleaseDirectory(directory: string) {
    const paths = (await payloadFiles(directory)).filter(path => path !== 'studio-release.json')
    await validatePayloadLayout(directory)
    const metadata = JSON.parse(await readFile(join(directory, 'studio-release.json'), 'utf8'))
    if (
        metadata.formatVersion !== 1 ||
        metadata.assetDirectory !== 'public' ||
        !metadata.files ||
        typeof metadata.files !== 'object' ||
        Array.isArray(metadata.files)
    )
        throw new Error('Unsupported Studio release manifest')
    validateStudioArchiveOptions({ ...metadata, outputDirectory: '' })
    const identity = JSON.parse(await readFile(join(directory, 'release.json'), 'utf8'))
    if (identity.version !== metadata.version || identity.revision !== metadata.revision)
        throw new Error('Studio and API release identity do not match')
    const declared = Object.keys(metadata.files).sort()
    if (JSON.stringify(paths.sort()) !== JSON.stringify(declared))
        throw new Error('Studio release file inventory does not match its manifest')
    for (const path of declared) {
        const actual = createHash('sha256')
            .update(await readFile(join(directory, path)))
            .digest('hex')
        if (actual !== metadata.files[path])
            throw new Error(`Studio release checksum mismatch: ${path}`)
    }
    return {
        version: metadata.version as string,
        revision: metadata.revision as string,
        image: metadata.image as string,
    }
}

export async function packageStudioImage(options: StudioArchiveOptions) {
    validateStudioArchiveOptions(options)
    const inspected = JSON.parse(
        await command([
            'docker',
            'image',
            'inspect',
            options.image,
            '--format',
            '{"os":{{json .Os}},"arch":{{json .Architecture}},"labels":{{json .Config.Labels}}}',
        ])
    )
    if (
        inspected.os !== 'linux' ||
        inspected.arch !== 'amd64' ||
        inspected.labels?.['org.opencontainers.image.version'] !== options.version ||
        inspected.labels?.['org.opencontainers.image.revision'] !== options.revision ||
        inspected.labels?.['org.opencontainers.image.source'] !==
            'https://github.com/postdot/postdot'
    )
        throw new Error(
            'Image platform or OCI release identity does not match the requested Studio release'
        )
    const output = resolve(options.outputDirectory)
    await mkdir(output, { recursive: true })
    const temporary = await mkdtemp(join(output, '.studio-image-'))
    const container = `postdot-studio-export-${randomUUID()}`
    let created = false
    try {
        await command([
            'docker',
            'create',
            '--pull=never',
            '--platform=linux/amd64',
            '--name',
            container,
            options.image,
        ])
        created = true
        for (const path of [
            'public',
            'licenses',
            'LICENSE',
            'THIRD_PARTY_NOTICES.md',
            'release.json',
        ])
            await command(['docker', 'cp', `${container}:/app/${path}`, join(temporary, path)])
        return await assembleStudioArchive(temporary, options)
    } finally {
        // Creating/exporting never starts the API, its database or its worker.
        await Promise.all([
            created
                ? command(['docker', 'rm', '--force', '--volumes', container])
                : Promise.resolve(),
            rm(temporary, { recursive: true, force: true }),
        ])
    }
}

if (import.meta.main) {
    const args = Bun.argv.slice(2)
    const values = new Map<string, string>()
    const allowed = ['--image', '--version', '--revision', '--output']
    for (let index = 0; index < args.length; index += 2) {
        const key = args[index]!
        const value = args[index + 1]
        if (!allowed.includes(key) || value === undefined || values.has(key))
            throw new Error(
                'Usage: bun run package:studio --image <immutable-image> --version <version> --revision <sha> [--output <directory>]'
            )
        values.set(key, value)
    }
    const result = await packageStudioImage({
        image: values.get('--image') ?? '',
        version: values.get('--version') ?? '',
        revision: values.get('--revision') ?? '',
        outputDirectory: values.get('--output') ?? 'dist/studio-releases',
    })
    console.info(`${result.sha256}  ${result.archive}`)
}
