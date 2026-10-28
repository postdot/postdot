/**
 * Route registry for the web experience standard (SPEC-010).
 *
 * Each authenticated destination declares the scope it acts on, the shell that
 * frames it, the width class its content is expected to follow and its single
 * operator job. The experience audit measures the rendered application against
 * these declarations; a mismatch is a finding that cites the matching rule.
 *
 * Width classes follow the decisions recorded in SPEC-010 (2026-10-28). Pages that still render a
 * different width than declared are baseline findings (UX-392), not registry errors.
 */

export type ExperienceScope = 'project' | 'workspace' | 'personal' | 'installation'

/** `product` keeps the project navigation; `settings` replaces it with the configuration navigation. */
export type ExperienceShell = 'product' | 'settings'

/**
 * Width follows the page's job (SPEC-010 LAY-02). `work-surface` uses the available width,
 * `management-column` is a bounded 64 rem column for lists of peer objects and their actions, and
 * `reading-column` is a compact 36 rem column for forms and preferences.
 */
export type ExperienceWidthClass = 'work-surface' | 'management-column' | 'reading-column'

export type ExperienceRoute = {
    readonly id: string
    readonly path: (context: ExperienceContext) => string
    readonly scope: ExperienceScope
    readonly shell: ExperienceShell
    readonly widthClass: ExperienceWidthClass
    readonly job: string
}

export type ExperienceContext = {
    readonly projectId: string
    readonly workspaceId: string
}

export const experienceRoutes: readonly ExperienceRoute[] = [
    {
        id: 'projects-directory',
        path: ({ workspaceId }) => `/dashboard?projectId=none&workspaceId=${workspaceId}`,
        scope: 'workspace',
        shell: 'product',
        widthClass: 'management-column',
        job: 'Choose or create a project',
    },
    {
        id: 'overview',
        path: ({ projectId }) => `/dashboard/projects/${projectId}/overview`,
        scope: 'project',
        shell: 'product',
        widthClass: 'work-surface',
        job: 'Scan publication timing',
    },
    {
        id: 'new-publication',
        path: ({ projectId }) => `/dashboard/projects/${projectId}/publications/new`,
        scope: 'project',
        shell: 'product',
        widthClass: 'work-surface',
        job: 'Compose one source fan-out',
    },
    {
        id: 'queue',
        path: ({ projectId }) => `/dashboard/projects/${projectId}/queue`,
        scope: 'project',
        shell: 'product',
        widthClass: 'work-surface',
        job: 'Prioritize lifecycle and human-action work',
    },
    {
        id: 'project-channels',
        path: ({ projectId }) => `/dashboard/projects/${projectId}/channels`,
        scope: 'project',
        shell: 'product',
        widthClass: 'management-column',
        job: 'Manage destination identity and connection readiness',
    },
    {
        id: 'media',
        path: ({ projectId }) => `/dashboard/projects/${projectId}/media`,
        scope: 'project',
        shell: 'product',
        widthClass: 'work-surface',
        job: 'Manage reusable verified assets',
    },
    {
        id: 'performance',
        path: ({ projectId }) => `/dashboard/projects/${projectId}/performance`,
        scope: 'project',
        shell: 'product',
        widthClass: 'work-surface',
        job: 'Read publication performance',
    },
    {
        id: 'project-tags',
        path: ({ projectId }) => `/dashboard/projects/${projectId}/tags`,
        scope: 'project',
        shell: 'settings',
        widthClass: 'management-column',
        job: 'Maintain project tags',
    },
    {
        id: 'project-access',
        path: ({ projectId }) => `/dashboard/projects/${projectId}/access`,
        scope: 'project',
        shell: 'settings',
        widthClass: 'management-column',
        job: 'Manage project membership',
    },
    {
        id: 'workspace-channels',
        path: ({ workspaceId }) => `/dashboard/workspace/channels?workspaceId=${workspaceId}`,
        scope: 'workspace',
        shell: 'product',
        widthClass: 'management-column',
        job: 'Manage shared channels and their project use',
    },
    {
        id: 'workspace-administration',
        path: ({ workspaceId }) => `/dashboard/settings/workspace?workspaceId=${workspaceId}`,
        scope: 'workspace',
        shell: 'settings',
        widthClass: 'reading-column',
        job: 'Manage workspace members and groups',
    },
    {
        id: 'personal-general',
        path: () => '/dashboard/preferences',
        scope: 'personal',
        shell: 'settings',
        widthClass: 'reading-column',
        job: 'Set personal preferences',
    },
    {
        id: 'personal-account',
        path: () => '/dashboard/preferences/account',
        scope: 'personal',
        shell: 'settings',
        widthClass: 'reading-column',
        job: 'Maintain the personal profile and security',
    },
    {
        id: 'personal-api-keys',
        path: () => '/dashboard/preferences/api-keys',
        scope: 'personal',
        shell: 'settings',
        widthClass: 'reading-column',
        job: 'Manage personal API keys',
    },
    {
        id: 'installation-email',
        path: () => '/dashboard/settings',
        scope: 'installation',
        shell: 'settings',
        widthClass: 'reading-column',
        job: 'Configure installation email delivery',
    },
    {
        id: 'installation-access',
        path: () => '/dashboard/settings/access',
        scope: 'installation',
        shell: 'settings',
        widthClass: 'reading-column',
        job: 'Manage installation members and invitations',
    },
    {
        id: 'installation-provider-applications',
        path: () => '/dashboard/settings/provider-applications',
        scope: 'installation',
        shell: 'settings',
        widthClass: 'reading-column',
        job: 'Configure provider OAuth applications',
    },
]
