/** Public, dated comparison facts. Narrative remains in the alternatives MDX collection. */
export const comparisonGroups = [
    {
        title: 'Planning and collaboration',
        keys: ['organization', 'sharing', 'manual', 'people', 'review'],
    },
    {
        title: 'Connections and automation',
        keys: ['networks', 'languages', 'agents', 'n8n', 'insights'],
    },
    { title: 'Ownership and operation', keys: ['model', 'hosting'] },
] as const

export const comparisonDimensions = {
    organization: 'Projects and workspaces',
    sharing: 'Sharing a destination',
    manual: 'Manual destinations',
    people: 'Users and permissions',
    review: 'Review and approval',
    networks: 'Networks and formats',
    languages: 'Interface languages',
    agents: 'Agents and API',
    n8n: 'n8n integration',
    insights: 'Analytics and engagement',
    model: 'Software and commercial model',
    hosting: 'Deployment',
} as const

export type ComparisonKey = keyof typeof comparisonDimensions
export interface ComparisonValue {
    text: string
    source: string
    unverified?: boolean
}
const value = (text: string, source: string, unverified = false): ComparisonValue => ({
    text,
    source,
    unverified,
})

export const postdotComparison: Record<ComparisonKey, ComparisonValue> = {
    organization: value(
        'Workspaces containing projects, groups and project-scoped access.',
        '/docs/application-privacy/'
    ),
    sharing: value(
        'One channel and connection reused across projects, with shared cadence and occupied times.',
        '/docs/shared-channels/'
    ),
    manual: value(
        'Prepare, schedule and record publications you deliver yourself.',
        '/features/manual-publishing/'
    ),
    people: value(
        'Workspace owner, admin or member; project owner, editor or viewer; groups and invitations.',
        '/docs/application-privacy/'
    ),
    review: value(
        'Draft review in Studio, explicit scheduling and permission-controlled publishing.',
        '/docs/automation/#create-a-draft-for-review'
    ),
    networks: value(
        'Bluesky, Mastodon, DEV.to, Discord, X, LinkedIn, Telegram, Facebook and Instagram; formats vary by provider.',
        '/docs/providers/provider-capabilities/'
    ),
    languages: value('English, French, Spanish and German in Studio.', '/docs/releases/'),
    agents: value('CLI, HTTP API, MCP and installable agent skills.', '/docs/automation/'),
    n8n: value(
        'Community node for self-hosted n8n: list projects/channels, create text drafts and read publications.',
        '/docs/n8n/'
    ),
    insights: value(
        'Saved provider observations for Bluesky, Mastodon and DEV.to; Bluesky/Mastodon conversations.',
        '/docs/providers/provider-capabilities/'
    ),
    model: value(
        'AGPL-3.0-only application, with no paid feature edition or per-seat license.',
        'https://github.com/postdot/postdot'
    ),
    hosting: value(
        'One application service. SQLite or PostgreSQL; local or S3-compatible media, chosen independently.',
        '/docs/installation/'
    ),
}

interface Alternative {
    slug: string
    name: string
    angle: string
    summary: string
    postdotFit: string[]
    otherFit: string[]
    columns: string[]
    values: Record<ComparisonKey, ComparisonValue[]>
}
const pz = 'https://docs.postiz.com'
const mx = 'https://mixpost.app'
const pf = 'https://postfa.st'

export const alternatives: Alternative[] = [
    {
        slug: 'postiz',
        name: 'Postiz',
        angle: 'Plan separate projects around the same destinations',
        summary:
            'Compare project access, channel reuse, manual publishing, reporting and automation across two open-source schedulers.',
        postdotFit: [
            'Reuse one destination across several projects without duplicating its connection.',
            'Plan manual submissions alongside automated publications.',
            'Give collaborators scoped access and use Studio in English, French, Spanish or German.',
        ],
        otherFit: [
            'Publish to a wider network catalog, including YouTube, TikTok and Pinterest.',
            'Use client preview links and broader account-level analytics.',
            'Choose a managed Cloud service instead of operating an instance.',
        ],
        columns: ['Postiz'],
        values: {
            organization: [
                value(
                    'Organizations with channels organized into customer groups.',
                    `${pz}/general/channels/customers`
                ),
            ],
            sharing: [
                value(
                    'Each channel belongs to at most one customer group.',
                    `${pz}/general/channels/customers`
                ),
            ],
            manual: [value('Not confirmed.', `${pz}/general/concepts`, true)],
            people: [
                value(
                    'User, Admin and Super Admin roles. Self-hosted installs include team members.',
                    `${pz}/general/settings/team`
                ),
            ],
            review: [
                value(
                    'Public preview links with comments. Scheduling remains a separate action; approval is not a blocking state.',
                    `${pz}/general/approvals`
                ),
            ],
            networks: [
                value(
                    'Documents 34 destinations, including video, social networks, communities and publishing platforms.',
                    `${pz}/general/platforms/overview`
                ),
            ],
            languages: [
                value(
                    'English, French, Spanish, German and additional languages in the active locale configuration.',
                    'https://github.com/gitroomhq/postiz-app/blob/main/libraries/react-shared-libraries/src/translation/i18n.config.ts'
                ),
            ],
            agents: [
                value('CLI, REST API and MCP, with agent setup guides.', `${pz}/mcp/introduction`),
            ],
            n8n: [
                value(
                    'Community node for scheduling posts from n8n workflows.',
                    'https://postiz.com/blog/use-postiz-with-n-8-n'
                ),
            ],
            insights: [
                value(
                    'Account-level and per-post analytics for supported networks and account types.',
                    `${pz}/general/analytics`
                ),
            ],
            model: [
                value(
                    'AGPL self-hosted application and paid Cloud plans.',
                    'https://github.com/gitroomhq/postiz-app'
                ),
            ],
            hosting: [
                value(
                    'Self-hosting uses PostgreSQL, Redis and Temporal; Cloud is also available.',
                    `${pz}/self-host/installation/system-requirements`
                ),
            ],
        },
    },
    {
        slug: 'mixpost',
        name: 'Mixpost',
        angle: 'Workspaces, languages and integrations in the free application',
        summary:
            'See which capabilities belong to Mixpost Lite, which require Pro, and how Postdot handles teams, providers and integrations.',
        postdotFit: [
            'Use all nine documented provider connections in the same free application.',
            'Keep projects, shared destinations and manual channels together.',
            'Use four Studio languages and CLI/API/MCP access without buying a feature edition.',
        ],
        otherFit: [
            'Use Pro’s approval workflows, engagement inbox and advanced reporting.',
            'Work with its broader paid provider and interface-language catalog.',
            'Choose its commercial support, Cloud service or Enterprise SaaS features.',
        ],
        columns: ['Mixpost Lite', 'Mixpost Pro'],
        values: {
            organization: [
                value('Essential scheduling and media-management feature set.', `${mx}/pricing`),
                value('Multi-tenant workspaces for clients and brands.', `${mx}/features`),
            ],
            sharing: [
                value('Not confirmed.', `${mx}/pricing`, true),
                value(
                    'Isolated workspaces; cross-project channel reuse not confirmed.',
                    `${mx}/features`,
                    true
                ),
            ],
            manual: [
                value('Not confirmed.', `${mx}/pricing`, true),
                value('Not confirmed.', `${mx}/features`, true),
            ],
            people: [
                value('The pricing page positions team collaboration in Pro.', `${mx}/pricing`),
                value('Workspace users, roles and approval permissions.', `${mx}/features`),
            ],
            review: [
                value('Approval flow is listed in Pro.', `${mx}/pricing`),
                value(
                    'Approval workflows with review comments and activity history.',
                    `${mx}/features`
                ),
            ],
            networks: [
                value('Facebook Pages, X and Mastodon.', `${mx}/pricing`),
                value(
                    'Broader catalog including Instagram, LinkedIn, YouTube, TikTok and Pinterest.',
                    `${mx}/pricing`
                ),
            ],
            languages: [
                value('Multilingual UI is listed in Pro.', `${mx}/pricing`),
                value(
                    'Multiple interface languages, including English, French, Spanish and German; per-user preference.',
                    `${mx}/features`
                ),
            ],
            agents: [
                value('The agent guide explicitly excludes Lite agent access.', `${mx}/agents`),
                value('MCP, CLI and REST API included in self-hosted Pro.', `${mx}/agents`),
            ],
            n8n: [
                value('Not confirmed.', 'https://docs.mixpost.app/api/', true),
                value(
                    'API documentation includes an n8n community node.',
                    'https://docs.mixpost.app/api/'
                ),
            ],
            insights: [
                value('Basic analytics.', `${mx}/pricing`),
                value('Advanced analytics and engagement inbox.', `${mx}/pricing`),
            ],
            model: [
                value(
                    'Free MIT-licensed public Lite repository.',
                    'https://github.com/inovector/mixpost'
                ),
                value(
                    'Commercial one-time license; one year of updates and perpetual use of the purchased version.',
                    `${mx}/pricing`
                ),
            ],
            hosting: [
                value(
                    'Self-hosted: Docker, PHP installation or existing Laravel application.',
                    'https://docs.mixpost.app/lite/'
                ),
                value(
                    'Self-hosted commercial application; a separate Cloud offering is available.',
                    `${mx}/cloud`
                ),
            ],
        },
    },
    {
        slug: 'postfast',
        name: 'PostFast',
        angle: 'Your own publishing workspace or a managed service',
        summary:
            'Compare project organization, team approvals, agent access, n8n and account limits with the hosted product at postfa.st.',
        postdotFit: [
            'Operate the application and choose how you store its data and media.',
            'Reuse channels across projects and include manual destinations in the plan.',
            'Manage workspaces, people and project roles without software seat or account tiers.',
        ],
        otherFit: [
            'Start with a managed service and preconfigured platform connections.',
            'Require an Approved state before publishing, with adjustable team permissions.',
            'Use a verified n8n node with posting, media and analytics operations.',
        ],
        columns: ['PostFast'],
        values: {
            organization: [
                value(
                    'Isolated workspaces for accounts, calendars, content and members.',
                    `${pf}/features/post-approvals`
                ),
            ],
            sharing: [
                value(
                    'Each workspace has its own accounts and content.',
                    `${pf}/features/post-approvals`,
                    true
                ),
            ],
            manual: [value('Not confirmed.', `${pf}/features/scheduling`, true)],
            people: [
                value(
                    'Admin, Editor and Client roles with per-user permissions; invited reviewers count toward workspace limits.',
                    `${pf}/features/post-approvals`
                ),
            ],
            review: [
                value(
                    'Only Approved posts publish. The gate applies to posts created by people or integrations.',
                    `${pf}/features/post-approvals`
                ),
            ],
            networks: [
                value(
                    'Advertises 11 networks, including YouTube, TikTok, Pinterest, Threads and Google Business Profile.',
                    `${pf}/integration`
                ),
            ],
            languages: [value('Not confirmed.', `${pf}/`, true)],
            agents: [
                value(
                    'REST API, MCP and hosted AI-client connectors.',
                    `${pf}/api-integrations/mcp`
                ),
            ],
            n8n: [
                value(
                    'Verified node for n8n Cloud and self-hosted n8n, including posts, analytics and upload URLs.',
                    `${pf}/api-integrations/n8n`
                ),
            ],
            insights: [
                value(
                    'Analytics and Social Inbox; scope depends on plan and platform.',
                    `${pf}/pricing`
                ),
            ],
            model: [
                value(
                    'Hosted subscription plans with account, workspace, user and queue allowances.',
                    `${pf}/pricing`
                ),
            ],
            hosting: [
                value(
                    'Managed PostFast service; the operator does not deploy the publishing application.',
                    `${pf}/`
                ),
            ],
        },
    },
]

export function getAlternative(slug: string) {
    return alternatives.find(item => item.slug === slug)
}

/** Text exports use the same facts as the visible comparison table. */
export function comparisonMarkdown(slug: string) {
    const item = getAlternative(slug)
    if (!item) throw new Error(`Unknown alternative: ${slug}`)
    const escape = (text: string) => text.replaceAll('|', '\\|').replaceAll('\n', ' ')
    const lines = [
        '## Which tool fits your workflow?',
        '',
        '### Choose Postdot for',
        ...item.postdotFit.map(text => `- ${text}`),
        '',
        `### Choose ${item.name} for`,
        ...item.otherFit.map(text => `- ${text}`),
        '',
        '## Compare the workflows',
        '',
        `| Capability | Postdot | ${item.columns.join(' | ')} |`,
        `| ${Array(item.columns.length + 2)
            .fill('---')
            .join(' | ')} |`,
    ]
    for (const group of comparisonGroups) {
        for (const key of group.keys) {
            const cells = [postdotComparison[key], ...item.values[key]]
            lines.push(
                `| ${comparisonDimensions[key]} | ${cells.map(cell => `${escape(cell.text)} [Source](${cell.source})`).join(' | ')} |`
            )
        }
    }
    return lines.join('\n')
}
