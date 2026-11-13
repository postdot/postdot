import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
    assembleStudioArchive,
    validateStudioArchiveOptions,
    verifyStudioReleaseDirectory,
} from './studio-archive'

const options = {
    image: `sha256:${'a'.repeat(64)}`,
    version: '0.1.0-alpha.8',
    revision: 'b'.repeat(40),
    outputDirectory: '',
}

async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), 'postdot-studio-archive-test-'))
    const source = join(directory, 'source')
    await mkdir(join(source, 'public/assets'), { recursive: true })
    await mkdir(join(source, 'licenses'))
    await writeFile(join(source, 'public/index.html'), '<script src="/assets/app.js"></script>')
    await writeFile(join(source, 'public/assets/app.js'), 'console.log("exact image bytes")')
    await writeFile(join(source, 'LICENSE'), 'Project license')
    await writeFile(join(source, 'THIRD_PARTY_NOTICES.md'), 'Retained attribution')
    await writeFile(join(source, 'licenses/Dependency.LICENSE'), 'Upstream license')
    await writeFile(
        join(source, 'release.json'),
        JSON.stringify({ version: options.version, revision: options.revision })
    )
    return { directory, source }
}

test('packages byte-identical assets with paired identity, licenses and deterministic hashes despite source timestamps', async () => {
    const { directory, source } = await fixture()
    try {
        const first = await assembleStudioArchive(source, {
            ...options,
            outputDirectory: join(directory, 'one'),
        })
        await utimes(
            join(source, 'public/assets/app.js'),
            new Date('2000-01-01'),
            new Date('2040-01-01')
        )
        const second = await assembleStudioArchive(source, {
            ...options,
            outputDirectory: join(directory, 'two'),
        })
        expect(first.sha256).toBe(second.sha256)
        const extracted = join(directory, 'extracted')
        await mkdir(extracted)
        expect(await Bun.spawn(['tar', '-xzf', first.archive, '-C', extracted]).exited).toBe(0)
        const root = join(extracted, `postdot-studio-${options.version}`)
        const metadata = JSON.parse(await readFile(join(root, 'studio-release.json'), 'utf8'))
        expect(metadata).toMatchObject({
            formatVersion: 1,
            version: options.version,
            revision: options.revision,
            image: options.image,
            assetDirectory: 'public',
        })
        for (const [path, hash] of Object.entries(metadata.files)) {
            if (typeof hash !== 'string') throw new Error('Expected a release file checksum')
            const bytes = await Bun.file(join(root, path)).arrayBuffer()
            expect(new Bun.CryptoHasher('sha256').update(bytes).digest('hex')).toBe(hash)
        }
        expect(await readFile(join(root, 'public/assets/app.js'))).toEqual(
            await readFile(join(source, 'public/assets/app.js'))
        )
        expect(metadata.files['licenses/Dependency.LICENSE']).toBeDefined()
        expect(metadata.files['THIRD_PARTY_NOTICES.md']).toBeDefined()
        expect(await verifyStudioReleaseDirectory(root)).toMatchObject({
            version: options.version,
            revision: options.revision,
        })
        await writeFile(join(root, 'public/assets/app.js'), 'tampered')
        await expect(verifyStudioReleaseDirectory(root)).rejects.toThrow('checksum mismatch')
        metadata.files['../../outside'] = 'a'.repeat(64)
        await writeFile(join(root, 'studio-release.json'), JSON.stringify(metadata))
        await expect(verifyStudioReleaseDirectory(root)).rejects.toThrow('inventory')
        await expect(
            assembleStudioArchive(source, { ...options, outputDirectory: join(directory, 'one') })
        ).rejects.toThrow('EEXIST')
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})

test('refuses mutable images, unsafe versions, wrong source identity and symlink payloads', async () => {
    for (const image of [
        'postdot:latest',
        'ghcr.io/postdot/postdot:0.1.0',
        `other.example/postdot@sha256:${'a'.repeat(64)}`,
    ])
        expect(() => validateStudioArchiveOptions({ ...options, image })).toThrow('immutable')
    for (const version of ['latest', '../0.1.0', '0.01.0', '0.1.0;echo'])
        expect(() => validateStudioArchiveOptions({ ...options, version })).toThrow('version')
    expect(() => validateStudioArchiveOptions({ ...options, revision: 'short' })).toThrow(
        'revision'
    )
    const { directory, source } = await fixture()
    try {
        await expect(
            assembleStudioArchive(source, {
                ...options,
                version: '0.1.0',
                outputDirectory: directory,
            })
        ).rejects.toThrow('identity')
        await expect(
            assembleStudioArchive(source, {
                ...options,
                revision: 'c'.repeat(40),
                outputDirectory: directory,
            })
        ).rejects.toThrow('identity')
        await symlink('/etc/passwd', join(source, 'public/leak'))
        await expect(
            assembleStudioArchive(source, { ...options, outputDirectory: directory })
        ).rejects.toThrow('non-regular')
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})
