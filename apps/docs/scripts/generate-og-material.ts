import { mkdir, writeFile } from 'node:fs/promises'
import { crc32, deflateSync } from 'node:zlib'

// Freeze the public site's flowing pigment at a fixed time, with pixel-sized grain.
// PNG encoding uses the runtime's zlib; no browser or external asset is needed.
const width = 1200
const height = 630
const pixels = Buffer.alloc((width * 3 + 1) * height)
const smooth = (a: number, b: number, v: number) => {
    const t = Math.max(0, Math.min(1, (v - a) / (b - a)))
    return t * t * (3 - 2 * t)
}
const mix = (a: number, b: number, t: number) => a + (b - a) * t
let seed = 472
for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
        const u = (x / width) * 2.2
        const v = 1 - y / height
        const flow = v + 0.19 * Math.sin(u * 2 + 1.35) + 0.09 * Math.sin(u * 4.2 - 0.99)
        const ribbon = smooth(0.05, 0.95, 0.5 + 0.5 * Math.sin(flow * 9 + 0.81))
        const pigment = smooth(0.58, 1.04, x / width)
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        const grain = ((seed / 0x100000000) * 2 - 1) * 1.8 * pigment
        for (let c = 0; c < 3; c++) {
            const deep = [0.025, 0.085, 0.24][c]!
            const blue = [0.1, 0.3, 0.78][c]!
            const pale = [0.67, 0.82, 0.98][c]!
            const color = mix(
                mix(deep, blue, smooth(0, 0.55, ribbon)),
                pale,
                smooth(0.58, 1, ribbon)
            )
            pixels[y * (width * 3 + 1) + 1 + x * 3 + c] = Math.round(
                mix(244, color * 255, pigment) + grain
            )
        }
    }
}
function chunk(type: string, data: Buffer) {
    const tag = Buffer.from(type)
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const checksum = Buffer.alloc(4)
    checksum.writeUInt32BE(crc32(Buffer.concat([tag, data])))
    return Buffer.concat([length, tag, data, checksum])
}
const header = Buffer.alloc(13)
header.writeUInt32BE(width)
header.writeUInt32BE(height, 4)
header[8] = 8
header[9] = 2
const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
])
const directory = new URL('../.og/', import.meta.url)
await mkdir(directory, { recursive: true })
await writeFile(new URL('material.png', directory), png)
