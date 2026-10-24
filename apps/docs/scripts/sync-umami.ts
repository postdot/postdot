/**
 * Copies the Umami scripts to `public/` so the browser loads them from the
 * site's own origin and the site needs no runtime proxy: `script.js` becomes
 * `/s.js` (anonymous audience), `loader.js` becomes `/p.js` and `recorder.js`
 * becomes `/r.js` (session replay and heatmaps, after consent).
 * They are build artifacts and are not committed.
 *
 * Without `POSTBOT_UMAMI_URL` nothing is copied and the site ships without
 * analytics.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { appRoot } from './docs-paths'

const umamiUrl = process.env.POSTBOT_UMAMI_URL ?? ''
if (!umamiUrl) {
    console.log('Umami is not configured (POSTBOT_UMAMI_URL); skipping /p.js and /r.js.')
    process.exit(0)
}

await mkdir(join(appRoot, 'public'), { recursive: true })
for (const { remote, local } of [
    { remote: '/script.js', local: 's.js' },
    { remote: '/loader.js', local: 'p.js' },
    { remote: '/recorder.js', local: 'r.js' },
]) {
    const response = await fetch(new URL(remote, umamiUrl), { redirect: 'error' })
    const body = await response.text()
    if (!response.ok || body.includes('<html')) {
        throw new Error(`Umami did not return ${remote} (${response.status})`)
    }
    await writeFile(join(appRoot, 'public', local), body)
    console.log(`Copied the Umami script to public/${local}.`)
}
