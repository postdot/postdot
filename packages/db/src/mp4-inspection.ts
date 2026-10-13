// cspell:words isom trak ftyp moov mdat moof stsz mdia minf stbl edts dinf udta mvex
import type { MediaInspection, MediaInspectionLimits } from '@postbot/core'
import { createFile, type MP4BoxBuffer } from 'mp4box'

/** Feed metadata only: neither video payloads nor an entire file are buffered. */
export function createMp4Inspection(size: number, limits: MediaInspectionLimits) {
    const parser = createFile(false)
    let result: MediaInspection | null = null
    let invalid = false
    let offset = 0
    let remaining = 0
    let boxStart = 0
    let header = new Uint8Array(0)
    let collected: Uint8Array | null = null
    let collectedSize = 0
    let metadataBytes = 0
    let parserOffset = 0
    let boxes = 0
    let hasFileType = false
    let hasMediaData = false
    let hasMovie = false

    parser.onError = () => {
        invalid = true
    }
    parser.onReady = info => {
        const track = info.videoTracks[0]
        const durationMs = Math.round((info.duration / info.timescale) * 1000)
        if (
            !info.brands.some(brand => /^(isom|iso[2-9]|mp4[12]|avc1)$/.test(brand)) ||
            info.isFragmented ||
            info.videoTracks.length !== 1 ||
            !track ||
            !track.video ||
            info.tracks.length > 2 ||
            !/^avc[13]\./.test(track.codec) ||
            info.audioTracks.some(audio => !/^mp4a\.40\.2$/.test(audio.codec)) ||
            !Number.isFinite(durationMs) ||
            durationMs <= 0 ||
            track.video.width <= 0 ||
            track.video.height <= 0 ||
            track.video.width * track.video.height > limits.maxPixels
        ) {
            invalid = true
            return
        }
        result = {
            family: 'video',
            format: 'mp4',
            contentType: 'video/mp4',
            width: track.video.width,
            height: track.video.height,
            durationMs,
            pageCount: null,
            isAnimated: null,
        }
    }

    function feed(bytes: Uint8Array) {
        const buffer = bytes.slice().buffer as MP4BoxBuffer
        buffer.fileStart = parserOffset
        parserOffset += bytes.length
        parser.appendBuffer(buffer)
    }

    return {
        push(bytes: Uint8Array) {
            if (invalid) return
            let cursor = 0
            try {
                while (cursor < bytes.length) {
                    if (remaining > 0) {
                        const amount = Math.min(remaining, bytes.length - cursor)
                        if (collected) {
                            collected.set(bytes.subarray(cursor, cursor + amount), collectedSize)
                            collectedSize += amount
                        }
                        cursor += amount
                        offset += amount
                        remaining -= amount
                        if (remaining === 0 && collected) {
                            if (ascii(collected, 4) === 'moov') preflightMovie(collected)
                            feed(collected)
                            collected = null
                        }
                        continue
                    }
                    const needed = header.length < 8 ? 8 : read32(header, 0) === 1 ? 16 : 8
                    const amount = Math.min(needed - header.length, bytes.length - cursor)
                    const next = new Uint8Array(header.length + amount)
                    next.set(header)
                    next.set(bytes.subarray(cursor, cursor + amount), header.length)
                    header = next
                    cursor += amount
                    offset += amount
                    if (header.length < needed || (header.length === 8 && read32(header, 0) === 1))
                        continue
                    boxStart = offset - header.length
                    const declared = read32(header, 0)
                    const length =
                        declared === 1
                            ? Number(new DataView(header.buffer).getBigUint64(8))
                            : declared === 0
                              ? size - boxStart
                              : declared
                    if (
                        !Number.isSafeInteger(length) ||
                        length < header.length ||
                        length > size - boxStart ||
                        ++boxes > 4096
                    )
                        throw new Error('Invalid MP4 box')
                    const type = ascii(header, 4)
                    if (!hasFileType && (boxStart !== 0 || type !== 'ftyp'))
                        throw new Error('Missing MP4 file type')
                    if (type === 'moof' || type === 'uuid')
                        throw new Error('Unsupported MP4 layout')
                    if (type === 'ftyp' || type === 'moov') {
                        if (type === 'ftyp') {
                            if (hasFileType) throw new Error('Repeated MP4 file type')
                            hasFileType = true
                        } else {
                            if (hasMovie) throw new Error('Repeated MP4 movie')
                            hasMovie = true
                        }
                        metadataBytes += length
                        if (metadataBytes > limits.maxHeaderBytes)
                            throw new Error('MP4 metadata too large')
                        collected = new Uint8Array(length)
                        collected.set(header)
                        collectedSize = header.length
                    } else if (type === 'mdat') {
                        hasMediaData ||= length > header.length
                    }
                    remaining = length - header.length
                    header = new Uint8Array(0)
                    if (remaining === 0 && collected) {
                        feed(collected)
                        collected = null
                    }
                }
            } catch {
                invalid = true
                collected = null
            }
        },
        finish(): MediaInspection | null {
            if (
                invalid ||
                offset !== size ||
                remaining !== 0 ||
                header.length !== 0 ||
                !hasMediaData ||
                !hasMovie
            )
                return null
            try {
                parser.flush()
            } catch {
                return null
            }
            return invalid ? null : result
        },
    }
}

function ascii(bytes: Uint8Array, offset: number) {
    return String.fromCharCode(...bytes.subarray(offset, offset + 4))
}
function read32(bytes: Uint8Array, offset: number) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset)
}

/** Bound declared sample counts before the library expands constant-size tables. */
function preflightMovie(bytes: Uint8Array) {
    const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'udta'])
    let count = 0
    let samples = 0
    function walk(start: number, end: number, depth: number) {
        if (depth > 12) throw new Error('MP4 metadata nesting too deep')
        let offset = start
        while (offset < end) {
            if (end - offset < 8 || ++count > 4096) throw new Error('Invalid MP4 metadata')
            const length = read32(bytes, offset)
            if (length < 8 || length > end - offset) throw new Error('Invalid MP4 metadata length')
            const type = ascii(bytes, offset + 4)
            if (type === 'stsz') {
                if (length < 20) throw new Error('Invalid MP4 sample table')
                const sampleCount = read32(bytes, offset + 16)
                samples += sampleCount
                if (
                    samples > 250_000 ||
                    (read32(bytes, offset + 12) === 0 && sampleCount > (length - 20) / 4)
                )
                    throw new Error('MP4 sample table too large')
            }
            if (type === 'mvex' || type === 'stz2') throw new Error('Unsupported MP4 sample layout')
            if (containers.has(type)) walk(offset + 8, offset + length, depth + 1)
            offset += length
        }
    }
    walk(0, bytes.length, 0)
}
