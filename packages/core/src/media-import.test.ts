import { describe, expect, test } from 'bun:test'

import { mediaImportSourceDefinitions, mediaImportSourceIds } from './media-import'

describe('media import sources', () => {
    test('keeps the source registry explicit and ordered', () => {
        expect(mediaImportSourceIds).toEqual(['device', 'webcam', 'url'])
        expect(Object.keys(mediaImportSourceDefinitions)).toEqual(['device', 'webcam', 'url'])
    })

    test('describes transfer ownership for each source', () => {
        expect(mediaImportSourceDefinitions.device).toEqual({
            id: 'device',
            transfer: 'browser',
            requiresAuthentication: false,
        })
        expect(mediaImportSourceDefinitions.webcam).toEqual({
            id: 'webcam',
            transfer: 'browser',
            requiresAuthentication: false,
        })
        expect(mediaImportSourceDefinitions.url).toEqual({
            id: 'url',
            transfer: 'server',
            requiresAuthentication: false,
        })
    })
})
