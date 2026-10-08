import { expect, it } from 'bun:test'

import { parseMediaByteRange } from './byte-range'
it('bounds explicit, open and suffix ranges and rejects invalid or multiple ranges', () => {
    expect(parseMediaByteRange('bytes=2-5', 10)).toEqual({ start: 2, end: 6 })
    expect(parseMediaByteRange('bytes=2-', 10)).toEqual({ start: 2, end: 10 })
    expect(parseMediaByteRange('bytes=-3', 10)).toEqual({ start: 7, end: 10 })
    expect(parseMediaByteRange('bytes=2-999', 10)).toEqual({ start: 2, end: 10 })
    for (const value of [
        'bytes=10-',
        'bytes=7-2',
        'bytes=-0',
        'bytes=-',
        'bytes=0-2,4-6',
        'bytes=9007199254740992-',
    ])
        expect(parseMediaByteRange(value, 10)).toBeNull()
})
