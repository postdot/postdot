const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')

const identities = new Map([
    [resolve(__dirname, '../cli'), '@postdot/cli'],
    [resolve(__dirname, '../n8n'), '@postdot/n8n-nodes-postdot'],
])
function verifyIdentity(environment = process.env) {
    if (
        environment.GITHUB_ACTIONS !== 'true' ||
        environment.GITHUB_REPOSITORY !== 'postdot/postdot' ||
        environment.GITHUB_REF !== 'refs/heads/main' ||
        environment.GITHUB_WORKFLOW_REF !==
            'postdot/postdot/.github/workflows/n8n-publish.yml@refs/heads/main' ||
        !environment.ACTIONS_ID_TOKEN_REQUEST_URL ||
        !environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN
    )
        throw new Error('Publish only through postdot/postdot n8n-publish.yml on main')
}
function verifyMetadata(directory) {
    const pkg = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'))
    if (
        pkg.name !== identities.get(resolve(directory)) ||
        pkg.private ||
        pkg.publishConfig?.access !== 'public' ||
        pkg.publishConfig.registry !== 'https://registry.npmjs.org' ||
        !pkg.publishConfig.provenance
    )
        throw new Error('Unexpected package identity, visibility, registry or provenance')
    if (!/^\d+\.\d+\.\d+-alpha\.\d+$/.test(pkg.version) || pkg.publishConfig.tag !== 'alpha')
        throw new Error('Only explicitly versioned alpha packages may be released')
    return pkg
}
function verifyPackage(directory, environment = process.env) {
    verifyIdentity(environment)
    const pkg = verifyMetadata(directory)
    if (!['release', 'bootstrap-cli'].includes(environment.POSTDOT_NPM_RELEASE_MODE ?? 'release'))
        throw new Error('Unknown release mode')
    if (environment.POSTDOT_NPM_RELEASE_MODE === 'bootstrap-cli') {
        if (
            pkg.name !== '@postdot/cli' ||
            environment.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
            !environment.NODE_AUTH_TOKEN
        )
            throw new Error(
                'Initial staging requires an explicit CLI-only dispatch and temporary credential'
            )
    } else if (
        environment.NODE_AUTH_TOKEN ||
        environment.NPM_TOKEN ||
        environment.CLI_NPM_STAGE_TOKEN
    ) {
        throw new Error('Routine releases use OIDC only; token fallback is forbidden')
    }
    return pkg
}
module.exports = { verifyIdentity, verifyPackage, verifyMetadata }
