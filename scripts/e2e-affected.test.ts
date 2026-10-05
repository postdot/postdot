import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
    FUNCTIONAL_DOMAINS,
    collectChangedPaths,
    domainsForPath,
    listSpecFiles,
    matchesPattern,
    resolveAffectedScenarios,
    type GitRunner,
} from './e2e-affected'

const KNOWN_SPECS = [
    'e2e/access-134-project-access.spec.ts',
    'e2e/access-219-password-reset.spec.ts',
    'e2e/editor-composer-pilot.spec.ts',
    'e2e/publication-concurrent-editing.spec.ts',
    'e2e/publication-media.spec.ts',
    'e2e/queue-bulk-actions.spec.ts',
    'e2e/realtime-validation.spec.ts',
    'e2e/web-314-editor-access-state.spec.ts',
]

describe('pattern matching', () => {
    test('single star does not cross a path separator', () => {
        expect(
            matchesPattern(
                'apps/web/src/components/media/upload.ts',
                'apps/web/src/components/media/*'
            )
        ).toBe(true)
        expect(
            matchesPattern(
                'apps/web/src/components/media/viewer/upload.ts',
                'apps/web/src/components/media/*'
            )
        ).toBe(false)
    })

    test('double star crosses path separators', () => {
        expect(
            matchesPattern(
                'apps/web/src/components/media/viewer/upload.ts',
                'apps/web/src/components/media/**'
            )
        ).toBe(true)
    })

    test('a literal dot is not a wildcard', () => {
        expect(
            matchesPattern(
                'apps/web/src/routes/dashboard.tsx.bak',
                'apps/web/src/routes/dashboard.tsx'
            )
        ).toBe(false)
    })
})

describe('resolution safety', () => {
    test('an empty change set selects the full matrix', () => {
        const resolution = resolveAffectedScenarios([], KNOWN_SPECS)

        expect(resolution.mode).toBe('full')
        expect(resolution.scenarios).toEqual(KNOWN_SPECS)
    })

    test('an unmapped path selects the full matrix and names the path', () => {
        const resolution = resolveAffectedScenarios(
            ['apps/web/src/lib/unmapped-helper.ts'],
            KNOWN_SPECS
        )

        expect(resolution.mode).toBe('full')
        if (resolution.mode !== 'full') throw new Error('expected full selection')
        expect(resolution.reason).toContain('apps/web/src/lib/unmapped-helper.ts')
    })

    test('a transversal path selects the full matrix and names the reason', () => {
        const resolution = resolveAffectedScenarios(['packages/db/src/schema.ts'], KNOWN_SPECS)

        expect(resolution.mode).toBe('full')
        if (resolution.mode !== 'full') throw new Error('expected full selection')
        expect(resolution.reason).toContain('packages/db/src/schema.ts')
        expect(resolution.reason).toContain('transversal')
    })

    test('the harness configuration is transversal', () => {
        expect(resolveAffectedScenarios(['playwright.config.ts'], KNOWN_SPECS).mode).toBe('full')
        expect(resolveAffectedScenarios(['scripts/e2e-runtime.ts'], KNOWN_SPECS).mode).toBe('full')
    })

    test('a targeted selection never returns zero scenarios', () => {
        for (const domain of FUNCTIONAL_DOMAINS) {
            for (const spec of domain.specs) {
                const resolution = resolveAffectedScenarios([spec], KNOWN_SPECS)
                if (resolution.mode === 'targeted') {
                    expect(resolution.scenarios.length).toBeGreaterThan(0)
                }
            }
        }
    })

    test('a new spec file with no domain entry falls back to the full matrix', () => {
        const resolution = resolveAffectedScenarios(['e2e/new-unmapped-area.spec.ts'], KNOWN_SPECS)

        expect(resolution.mode).toBe('full')
        if (resolution.mode !== 'full') throw new Error('expected full selection')
        expect(resolution.reason).toContain('no scenario could be attributed')
    })

    test('a changed spec outside the inventory never reports an empty selection', () => {
        const resolution = resolveAffectedScenarios(['e2e/locale.ts'], [])

        expect(resolution.mode).toBe('full')
        expect(resolution.scenarios).toEqual([])
    })
})

describe('deleted and changed files', () => {
    test('a deleted spec is never selected', () => {
        const resolution = resolveAffectedScenarios(
            ['e2e/queue-bulk-actions.spec.ts', 'e2e/realtime-validation.spec.ts'],
            KNOWN_SPECS,
            ['e2e/queue-bulk-actions.spec.ts']
        )

        expect(resolution.mode).toBe('targeted')
        if (resolution.mode !== 'targeted') throw new Error('expected targeted selection')
        expect(resolution.scenarios.map(scenario => scenario.spec)).not.toContain(
            'e2e/queue-bulk-actions.spec.ts'
        )
        expect(resolution.scenarios.map(scenario => scenario.spec)).toContain(
            'e2e/realtime-validation.spec.ts'
        )
    })

    test('a deleted spec is excluded from a full fallback too', () => {
        const resolution = resolveAffectedScenarios(['packages/db/src/schema.ts'], KNOWN_SPECS, [
            'e2e/queue-bulk-actions.spec.ts',
        ])

        if (resolution.mode !== 'full') throw new Error('expected full selection')
        expect(resolution.scenarios).not.toContain('e2e/queue-bulk-actions.spec.ts')
    })

    test('a changed spec is selected directly without widening the matrix', () => {
        const resolution = resolveAffectedScenarios(['e2e/queue-bulk-actions.spec.ts'], KNOWN_SPECS)

        if (resolution.mode !== 'targeted') throw new Error('expected targeted selection')
        expect(resolution.scenarios).toHaveLength(1)
        expect(resolution.scenarios[0]!.reasons).toEqual(['scenario file changed'])
    })

    test('a deleted code path still maps to its domain', () => {
        const resolution = resolveAffectedScenarios(
            ['apps/web/src/lib/project-access-verification.ts'],
            KNOWN_SPECS,
            ['apps/web/src/lib/project-access-verification.ts']
        )

        if (resolution.mode !== 'targeted') throw new Error('expected targeted selection')
        expect(resolution.scenarios.map(scenario => scenario.spec)).toContain(
            'e2e/web-314-editor-access-state.spec.ts'
        )
    })
})

describe('functional dependencies', () => {
    test('a route path segment is matched by wildcard, not by a literal id', () => {
        expect(
            domainsForPath(
                'apps/web/src/routes/dashboard/projects/$projectId/publications/$publicationId.tsx'
            ).map(domain => domain.id)
        ).toContain('publication-authoring')
    })

    test('a co-located unit test resolves through the module it exercises', () => {
        expect(
            domainsForPath('apps/web/src/lib/project-access-verification.test.ts').map(d => d.id)
        ).toEqual(['access-control'])
    })

    test('a test beside a component resolves across the ts and tsx extension', () => {
        expect(domainsForPath('apps/web/src/lib/project-realtime.test.ts').map(d => d.id)).toEqual([
            'realtime-and-notifications',
        ])
    })

    test('a media component belongs to both media and authoring', () => {
        const identifiers = domainsForPath(
            'apps/web/src/components/media-attachment-picker.tsx'
        ).map(domain => domain.id)

        expect(identifiers).toContain('media-library')
        expect(identifiers).toContain('publication-authoring')
    })

    test('a shared publication route belongs to both authoring and lifecycle', () => {
        const identifiers = domainsForPath(
            'apps/api/src/modules/projects/publication-routes.ts'
        ).map(domain => domain.id)

        expect(identifiers).toContain('publication-authoring')
        expect(identifiers).toContain('publication-lifecycle')
    })

    test('a provider package selects connection scenarios', () => {
        const resolution = resolveAffectedScenarios(['packages/x/src/x-client.ts'], KNOWN_SPECS)

        if (resolution.mode !== 'targeted') throw new Error('expected targeted selection')
        expect(resolution.domains.map(domain => domain.id)).toEqual(['channels-and-connections'])
    })

    test('every domain declares at least one scenario and one pattern', () => {
        for (const domain of FUNCTIONAL_DOMAINS) {
            expect(domain.patterns.length).toBeGreaterThan(0)
            expect(domain.specs.length).toBeGreaterThan(0)
            expect(domain.label.length).toBeGreaterThan(0)
        }
    })

    test('no domain pattern is shadowed by a transversal rule', () => {
        for (const domain of FUNCTIONAL_DOMAINS) {
            for (const pattern of domain.patterns) {
                expect(domainsForPath(pattern)).not.toHaveLength(0)
            }
        }
    })
})

describe('report determinism', () => {
    test('the same change set resolves identically regardless of input order', () => {
        const paths = [
            'apps/web/src/lib/project-realtime.tsx',
            'apps/api/src/modules/media/runtime.ts',
            'apps/web/src/components/publication-queue-page.tsx',
        ]

        const forward = resolveAffectedScenarios(paths, KNOWN_SPECS)
        const reversed = resolveAffectedScenarios([...paths].reverse(), KNOWN_SPECS)

        expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward))
    })

    test('duplicate paths do not duplicate reasons', () => {
        const resolution = resolveAffectedScenarios(
            [
                'apps/web/src/lib/project-access-verification.ts',
                'apps/web/src/lib/project-access-verification.ts',
            ],
            KNOWN_SPECS
        )

        if (resolution.mode !== 'targeted') throw new Error('expected targeted selection')
        for (const scenario of resolution.scenarios) {
            expect(new Set(scenario.reasons).size).toBe(scenario.reasons.length)
        }
    })

    test('reasons are deterministic for repeated resolutions', () => {
        const resolution = () =>
            resolveAffectedScenarios(['apps/web/src/lib/project-realtime.tsx'], KNOWN_SPECS)

        expect(JSON.stringify(resolution())).toBe(JSON.stringify(resolution()))
    })
})

describe('change collection', () => {
    test('committed, staged, unstaged, and untracked paths are all considered', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'herald-e2e-affected-'))

        const run = (arguments_: readonly string[]): string => {
            const result = Bun.spawnSync(['git', ...arguments_], { cwd: directory })
            expect(result.exitCode).toBe(0)
            return result.stdout.toString()
        }
        const write = (path: string, contents: string): void => {
            Bun.spawnSync(
                [
                    'bash',
                    '-c',
                    `mkdir -p "$(dirname "$1")" && printf '%s' "$2" > "$1"`,
                    '_',
                    path,
                    contents,
                ],
                {
                    cwd: directory,
                }
            )
        }

        try {
            run(['init', '--initial-branch=main'])
            run(['config', 'user.email', 'selector@example.invalid'])
            run(['config', 'user.name', 'Selector Test'])

            write('baseline.txt', 'baseline\n')
            write('removed.txt', 'removed\n')
            write('unstaged.txt', 'baseline\n')
            run(['add', '.'])
            run(['commit', '-m', 'base'])

            run(['checkout', '-q', '-b', 'feature'])

            write('committed.txt', 'committed\n')
            run(['add', 'committed.txt'])
            run(['commit', '-m', 'committed change'])

            write('staged.txt', 'staged\n')
            run(['add', 'staged.txt'])

            write('unstaged.txt', 'modified\n')

            write('untracked.txt', 'untracked\n')

            run(['rm', '--quiet', 'removed.txt'])

            const collected = collectChangedPaths('main', arguments_ => run([...arguments_]))

            expect(collected.paths).toEqual(
                expect.arrayContaining([
                    'committed.txt',
                    'staged.txt',
                    'unstaged.txt',
                    'untracked.txt',
                    'removed.txt',
                ])
            )
            expect(collected.deleted).toContain('removed.txt')
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })

    test('an unparsable base falls back to the base itself', () => {
        const git: GitRunner = arguments_ => {
            if (arguments_[0] === 'merge-base') return ''
            if (arguments_.includes('--diff-filter=D')) return ''
            if (arguments_[0] === 'status') return ' M apps/web/src/lib/theme.ts\n'
            if (arguments_[0] === 'ls-files') return ''
            return 'apps/web/src/lib/theme.ts\n'
        }

        expect(collectChangedPaths('unknown-base', git).paths).toEqual([
            'apps/web/src/lib/theme.ts',
        ])
    })
})

describe('spec inventory', () => {
    test('the repository inventory lists every spec file it can select', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'herald-e2e-inventory-'))

        try {
            const specs = listSpecFiles(join(import.meta.dir, '..', 'e2e'))

            expect(specs.length).toBeGreaterThan(0)
            expect(specs).toContain('e2e/web-314-editor-access-state.spec.ts')
            for (const spec of specs) expect(spec.startsWith('e2e/')).toBe(true)
            expect(new Set(specs).size).toBe(specs.length)
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })
})
