const { readFileSync } = require('node:fs')
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.GITHUB_REPOSITORY !== 'postdot/postdot' ||
    process.env.GITHUB_REF !== `refs/tags/n8n-v${pkg.version}`
) {
    throw new Error(
        'Publish only through postdot/postdot n8n-publish.yml at its matching n8n-v version tag'
    )
}
if (pkg.name !== '@postdot/n8n-nodes-postdot' || pkg.publishConfig.access !== 'public') {
    throw new Error('Unexpected package name or visibility')
}
if (pkg.publishConfig.tag !== (pkg.version.includes('-') ? 'alpha' : 'latest')) {
    throw new Error('The npm distribution tag does not match the release maturity')
}
