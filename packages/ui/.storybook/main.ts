import { fileURLToPath } from 'node:url'

import type { StorybookConfig } from '@storybook/react-vite'
import { mergeConfig } from 'vite'

const webSource = fileURLToPath(new URL('../../../apps/web/src', import.meta.url))

const config: StorybookConfig = {
    stories: [
        '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)',
        '../../../apps/web/src/stories/**/*.stories.@(js|jsx|mjs|ts|tsx)',
    ],
    addons: ['@storybook/addon-docs', '@storybook/addon-themes'],
    framework: {
        name: '@storybook/react-vite',
        options: {},
    },
    viteFinal: config =>
        mergeConfig(config, {
            resolve: {
                alias: {
                    '@': webSource,
                },
            },
        }),
}

export default config
