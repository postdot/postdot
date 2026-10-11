// cspell:ignore IDAT
import { deflateSync } from 'node:zlib'

// Complete decodable PNG with distinctive pixel content, not an inspection-only header.
export function previewFixturePng(width = 1024, height = 600): Uint8Array {
    function chunk(name: string, data: Uint8Array) {
        const type = Buffer.from(name)
        const body = Buffer.concat([type, data])
        let crc = 0xffffffff
        for (const byte of body) {
            crc ^= byte
            for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
        }
        const size = Buffer.alloc(4)
        size.writeUInt32BE(data.length)
        const checksum = Buffer.alloc(4)
        checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
        return Buffer.concat([size, body, checksum])
    }
    const header = Buffer.alloc(13)
    header.writeUInt32BE(width, 0)
    header.writeUInt32BE(height, 4)
    header[8] = 8
    header[9] = 2
    const pixels = Buffer.alloc((width * 3 + 1) * height)
    let seed = 19
    for (let y = 0; y < height; y++) {
        for (let x = 1; x <= width * 3; x++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
            pixels[y * (width * 3 + 1) + x] = seed >>> 24
        }
    }
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(pixels)),
        chunk('IEND', Buffer.alloc(0)),
    ])
}
