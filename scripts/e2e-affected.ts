/**
 * Affected E2E scenario selector.
 *
 * Maps changed repository paths to the Playwright scenarios that can observe
 * them. The mapping is expressed as functional domains (the surfaces a user
 * journey depends on) rather than spec-file names, so a new spec inherits its
 * domain only through a deliberate entry.
 *
 * Safety rules, in order of precedence:
 *   1. An unknown path or a transversal path always returns the full matrix.
 *   2. An empty change set never returns an empty selection.
 *   3. A deleted spec is never selected.
 *   4. A changed spec file is selected directly and does not widen the matrix.
 *
 * The selector never edits a gate and never changes workers, retries, or waits.
 * It only reports what a targeted run would cover.
 */

import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

export interface FunctionalDomain {
    readonly id: string
    readonly label: string
    readonly patterns: readonly string[]
    readonly specs: readonly string[]
}

export interface TransversalPath {
    readonly pattern: string
    readonly reason: string
}

/**
 * Functional domains. Each entry is a user-visible capability plus the API,
 * route, component, or package code that capability depends on. A path may
 * belong to several domains when one file serves several journeys.
 */
export const FUNCTIONAL_DOMAINS: readonly FunctionalDomain[] = [
    {
        id: 'identity-and-recovery',
        label: 'Sign-in, account, password reset, and instance setup',
        patterns: [
            'apps/api/src/local-account-recovery.ts',
            'apps/api/src/modules/account/**',
            'apps/api/src/modules/email/**',
            'apps/web/src/routes/login.tsx',
            'apps/web/src/routes/forgot-password.tsx',
            'apps/web/src/routes/reset-password.tsx',
            'apps/web/src/routes/invite.tsx',
            'apps/web/src/routes/setup.tsx',
            'apps/web/src/routes/index.tsx',
            'apps/web/src/components/auth-form.tsx',
            'apps/web/src/components/auth-shell.tsx',
            'apps/web/src/components/user-account-page.tsx',
            'apps/web/src/components/user-preferences-page.tsx',
        ],
        specs: [
            'e2e/access-132-instance-access.spec.ts',
            'e2e/access-219-password-reset.spec.ts',
            'e2e/access-219-password-reset-offline.spec.ts',
            'e2e/account-settings.spec.ts',
            'e2e/settings-workspace-continuity.spec.ts',
        ],
    },
    {
        id: 'access-control',
        label: 'Roles, project and instance access, invitations, API keys',
        patterns: [
            'apps/api/src/modules/access/**',
            'apps/api/src/modules/projects/access-grant-routes.ts',
            'apps/api/src/modules/projects/access-revocation-*.test.ts',
            'apps/api/src/modules/projects/member-routes.ts',
            'apps/api/src/modules/projects/api-key-permissions.ts',
            'apps/api/src/modules/projects/authorization.ts',
            'apps/web/src/routes/dashboard/projects/*/access.tsx',
            'apps/web/src/routes/dashboard/projects/*/invitations.tsx',
            'apps/web/src/routes/dashboard/settings/access.tsx',
            'apps/web/src/routes/dashboard/preferences/api-keys.tsx',
            'apps/web/src/components/project-access-page.tsx',
            'apps/web/src/components/project-invitations-page.tsx',
            'apps/web/src/components/project-members-section.tsx',
            'apps/web/src/components/access-page-header.tsx',
            'apps/web/src/components/instance-access-settings-page.tsx',
            'apps/web/src/components/user-api-keys-page.tsx',
            'apps/web/src/components/workspace-groups-section.tsx',
            'apps/web/src/lib/project-access-verification.ts',
        ],
        specs: [
            'e2e/access-134-project-access.spec.ts',
            'e2e/access-135-workspace-invitation.spec.ts',
            'e2e/access-136-project-roles.spec.ts',
            'e2e/access-137-user-api-keys.spec.ts',
            'e2e/design-121-instance-scope.spec.ts',
            'e2e/web-310-overview-viewer-actions.spec.ts',
            'e2e/web-312-live-access-revocation.spec.ts',
            'e2e/web-314-editor-access-state.spec.ts',
        ],
    },
    {
        id: 'publication-authoring',
        label: 'Composer, editor, drafts, targets, and promotion',
        patterns: [
            'apps/api/src/modules/projects/post-routes.ts',
            'apps/api/src/modules/projects/publication-routes.ts',
            'apps/web/src/routes/dashboard/projects/*/publications/new.tsx',
            'apps/web/src/routes/dashboard/projects/*/publications/*.tsx',
            'apps/web/src/routes/editor-lab.tsx',
            'apps/web/src/components/publication-*.tsx',
            'apps/web/src/components/new-publication-page.tsx',
            'apps/web/src/components/editor-experiment-page.tsx',
            'apps/web/src/components/article-image-control.tsx',
            'apps/web/src/components/date-time-picker.tsx',
            'apps/web/src/components/media-attachment-picker.tsx',
            'apps/web/src/lib/publication-authoring.ts',
            'apps/web/src/lib/publication-preview.ts',
            'apps/web/src/lib/publication-promotion.ts',
            'apps/web/src/lib/publication-identity.ts',
            'apps/web/src/lib/channel-identity.ts',
            'apps/web/src/lib/channel-profile-presets.ts',
            'apps/web/src/lib/target-*.ts',
            'apps/web/src/lib/article-image-url.ts',
            'apps/web/src/lib/editor-experiment/**',
        ],
        specs: [
            'e2e/design-121-narrow-new-publication.spec.ts',
            'e2e/editor-composer-pilot.spec.ts',
            'e2e/editor-experiment.spec.ts',
            'e2e/editor-touch-composition.spec.ts',
            'e2e/publication-concurrent-editing.spec.ts',
            'e2e/publication-detail-actions.spec.ts',
            'e2e/web-314-editor-access-state.spec.ts',
            'e2e/x-weighted-text.spec.ts',
        ],
    },
    {
        id: 'publication-lifecycle',
        label: 'Queue, scheduling, approvals, outcomes, and recovery',
        patterns: [
            'apps/api/src/modules/workflow/**',
            'apps/api/src/modules/projects/publication-routes.ts',
            'apps/web/src/routes/dashboard/projects/*/queue.tsx',
            'apps/web/src/components/publication-queue-page.tsx',
            'apps/web/src/components/publication-lifecycle-panel.tsx',
            'apps/web/src/components/publication-outcome-panel.tsx',
            'apps/web/src/components/publication-activity-timeline.tsx',
            'apps/web/src/components/publication-approval-requests.tsx',
            'apps/web/src/components/publication-recovery-comparison.tsx',
            'apps/web/src/components/publication-bulk-*.tsx',
            'apps/web/src/components/publication-summary-bar.tsx',
            'apps/web/src/components/publication-calendar*.tsx',
            'apps/web/src/components/bulk-action-bar.tsx',
            'apps/web/src/components/empty-state.tsx',
            'apps/web/src/lib/publication-lifecycle.ts',
            'apps/web/src/lib/publication-queue.ts',
            'apps/web/src/lib/publication-recovery.ts',
            'apps/web/src/lib/publication-calendar*.ts',
            'apps/web/src/lib/event-calendar-time-anchor.ts',
        ],
        specs: [
            'e2e/design-121-queue-filters.spec.ts',
            'e2e/publication-approval.spec.ts',
            'e2e/publication-detail-actions.spec.ts',
            'e2e/queue-bulk-actions.spec.ts',
            'e2e/web-124-ambiguous-recovery.spec.ts',
            'e2e/web-124-outcome-states.spec.ts',
        ],
    },
    {
        id: 'media-library',
        label: 'Media upload, library, retention, and delivery',
        patterns: [
            'apps/api/src/modules/media/**',
            'apps/web/src/routes/dashboard/projects/*/media.tsx',
            'apps/web/src/components/media/**',
            'apps/web/src/components/media-*.tsx',
            'apps/web/src/components/publication-article-body.tsx',
            'apps/web/src/lib/media-*.ts',
            'apps/web/src/lib/herald-media-upload.ts',
        ],
        specs: [
            'e2e/design-121-narrow-new-publication.spec.ts',
            'e2e/publication-media.spec.ts',
            'e2e/web-124-outcome-states.spec.ts',
        ],
    },
    {
        id: 'channels-and-connections',
        label: 'Channel lifecycle, provider connections, and identity',
        patterns: [
            'apps/api/src/modules/publishers/**',
            'apps/api/src/modules/projects/channel-routes.ts',
            'apps/api/src/modules/projects/channel-profile-routes.ts',
            'apps/api/src/modules/projects/channel-profile-presets.ts',
            'apps/api/src/modules/projects/channel-profile-preset-routes.ts',
            'apps/api/src/modules/projects/publisher-routes.ts',
            'apps/api/src/modules/projects/publisher-providers/**',
            'apps/web/src/routes/dashboard/projects/*/channels.tsx',
            'apps/web/src/components/channel-*.tsx',
            'apps/web/src/components/*-connection-dialog.tsx',
            'apps/web/src/components/publisher-connection-panel.tsx',
            'apps/web/src/components/identity-visuals.tsx',
            'apps/web/src/lib/publisher-connection-feedback.ts',
            'packages/bluesky/**',
            'packages/custom-http/**',
            'packages/devto/**',
            'packages/discord/**',
            'packages/linkedin/**',
            'packages/mastodon/**',
            'packages/oauth/**',
            'packages/x/**',
        ],
        specs: [
            'e2e/channel-authoring-identity.spec.ts',
            'e2e/channel-profile-presets.spec.ts',
            'e2e/channel-x-connection.spec.ts',
            'e2e/design-121-instance-scope.spec.ts',
            'e2e/provider-application-settings.spec.ts',
            'e2e/publisher-connection-recovery.spec.ts',
        ],
    },
    {
        id: 'overview-and-performance',
        label: 'Overview, viewer restrictions, and performance reporting',
        patterns: [
            'apps/api/src/modules/projects/analytics-*.ts',
            'apps/api/src/modules/projects/provider-analytics-*.ts',
            'apps/api/src/modules/projects/bluesky-analytics-service.ts',
            'apps/api/src/modules/projects/devto-analytics-service.ts',
            'apps/api/src/modules/metrics/**',
            'apps/web/src/routes/dashboard/projects/*/overview.tsx',
            'apps/web/src/routes/dashboard/projects/*/performance.tsx',
            'apps/web/src/components/dashboard-overview.tsx',
            'apps/web/src/components/publication-performance-page.tsx',
        ],
        specs: [
            'e2e/design-121-instance-scope.spec.ts',
            'e2e/web-124-outcome-states.spec.ts',
            'e2e/web-310-overview-viewer-actions.spec.ts',
        ],
    },
    {
        id: 'shell-navigation-and-locale',
        label: 'Application shell, navigation matrix, theme, and translations',
        patterns: [
            'apps/web/src/routes/__root.tsx',
            'apps/web/src/routes/dashboard.tsx',
            'apps/web/src/routes/dashboard/preferences.tsx',
            'apps/web/src/routes/dashboard/preferences/index.tsx',
            'apps/web/src/routes/dashboard/settings/index.tsx',
            'apps/web/src/components/dashboard-shell.tsx',
            'apps/web/src/components/dashboard-sidebar.tsx',
            'apps/web/src/components/dashboard-header.tsx',
            'apps/web/src/components/dashboard-page-header.tsx',
            'apps/web/src/components/dashboard-section-heading.tsx',
            'apps/web/src/components/language-switcher.tsx',
            'apps/web/src/components/theme-toggle.tsx',
            'apps/web/src/components/notification-inbox.tsx',
            'apps/web/src/components/query-error-state.tsx',
            'apps/web/src/components/app-error-state.tsx',
            'apps/web/src/components/resource-creation-dialog.tsx',
            'apps/web/src/lib/i18n.tsx',
            'apps/web/src/lib/theme.ts',
            'apps/web/src/lib/format.ts',
            'apps/web/src/lib/date-time.ts',
            'apps/web/src/lib/notification-content.ts',
            'apps/web/messages/**',
            'packages/ui/**',
            'e2e/locale.ts',
        ],
        specs: [
            'e2e/accessibility-smoke.spec.ts',
            'e2e/design-121-instance-scope.spec.ts',
            'e2e/design-121-navigation-matrix.spec.ts',
            'e2e/design-121-shell.spec.ts',
            'e2e/web-122-empty-states.spec.ts',
            'e2e/web-122-populated-states.spec.ts',
        ],
    },
    {
        id: 'realtime-and-notifications',
        label: 'Event streams, realtime sync, and notification inbox',
        patterns: [
            'apps/api/src/modules/notifications/**',
            'apps/api/src/modules/projects/realtime-*.ts',
            'apps/api/src/modules/projects/notification-*.ts',
            'apps/web/src/routes/dashboard/projects/*/realtime-prototype.tsx',
            'apps/web/src/components/realtime-prototype-page.tsx',
            'apps/web/src/lib/project-realtime.tsx',
            'apps/web/src/lib/realtime-*.ts',
            'apps/web/src/lib/project-realtime.tsx',
        ],
        specs: [
            'e2e/realtime-validation.spec.ts',
            'e2e/web-124-outcome-states.spec.ts',
            'e2e/web-312-live-access-revocation.spec.ts',
        ],
    },
    {
        id: 'workspace-administration',
        label: 'Workspace continuity, provider applications, and settings pages',
        patterns: [
            'apps/web/src/routes/dashboard/settings/workspace.tsx',
            'apps/web/src/routes/dashboard/settings/provider-applications.tsx',
            'apps/web/src/routes/dashboard/preferences/account.tsx',
            'apps/web/src/components/workspace-administration-page.tsx',
            'apps/web/src/components/configuration-settings-page.tsx',
            'apps/web/src/components/provider-application-*.tsx',
            'apps/api/src/modules/publishers/application-config-routes.ts',
        ],
        specs: [
            'e2e/account-settings.spec.ts',
            'e2e/design-121-instance-scope.spec.ts',
            'e2e/provider-application-settings.spec.ts',
            'e2e/settings-workspace-continuity.spec.ts',
        ],
    },
]

/**
 * Paths that no scenario observes: governance records and prose. A change set
 * made only of these requires no scenario.
 *
 * This is a policy classification, not a coverage claim. It says no browser
 * journey can observe the change, not that the change is verified. Any code path
 * in the same change set re-engages the ordinary rules, including the full-matrix
 * fallback for unknown and transversal code.
 */
export const DOCUMENTATION_PATHS: readonly TransversalPath[] = [
    { pattern: '.autonomos/**', reason: 'governance, task, and evidence records' },
    { pattern: 'docs/**', reason: 'developer documentation' },
    { pattern: '**/*.md', reason: 'prose' },
]

/**
 * Paths that invalidate the matrix itself: shared foundations, harness
 * configuration, and infrastructure.
 */
export const TRANSVERSAL_PATHS: readonly TransversalPath[] = [
    { pattern: 'packages/db/**', reason: 'schema and migration layer feed every scenario' },
    { pattern: 'packages/core/**', reason: 'shared domain model feeds every scenario' },
    { pattern: 'packages/client/**', reason: 'shared transport feeds every scenario' },
    { pattern: 'packages/email/**', reason: 'mail delivery feeds the recovery scenarios' },
    { pattern: 'apps/api/src/app.ts', reason: 'API composition root wires every route' },
    { pattern: 'apps/api/src/index.ts', reason: 'API process entry point' },
    { pattern: 'apps/api/src/config.ts', reason: 'runtime configuration is shared by the API' },
    { pattern: 'apps/api/src/environment.ts', reason: 'environment contract is shared by the API' },
    { pattern: 'apps/api/src/shutdown.ts', reason: 'process lifecycle is shared by the harness' },
    {
        pattern: 'apps/api/src/maintenance.ts',
        reason: 'maintenance operations span every resource',
    },
    { pattern: 'apps/api/src/plugins/**', reason: 'API plugin surface' },
    { pattern: 'apps/web/src/lib/api.ts', reason: 'shared dashboard transport' },
    {
        pattern: 'apps/web/src/lib/dashboard-context.tsx',
        reason: 'workspace context feeds every route',
    },
    { pattern: 'apps/web/src/main.tsx', reason: 'dashboard bootstrap' },
    { pattern: 'apps/web/vite.config.ts', reason: 'dashboard build and dev server' },
    { pattern: 'apps/web/index.html', reason: 'dashboard document shell' },
    { pattern: 'playwright.config.ts', reason: 'E2E harness configuration' },
    { pattern: 'e2e/global-teardown.ts', reason: 'E2E harness teardown' },
    { pattern: 'e2e/**', reason: 'E2E suite files change the matrix itself' },
    { pattern: 'scripts/e2e-*.ts', reason: 'E2E harness resources' },
    { pattern: 'scripts/production-*.ts', reason: 'container acceptance harness' },
    { pattern: 'package.json', reason: 'validation scripts' },
    { pattern: 'turbo.json', reason: 'task graph and cache inputs' },
    { pattern: 'tsconfig.json', reason: 'root TypeScript project references' },
    { pattern: 'bun.lock', reason: 'dependency closure' },
    { pattern: 'bunfig.toml', reason: 'runtime configuration' },
    { pattern: 'Dockerfile', reason: 'production image' },
    { pattern: 'docker-compose*.yml', reason: 'development services' },
    { pattern: '.github/workflows/**', reason: 'continuous integration definition' },
    { pattern: '.husky/**', reason: 'commit gate' },
]

export interface SelectedScenario {
    readonly spec: string
    readonly reasons: readonly string[]
}

export type AffectedResolution =
    | {
          readonly mode: 'targeted'
          readonly scenarios: readonly SelectedScenario[]
          readonly domains: readonly { readonly id: string; readonly paths: readonly string[] }[]
      }
    | {
          readonly mode: 'full'
          readonly reason: string
          readonly scenarios: readonly string[]
      }
    | {
          /**
           * Every changed path is documentation. No scenario is required, and this
           * is deliberately distinct from a targeted selection with zero scenarios,
           * which the resolver refuses to produce.
           */
          readonly mode: 'documentation'
          readonly reason: string
          readonly documentation: readonly string[]
      }

function globToRegExp(pattern: string): RegExp {
    let source = ''
    for (let index = 0; index < pattern.length; index += 1) {
        const character = pattern[index]!
        if (character === '*') {
            if (pattern[index + 1] === '*') {
                source += '.*'
                index += 1
                if (pattern[index + 1] === '/') index += 1
            } else {
                source += '[^/]*'
            }
            continue
        }
        source += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
    return new RegExp(`^${source}$`)
}

export function matchesPattern(path: string, pattern: string): boolean {
    return globToRegExp(pattern).test(path)
}

export function listSpecFiles(e2eDirectory: string): string[] {
    return readdirSync(e2eDirectory)
        .filter(name => name.endsWith('.spec.ts'))
        .sort()
        .map(name => `e2e/${name}`)
}

/**
 * A co-located unit or component test inherits the domains of the module it
 * exercises, because it asserts the same behaviour through the same code.
 */
/**
 * Strips a co-located test suffix. A `.tsx` module keeps its component
 * extension, and both the original and the sibling extension are returned so
 * `project-realtime.test.ts` still resolves to `project-realtime.tsx`.
 */
export function subjectPathsOf(path: string): string[] {
    const match = /^(?<base>.*)\.(?<kind>test|spec)\.(?<extension>ts|tsx)$/.exec(path)
    if (match?.groups === undefined) return [path]
    const { base } = match.groups
    return [`${base}.ts`, `${base}.tsx`]
}

export function domainsForPath(path: string): FunctionalDomain[] {
    const candidates = [path, ...subjectPathsOf(path)]
    return FUNCTIONAL_DOMAINS.filter(domain =>
        domain.patterns.some(pattern =>
            candidates.some(candidate => matchesPattern(candidate, pattern))
        )
    )
}

function isSpecPath(path: string): boolean {
    return path.startsWith('e2e/') && path.endsWith('.spec.ts')
}

/**
 * Extensions that make a file executable source wherever it lives. A `.ts` file
 * under `docs/` is not documentation, it is code in an unusual place, and letting
 * its directory exempt it would turn a typo in a path pattern into a silent
 * exemption for unknown code.
 */
const EXECUTABLE_SOURCE_SUFFIXES = [
    '.ts',
    '.tsx',
    '.mts',
    '.cts',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.sh',
    '.bash',
    '.py',
    '.rb',
] as const

export function isExecutableSourcePath(path: string): boolean {
    return EXECUTABLE_SOURCE_SUFFIXES.some(suffix => path.endsWith(suffix))
}

export function isDocumentationPath(path: string): boolean {
    if (isExecutableSourcePath(path)) return false
    return DOCUMENTATION_PATHS.some(entry => matchesPattern(path, entry.pattern))
}

/**
 * Builds the selector report for a change set.
 *
 * `deleted` lists paths removed by the change. A deleted spec is never
 * selected; a deleted code path still maps to its domain.
 */
export function resolveAffectedScenarios(
    changedPaths: readonly string[],
    knownSpecs: readonly string[],
    deleted: readonly string[] = []
): AffectedResolution {
    const deletedSpecs = new Set(deleted.filter(isSpecPath))
    const survivingSpecs = knownSpecs.filter(spec => !deletedSpecs.has(spec))
    const selectAll = (reason: string): AffectedResolution => ({
        mode: 'full',
        reason,
        scenarios: survivingSpecs,
    })

    const paths = [...new Set(changedPaths)].sort()
    if (paths.length === 0) {
        return selectAll('no changed path was detected, so the full matrix stays selected')
    }

    const documentation = paths.filter(isDocumentationPath)
    if (documentation.length === paths.length) {
        return {
            mode: 'documentation',
            reason: `every changed path is documentation (${documentation.length} file(s)); no scenario observes it`,
            documentation,
        }
    }

    const changedSpecs = paths.filter(isSpecPath)
    const codePaths = paths.filter(path => !isSpecPath(path) && !isDocumentationPath(path))

    for (const path of codePaths) {
        const transversal = TRANSVERSAL_PATHS.find(entry => matchesPattern(path, entry.pattern))
        if (transversal !== undefined) {
            return selectAll(`${path} is transversal (${transversal.reason})`)
        }
    }

    const unmapped = codePaths.filter(path => domainsForPath(path).length === 0)
    if (unmapped.length > 0) {
        return selectAll(`no functional domain covers ${unmapped.join(', ')}`)
    }

    const domainPaths = new Map<string, string[]>()
    for (const path of codePaths) {
        for (const domain of domainsForPath(path)) {
            const bucket = domainPaths.get(domain.id) ?? []
            bucket.push(path)
            domainPaths.set(domain.id, bucket)
        }
    }

    const reasonsBySpec = new Map<string, string[]>()
    const addReason = (spec: string, reason: string): void => {
        const bucket = reasonsBySpec.get(spec) ?? []
        if (!bucket.includes(reason)) bucket.push(reason)
        reasonsBySpec.set(spec, bucket)
    }
    for (const domainId of [...domainPaths.keys()].sort()) {
        const domain = FUNCTIONAL_DOMAINS.find(entry => entry.id === domainId)!
        for (const spec of domain.specs) {
            addReason(spec, `${domainId}: ${domain.label}`)
        }
    }
    for (const spec of changedSpecs) {
        if (survivingSpecs.includes(spec)) addReason(spec, 'scenario file changed')
    }

    const scenarios = [...reasonsBySpec.entries()]
        .map(([spec, reasons]) => ({ spec, reasons }))
        .sort((left, right) => left.spec.localeCompare(right.spec))

    if (scenarios.length === 0) {
        return selectAll('no scenario could be attributed, so the full matrix stays selected')
    }

    return {
        mode: 'targeted',
        scenarios,
        domains: [...domainPaths.entries()]
            .map(([id, pathList]) => ({ id, paths: [...pathList].sort() }))
            .sort((left, right) => left.id.localeCompare(right.id)),
    }
}

export interface ChangedPathSets {
    readonly paths: readonly string[]
    readonly deleted: readonly string[]
}

export type GitRunner = (arguments_: readonly string[]) => string

export const defaultGitRunner: GitRunner = arguments_ => {
    const result = spawnSync('git', [...arguments_], { encoding: 'utf8' })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) {
        throw new Error(`git ${arguments_.join(' ')} failed: ${result.stderr.trim()}`)
    }
    return result.stdout
}

function lines(output: string): string[] {
    return output
        .split('\n')
        .map(line => line.trimEnd())
        .filter(line => line.length > 0)
}

function names(output: string): string[] {
    return lines(output)
        .map(line => line.split('\t').at(-1)!)
        .filter(Boolean)
}

function deletedFromStatus(output: string): string[] {
    return lines(output)
        .filter(line => line.startsWith('D'))
        .map(line => line.split('\t').at(-1)!)
        .filter(Boolean)
}

function deletedFromPorcelain(output: string): string[] {
    return lines(output)
        .filter(line => line.startsWith('D') || line.startsWith(' D') || line.startsWith('DD'))
        .map(line => line.slice(3).trim())
        .filter(Boolean)
}

/**
 * Collects committed, staged, unstaged, and untracked paths so a selector run
 * sees the same working tree the developer is about to validate.
 */
export function collectChangedPaths(
    base: string,
    git: GitRunner = defaultGitRunner
): ChangedPathSets {
    const mergeBase = ((): string => {
        try {
            const result = git(['merge-base', base, 'HEAD']).trim()
            return result.length > 0 ? result : base
        } catch {
            return base
        }
    })()

    const range = `${mergeBase}..HEAD`
    const porcelain = lines(git(['status', '--porcelain']))
    const untracked = porcelain
        .filter(line => line.startsWith('??'))
        .map(line => line.slice(3).trim())
        .filter(Boolean)

    const deleted = [
        ...deletedFromStatus(git(['diff', '--name-status', '--diff-filter=D', range])),
        ...deletedFromStatus(git(['diff', '--name-status', '--diff-filter=D', '--cached'])),
        ...deletedFromStatus(git(['diff', '--name-status', '--diff-filter=D'])),
        ...deletedFromPorcelain(git(['status', '--porcelain'])),
    ]

    const paths = [
        ...names(git(['diff', '--name-only', range])),
        ...names(git(['diff', '--name-only', '--cached'])),
        ...names(git(['diff', '--name-only'])),
        ...names(git(['ls-files', '--others', '--exclude-standard'])),
        ...untracked,
    ]

    return {
        paths: [...new Set(paths)].sort(),
        deleted: [...new Set(deleted)].sort(),
    }
}

interface SelectorArguments {
    readonly base: string
    readonly paths: readonly string[] | undefined
    readonly json: boolean
}

function parseArguments(arguments_: readonly string[]): SelectorArguments {
    let base = 'main'
    let paths: string[] | undefined
    let json = false
    for (let index = 0; index < arguments_.length; index += 1) {
        const argument = arguments_[index]!
        if (argument === '--base') {
            base = arguments_[index + 1] ?? base
            index += 1
        } else if (argument === '--paths') {
            paths = (arguments_[index + 1] ?? '')
                .split(',')
                .map(path => path.trim())
                .filter(Boolean)
            index += 1
        } else if (argument === '--json') {
            json = true
        }
    }
    return { base, paths, json }
}

const MAILPIT_ONLY_SPEC = 'e2e/access-219-password-reset.spec.ts'

function report(
    resolution: AffectedResolution,
    knownSpecCount: number,
    changedPathCount: number
): string {
    if (resolution.mode === 'documentation') {
        return [
            'Selection: no scenario required (documentation only)',
            `Changed paths: ${changedPathCount}, all documentation`,
            `Reason: ${resolution.reason}`,
            'This is a policy classification, not a coverage claim: no browser journey can observe these files.',
            'Static gates still apply: bun run check:quick',
            ...resolution.documentation.map(path => `  ${path}`),
        ].join('\n')
    }
    if (resolution.mode === 'full') {
        return [
            `Selection: full matrix (${resolution.scenarios.length} of ${knownSpecCount} scenario files)`,
            `Changed paths examined: ${changedPathCount}`,
            `Reason: ${resolution.reason}`,
            'Command: bunx playwright test',
        ].join('\n')
    }

    const selectedCount = resolution.scenarios.length
    const lines_: string[] = [
        `Selection: targeted (${selectedCount} of ${knownSpecCount} scenario files, ${changedPathCount} changed paths)`,
    ]
    lines_.push('Functional domains matched by the changed paths:')
    for (const domain of resolution.domains) {
        lines_.push(`  ${domain.id}`)
        for (const path of domain.paths) lines_.push(`    ${path}`)
    }
    lines_.push('Scenarios retained, with the reason each one was retained:')
    for (const scenario of resolution.scenarios) {
        lines_.push(`  ${scenario.spec}`)
        for (const reason of scenario.reasons) lines_.push(`    - ${reason}`)
    }
    if (resolution.scenarios.some(scenario => scenario.spec === MAILPIT_ONLY_SPEC)) {
        lines_.push(
            'Note: the password-reset scenario needs the Mailpit harness; add bun run test:e2e:password-reset.'
        )
    }
    lines_.push(
        `Command: bunx playwright test ${resolution.scenarios.map(scenario => scenario.spec).join(' ')}`
    )
    return lines_.join('\n')
}

if (import.meta.main) {
    const repositoryRoot = resolve(import.meta.dir, '..')
    const arguments_ = parseArguments(Bun.argv.slice(2))
    const collected = collectChangedPaths(arguments_.base)
    const changedPaths = arguments_.paths ?? collected.paths
    const deleted = arguments_.paths === undefined ? collected.deleted : []
    const knownSpecs = listSpecFiles(join(repositoryRoot, 'e2e'))
    const resolution = resolveAffectedScenarios(changedPaths, knownSpecs, deleted)

    if (arguments_.json) {
        // Built per mode so each branch is typed by its own variant, and so the
        // scenario list is never emptied: a full selection reports the whole
        // matrix, a targeted one reports its retained scenarios with reasons, and
        // only the documentation mode carries an empty list.
        const payload =
            resolution.mode === 'full'
                ? {
                      base: arguments_.base,
                      mode: resolution.mode,
                      changedPaths,
                      deleted,
                      scenarios: resolution.scenarios,
                      reason: resolution.reason,
                  }
                : resolution.mode === 'documentation'
                  ? {
                        base: arguments_.base,
                        mode: resolution.mode,
                        changedPaths,
                        deleted,
                        scenarios: [] as string[],
                        documentation: resolution.documentation,
                        reason: resolution.reason,
                    }
                  : {
                        base: arguments_.base,
                        mode: resolution.mode,
                        changedPaths,
                        deleted,
                        scenarios: resolution.scenarios,
                        domains: resolution.domains,
                    }
        console.log(JSON.stringify(payload, null, 2))
    } else {
        console.log(report(resolution, knownSpecs.length, changedPaths.length))
    }
}
