/**
 * Writes an AVIF next to every product WebP in `public/product`. The page
 * serves the AVIF to browsers that read it and keeps the WebP as the fallback.
 * Quality 75 with full chroma keeps interface text sharp (PSNR above 49 dB
 * against the WebP); rerun after replacing a screenshot. Needs `avifenc` and
 * ImageMagick.
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { appRoot } from './docs-paths'

const directory = join(appRoot, 'public/product')
for (const file of (await readdir(directory)).filter(name => name.endsWith('.webp'))) {
    const png = `/tmp/${file}.png`
    const avif = join(directory, file.replace(/\.webp$/, '.avif'))
    await Bun.$`magick ${join(directory, file)} ${png}`
    await Bun.$`avifenc -q 75 -s 4 -y 444 ${png} ${avif}`.quiet()
    console.log(`${file} -> ${avif.split('/').pop()}`)
}
