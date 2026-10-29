import { config } from '@n8n/node-cli/eslint'

export default [
    ...config,
    {
        files: ['package.json'],
        rules: {
            // Retain Postdot's AGPL license rather than the starter's MIT default.
            'n8n-nodes-base/community-package-json-license-not-default': 'off',
            // Identify the author by name and public URL without publishing a personal email.
            '@n8n/community-nodes/valid-author': 'off',
        },
    },
]
