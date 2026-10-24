export {}

/** Verify the distribution material inside the actual candidate image. */
const source = Bun.file('/app/licenses/sources/ffmpeg-9.0.2.tar.xz')
const expected = '8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e'
const actual = new Bun.CryptoHasher('sha256').update(await source.arrayBuffer()).digest('hex')
if (actual !== expected) throw new Error('Packaged FFmpeg source differs from the compiled archive')
for (const path of [
    '/app/LICENSE',
    '/app/THIRD_PARTY_NOTICES.md',
    '/app/licenses/FFmpeg.LICENSE',
    '/app/licenses/FFmpeg-build.txt',
    '/app/licenses/FFmpeg-config.h',
    '/app/licenses/FFmpeg-config.mak',
    '/app/licenses/base-packages.tsv',
    '/app/licenses/base-os-release',
]) {
    const file = Bun.file(path)
    if (!(await file.exists()) || file.size === 0)
        throw new Error(`Missing distribution material: ${path}`)
}
console.log('Exact FFmpeg source, build configuration, notices and base inventory are packaged.')
