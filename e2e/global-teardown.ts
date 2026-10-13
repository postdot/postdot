import { rm } from 'node:fs/promises'

import type { FullConfig } from '@playwright/test'

import { isSafeE2EDataDirectory } from '../scripts/e2e-runtime'

export default async function globalTeardown(config: FullConfig) {
    const metadata = config.metadata as Record<string, unknown> | undefined
    const metadataDirectory = metadata?.postbotE2eDataDirectory
    const directory =
        typeof metadataDirectory === 'string'
            ? metadataDirectory
            : process.env.POSTBOT_E2E_DATA_DIRECTORY

    if (!isSafeE2EDataDirectory(directory)) return

    await rm(directory, { recursive: true, force: true })
}
