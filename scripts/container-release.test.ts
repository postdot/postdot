import { expect, it } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const workflow = Bun.YAML.parse(
    await Bun.file(new URL('../.github/workflows/container-release.yml', import.meta.url)).text()
) as {
    jobs: {
        preflight: { steps: { name?: string; run?: string; with?: { script?: string } }[] }
        publish: {
            permissions: { contents: string }
            steps: { name: string; if?: string; run?: string; with?: { script?: string } }[]
        }
    }
}
const script = workflow.jobs.preflight.steps.find(step => step.with?.script)?.with?.script
if (!script) throw new Error('Release preflight script not found')
const preflight = new (Object.getPrototypeOf(async () => {}).constructor)(
    'core',
    'context',
    'github',
    'process',
    script
) as (...args: unknown[]) => Promise<void>

async function evaluate(
    options: {
        tag?: string
        previous?: string
        acknowledged?: string
        ci?: boolean
        existing?: boolean
    } = {}
) {
    const failures: string[] = []
    const notices: string[] = []
    const sha = 'a'.repeat(40)
    await preflight(
        {
            setFailed: (value: string) => failures.push(value),
            notice: (value: string) => notices.push(value),
        },
        { ref: 'refs/heads/main', repo: { owner: 'postdot', repo: 'postdot' } },
        {
            paginate: async (route: string) =>
                route.includes('/actions/')
                    ? [
                          {
                              head_sha: sha,
                              status: 'completed',
                              conclusion: options.ci === false ? 'failure' : 'success',
                          },
                      ]
                    : options.existing
                      ? [{ metadata: { container: { tags: [options.tag ?? '0.1.0-alpha.2'] } } }]
                      : [],
        },
        {
            env: {
                SOURCE_SHA: sha,
                IMAGE_TAG: options.tag ?? '0.1.0-alpha.2',
                PREVIOUS_IMAGE:
                    options.previous ?? `ghcr.io/postdot/postdot@sha256:${'b'.repeat(64)}`,
                PUBLIC_VISIBILITY_ACKNOWLEDGED: options.acknowledged ?? 'true',
            },
        }
    )
    return { failures, notices }
}

it('accepts explicitly authorized version tags with successful source CI and an unused tag', async () => {
    for (const tag of ['0.1.0-alpha.2', '0.1.0-beta.1', '0.1.0-rc.1', '0.1.0']) {
        const result = await evaluate({ tag })
        expect(result.failures).toEqual([])
        expect(result.notices).toHaveLength(1)
    }
})

it('refuses aliases, mutable previous-image tags, missing acknowledgement, failed CI and existing tags', async () => {
    for (const options of [
        { tag: 'latest' },
        { tag: '0.01.0' },
        { tag: 'alpha' },
        { previous: 'ghcr.io/postdot/postdot:0.1.0-alpha.1' },
        { acknowledged: 'false' },
        { ci: false },
        { existing: true },
    ]) {
        const result = await evaluate(options)
        expect(result.failures).toHaveLength(1)
        expect(result.notices).toEqual([])
    }
})

const releaseStep = workflow.jobs.publish.steps.find(
    step => step.name === 'Publish the matching GitHub Release'
)
if (!releaseStep?.with?.script) throw new Error('GitHub Release step not found')
const publishRelease = new (Object.getPrototypeOf(async () => {}).constructor)(
    'context',
    'github',
    'process',
    releaseStep.with.script
) as (...args: unknown[]) => Promise<void>

it('tags the accepted source and marks preview images as prereleases', async () => {
    const created: Record<string, unknown>[] = []
    await publishRelease(
        { repo: { owner: 'postdot', repo: 'postdot' }, runId: 42 },
        {
            rest: {
                repos: {
                    createRelease: async (release: Record<string, unknown>) =>
                        created.push(release),
                },
            },
        },
        {
            env: {
                IMAGE_TAG: '0.1.0-alpha.8',
                SOURCE_SHA: 'a'.repeat(40),
                IMAGE_DIGEST: `sha256:${'b'.repeat(64)}`,
                RELEASE_NOTES: 'New publishing tools.',
                PREVIOUS_IMAGE: 'previous-image',
            },
        }
    )
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
        tag_name: 'v0.1.0-alpha.8',
        target_commitish: 'a'.repeat(40),
        prerelease: true,
        make_latest: 'false',
    })
    expect(created[0]?.body).toContain(`ghcr.io/postdot/postdot@sha256:${'b'.repeat(64)}`)
    expect(created[0]?.body).toContain('/actions/runs/42')
    expect(workflow.jobs.publish.permissions.contents).toBe('write')
    expect(releaseStep.if).toContain("steps.anonymous_pull.outcome == 'success'")
})

it('refuses to create a release without an immutable image digest', async () => {
    let writes = 0
    await expect(
        publishRelease(
            { repo: { owner: 'postdot', repo: 'postdot' }, runId: 42 },
            {
                rest: {
                    repos: {
                        createRelease: async () => {
                            writes++
                        },
                    },
                },
            },
            {
                env: {
                    IMAGE_TAG: '0.1.0',
                    SOURCE_SHA: 'a'.repeat(40),
                    IMAGE_DIGEST: '',
                    RELEASE_NOTES: 'Changes.',
                },
            }
        )
    ).rejects.toThrow('verified image digest')
    expect(writes).toBe(0)
})

it('marks stable image releases as latest', async () => {
    const created: Record<string, unknown>[] = []
    await publishRelease(
        { repo: { owner: 'postdot', repo: 'postdot' }, runId: 42 },
        {
            rest: {
                repos: {
                    createRelease: async (release: Record<string, unknown>) =>
                        created.push(release),
                },
            },
        },
        {
            env: {
                IMAGE_TAG: '0.1.0',
                SOURCE_SHA: 'a'.repeat(40),
                IMAGE_DIGEST: `sha256:${'b'.repeat(64)}`,
                RELEASE_NOTES: 'Stable release.',
                PREVIOUS_IMAGE: 'previous-image',
            },
        }
    )
    expect(created[0]).toMatchObject({ tag_name: 'v0.1.0', prerelease: false, make_latest: 'true' })
})

it('prepares Studio before release creation and attaches files with usable checksums', async () => {
    expect(
        workflow.jobs.preflight.steps.find(
            step => step.name === 'Require the tested commit to belong to main'
        )?.run
    ).toContain('git cat-file -e "${SOURCE_SHA}:scripts/studio-archive.ts"')
    const steps = workflow.jobs.publish.steps
    const packaged = steps.findIndex(
        step => step.name === 'Package Studio from the immutable published image'
    )
    const published = steps.findIndex(step => step.name === 'Publish the matching GitHub Release')
    const attached = steps.findIndex(
        step => step.name === 'Attach release-matched installation and Studio files'
    )
    expect(packaged).toBeGreaterThan(-1)
    expect(packaged).toBeLessThan(published)
    expect(attached).toBeGreaterThan(published)
    for (const index of [packaged, attached]) {
        expect(steps[index]!.if).toContain("steps.anonymous_pull.outcome == 'success'")
        expect(steps[index]!.if).toContain("steps.manifest.outcome == 'success'")
    }
    const directory = await mkdtemp(join(tmpdir(), 'postdot-release-attachments-'))
    try {
        const output = join(directory, 'dist/studio-releases')
        const bin = join(directory, 'bin')
        await mkdir(output, { recursive: true })
        await mkdir(bin)
        await writeFile(join(directory, 'compose.yaml'), 'services: {}\n')
        await writeFile(join(directory, 'compose.env.example'), 'POSTDOT_WEB_ENABLED=true\n')
        await writeFile(join(output, 'postdot-studio-0.1.0-alpha.8.tar.gz'), 'archive bytes')
        const recorded = join(directory, 'uploaded.txt')
        await writeFile(
            join(bin, 'gh'),
            '#!/bin/sh\nprintf "%s\\n" "$@" > "$POSTDOT_TEST_UPLOAD_ARGUMENTS"\n'
        )
        await chmod(join(bin, 'gh'), 0o700)
        const run = Bun.spawn(['bash', '-e', '-c', steps[attached]!.run!], {
            cwd: directory,
            env: {
                ...process.env,
                PATH: `${bin}:${process.env.PATH}`,
                IMAGE_TAG: '0.1.0-alpha.8',
                GITHUB_REPOSITORY: 'postdot/postdot',
                GH_TOKEN: 'test-no-network',
                POSTDOT_TEST_UPLOAD_ARGUMENTS: recorded,
            },
            stdout: 'pipe',
            stderr: 'pipe',
        })
        expect(await run.exited).toBe(0)
        const checked = Bun.spawn(['sha256sum', '--check', 'SHA256SUMS'], {
            cwd: output,
            stdout: 'pipe',
            stderr: 'pipe',
        })
        expect(await checked.exited).toBe(0)
        expect((await readFile(recorded, 'utf8')).trim().split('\n')).toEqual([
            'release',
            'upload',
            'v0.1.0-alpha.8',
            'compose.yaml',
            'compose.env.example',
            'postdot-studio-0.1.0-alpha.8.tar.gz',
            'SHA256SUMS',
            '--repo',
            'postdot/postdot',
        ])
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})
