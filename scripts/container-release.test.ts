import { expect, it } from 'bun:test'

const workflow = Bun.YAML.parse(
    await Bun.file(new URL('../.github/workflows/container-release.yml', import.meta.url)).text()
) as { jobs: { preflight: { steps: { with?: { script?: string } }[] } } }
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
