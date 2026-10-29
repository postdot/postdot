const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'))

if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.GITHUB_REPOSITORY !== 'postdot/postdot' ||
    process.env.GITHUB_REF !== 'refs/heads/main' ||
    process.env.GITHUB_WORKFLOW_REF !==
        'postdot/postdot/.github/workflows/n8n-publish.yml@refs/heads/main' ||
    !process.env.ACTIONS_ID_TOKEN_REQUEST_URL ||
    !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
) {
    throw new Error(
        'Publish only through postdot/postdot n8n-publish.yml on main using GitHub OIDC'
    )
}
if (pkg.name !== '@postdot/n8n-nodes-postdot' || pkg.publishConfig.access !== 'public') {
    throw new Error('Unexpected package name or visibility')
}
if (pkg.publishConfig.tag !== (pkg.version.includes('-') ? 'alpha' : 'latest')) {
    throw new Error('The npm distribution tag does not match the release maturity')
}
if (!pkg.publishConfig.provenance) {
    throw new Error('Release provenance must be enabled')
}
