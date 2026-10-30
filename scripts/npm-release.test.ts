import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { checkedPlan, packageDirectories } from '../integrations/scripts/release-files.mjs'

const require = createRequire(import.meta.url)
const { verifyIdentity, verifyPackage } = require('../integrations/scripts/verify-release.cjs')
const root = resolve(import.meta.dir, '..')
const node = process.env.POSTDOT_CLI_NODE ?? Bun.which('node') ?? process.execPath
const identity = {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'postdot/postdot',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_WORKFLOW_REF: 'postdot/postdot/.github/workflows/n8n-publish.yml@refs/heads/main',
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.test/oidc',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fixture-only',
    GITHUB_EVENT_NAME: 'push',
    POSTDOT_NPM_RELEASE_MODE: 'release',
}

test('routine publication requires the existing main-workflow identity and refuses token fallback', () => {
    for (const directory of packageDirectories.values())
        expect(verifyPackage(directory, identity).publishConfig.tag).toBe('alpha')
    for (const change of [
        { GITHUB_ACTIONS: 'false' },
        { GITHUB_REPOSITORY: 'other/repository' },
        { GITHUB_REF: 'refs/heads/topic' },
        { GITHUB_WORKFLOW_REF: 'postdot/postdot/.github/workflows/other.yml@refs/heads/main' },
        { ACTIONS_ID_TOKEN_REQUEST_TOKEN: '' },
    ])
        expect(() => verifyIdentity({ ...identity, ...change })).toThrow()
    for (const change of [
        { NODE_AUTH_TOKEN: 'fixture-only' },
        { NPM_TOKEN: 'fixture-only' },
        { POSTDOT_NPM_RELEASE_MODE: 'unknown' },
    ])
        expect(() =>
            verifyPackage(packageDirectories.get('@postdot/cli'), { ...identity, ...change })
        ).toThrow()
})

test('first staging is an explicit CLI-only manual dispatch, never an n8n token fallback', () => {
    const initial = {
        ...identity,
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        POSTDOT_NPM_RELEASE_MODE: 'bootstrap-cli',
        NODE_AUTH_TOKEN: 'fixture-only',
    }
    expect(verifyPackage(packageDirectories.get('@postdot/cli'), initial).name).toBe('@postdot/cli')
    expect(() =>
        verifyPackage(packageDirectories.get('@postdot/n8n-nodes-postdot'), initial)
    ).toThrow()
    expect(() =>
        verifyPackage(packageDirectories.get('@postdot/cli'), {
            ...initial,
            GITHUB_EVENT_NAME: 'push',
        })
    ).toThrow()
    expect(() =>
        verifyPackage(packageDirectories.get('@postdot/cli'), { ...initial, NODE_AUTH_TOKEN: '' })
    ).toThrow()
})

test('packed plans reject altered archives, wrong release tags and paths outside the artifact directory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'postdot-release-plan-'))
    try {
        const source = join(directory, 'source/package')
        mkdirSync(source, { recursive: true })
        const metadata = JSON.parse(
            readFileSync(join(root, 'integrations/cli/package.json'), 'utf8')
        )
        writeFileSync(join(source, 'package.json'), JSON.stringify(metadata))
        const archive = join(directory, 'cli.tgz')
        execFileSync('tar', ['-czf', archive, '-C', dirname(source), 'package'])
        const release = {
            kind: 'publish',
            name: metadata.name,
            version: metadata.version,
            access: 'public',
            tag: 'alpha',
            tarball: {
                path: 'cli.tgz',
                integrity: `sha256-${createHash('sha256').update(readFileSync(archive)).digest('base64')}`,
            },
        }
        const file = join(directory, 'publish-plan.json')
        const write = (entry: unknown) =>
            writeFileSync(file, JSON.stringify({ version: 1, plan: [[entry]] }))
        write(release)
        expect(checkedPlan(file, { packed: true, artifactRoot: directory }).plan[0][0].tag).toBe(
            'alpha'
        )
        write({ ...release, tag: 'latest' })
        expect(() => checkedPlan(file, { packed: true, artifactRoot: directory })).toThrow(
            'canonical manifest'
        )
        write({ ...release, tarball: { ...release.tarball, path: '../cli.tgz' } })
        expect(() => checkedPlan(file, { packed: true, artifactRoot: directory })).toThrow(
            'escapes'
        )
        write(release)
        writeFileSync(archive, 'altered')
        expect(() => checkedPlan(file, { packed: true, artifactRoot: directory })).toThrow(
            'integrity'
        )
    } finally {
        rmSync(directory, { recursive: true, force: true })
    }
})

for (const packageName of ['@postdot/cli', '@postdot/n8n-nodes-postdot']) {
    test(`one Changesets workspace versions ${packageName} independently`, async () => {
        const directory = mkdtempSync(join(tmpdir(), 'postdot-release-version-'))
        try {
            const save = (name: string, value: unknown) => {
                const file = join(directory, name)
                mkdirSync(dirname(file), { recursive: true })
                writeFileSync(
                    file,
                    typeof value === 'string' ? value : JSON.stringify(value, null, 2)
                )
            }
            save('package.json', {
                name: 'release-fixture',
                private: true,
                workspaces: ['cli', 'n8n'],
            })
            save('package-lock.json', { lockfileVersion: 3, packages: {} })
            for (const [name, path] of packageDirectories) {
                const pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))
                pkg.version = name === '@postdot/cli' ? '0.1.0-alpha.0' : '0.1.0-alpha.2'
                save(`${name === '@postdot/cli' ? 'cli' : 'n8n'}/package.json`, pkg)
            }
            save('.changeset/config.json', {
                access: 'public',
                baseBranch: 'main',
                format: false,
                changelog: join(
                    root,
                    'integrations/node_modules/@changesets/cli/dist/changelog.mjs'
                ),
            })
            save('.changeset/pre.json', { mode: 'pre', tag: 'alpha' })
            save(
                '.changeset/pre/consumed-n8n.md',
                '---\n"@postdot/n8n-nodes-postdot": patch\n---\n\nPrevious package guide.\n'
            )
            save(
                '.changeset/new-package.md',
                `---\n"${packageName}": patch\n---\n\nRelease package independently.\n`
            )
            execFileSync('git', ['init', '--initial-branch=main', '--quiet'], { cwd: directory })
            execFileSync('git', ['add', '.'], { cwd: directory })
            execFileSync(
                'git',
                [
                    '-c',
                    'user.name=Release fixture',
                    '-c',
                    'user.email=release@example.test',
                    'commit',
                    '--quiet',
                    '-m',
                    'feat: prepare release fixture',
                ],
                { cwd: directory }
            )
            const process = Bun.spawn(
                [node, join(root, 'integrations/node_modules/@changesets/cli/bin.js'), 'version'],
                { cwd: directory, stdout: 'pipe', stderr: 'pipe' }
            )
            const [stdout, stderr, status] = await Promise.all([
                new Response(process.stdout).text(),
                new Response(process.stderr).text(),
                process.exited,
            ])
            expect(status, `${stdout}\n${stderr}`).toBe(0)
            expect(
                JSON.parse(readFileSync(join(directory, 'cli/package.json'), 'utf8')).version
            ).toBe(packageName === '@postdot/cli' ? '0.1.0-alpha.1' : '0.1.0-alpha.0')
            expect(
                JSON.parse(readFileSync(join(directory, 'n8n/package.json'), 'utf8')).version
            ).toBe(packageName === '@postdot/n8n-nodes-postdot' ? '0.1.0-alpha.3' : '0.1.0-alpha.2')
        } finally {
            rmSync(directory, { recursive: true, force: true })
        }
    })
}
