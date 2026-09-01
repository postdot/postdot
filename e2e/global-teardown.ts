import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import type { FullConfig } from '@playwright/test'

export default async function globalTeardown(_config: FullConfig) {
    const directory = join(tmpdir(), 'herald-e2e-data')
    if (dirname(directory) !== tmpdir() || basename(directory) !== 'herald-e2e-data') return

    await rm(directory, { recursive: true, force: true })
}
