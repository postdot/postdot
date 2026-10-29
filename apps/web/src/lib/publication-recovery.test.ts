import { describe, expect, test } from 'bun:test'

import {
    hasRecoverablePublicationContent,
    readPublicationRecovery,
    writePublicationRecovery,
    clearPublicationRecovery,
    publicationRecoveryKey,
    recoveredComposerContent,
    composerContentsEqual,
    isPublicationComposerDraftContent,
} from './publication-recovery'

function target(content = '') {
    return {
        channelId: 'channel-1',
        content,
        deliveryMode: 'manual' as const,
        id: 'target-1',
        scheduledAt: '',
    }
}

describe('new publication recovery', () => {
    test('does not treat whitespace or an untouched target as recoverable work', () => {
        expect(
            hasRecoverablePublicationContent({
                postTitle: '',
                postContent: ' ',
                publicationTargets: [target()],
                sourceMedia: [],
            })
        ).toBe(false)
    })

    test('recognizes a title-only article as recoverable work', () => {
        expect(
            hasRecoverablePublicationContent({
                postTitle: 'My article',
                postContent: '',
                publicationTargets: [target()],
                sourceMedia: [],
            })
        ).toBe(true)
    })

    test('recognizes shared text, target text, and media as recoverable work', () => {
        expect(
            hasRecoverablePublicationContent({
                postTitle: '',
                postContent: 'A shared post',
                publicationTargets: [target()],
                sourceMedia: [],
            })
        ).toBe(true)
        expect(
            hasRecoverablePublicationContent({
                postTitle: '',
                postContent: '',
                publicationTargets: [target('A channel-specific post')],
                sourceMedia: [],
            })
        ).toBe(true)
        expect(
            hasRecoverablePublicationContent({
                postTitle: '',
                postContent: '',
                publicationTargets: [target()],
                sourceMedia: [{ assetId: 'asset-1' }],
            })
        ).toBe(true)
    })
})

describe('server composer draft content validation', () => {
    const content = {
        postTitle: 'Retained draft',
        postContent: '',
        sourceMedia: [],
        publicationTargets: [target('Destination copy')],
        publicationTagIds: ['tag-1'],
        defaultDeliveryMode: 'manual',
        defaultScheduledAt: '',
        customizedTargetIds: [],
        customizedContentTargetIds: [],
        activePublicationTabId: 'target-1',
    }

    test('accepts complete server content and optional content scope without requiring local metadata', () => {
        expect(isPublicationComposerDraftContent(content)).toBe(true)
        expect(
            isPublicationComposerDraftContent({ ...content, activeContentScopeId: 'source' })
        ).toBe(true)
        expect(
            isPublicationComposerDraftContent({ ...content, postTitle: '', publicationTargets: [] })
        ).toBe(true)
    })

    test('rejects opaque or malformed server content before the editor treats it as a draft', () => {
        for (const value of [
            null,
            {},
            { unrelated: 'record' },
            { ...content, sourceMedia: [{ assetId: 42 }] },
            { ...content, publicationTargets: [{ ...target(), deliveryMode: 'invalid' }] },
            { ...content, publicationTagIds: [42] },
            { ...content, activeContentScopeId: 42 },
        ]) {
            expect(isPublicationComposerDraftContent(value)).toBe(false)
        }
    })
})

function memoryStorage(): Storage {
    const items = new Map<string, string>()
    return {
        get length() {
            return items.size
        },
        clear: () => items.clear(),
        getItem: key => items.get(key) ?? null,
        setItem: (key, value) => {
            items.set(key, value)
        },
        removeItem: key => {
            items.delete(key)
        },
        key: index => [...items.keys()][index] ?? null,
    }
}

test('keeps each tab recovery independent and strips version guards from the server payload', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
    const shared = memoryStorage()
    const first = memoryStorage()
    const second = memoryStorage()
    const browser = { localStorage: shared, sessionStorage: first }
    Object.defineProperty(globalThis, 'window', { value: browser, configurable: true })
    const input = {
        postTitle: 'Outline',
        postContent: 'Tab A',
        sourceMedia: [{ assetId: 'media-1', accessibilityText: 'Alt text' }],
        publicationTargets: [target('Target copy')],
        publicationTagIds: ['tag-1'],
        defaultDeliveryMode: 'manual' as const,
        defaultScheduledAt: '',
        customizedTargetIds: new Set<string>(),
        customizedContentTargetIds: new Set(['target-1']),
        activePublicationTabId: 'shared',
        activeContentScopeId: 'shared',
        serverDraftRevision: 3,
        serverDraftId: 'draft-A',
        conflict: true,
    }
    try {
        writePublicationRecovery('project-1', 'user-1', input)
        browser.sessionStorage = second
        writePublicationRecovery('project-1', 'user-1', { ...input, postContent: 'Tab B' })
        browser.sessionStorage = first
        const recovered = readPublicationRecovery('project-1', 'user-1')!
        expect(recovered.postContent).toBe('Tab A')
        expect(recovered.serverDraftRevision).toBe(3)
        const payload = recoveredComposerContent(recovered)
        expect(payload).not.toHaveProperty('conflict')
        expect(payload).not.toHaveProperty('serverDraftRevision')
        expect(payload).not.toHaveProperty('serverDraftId')
        expect(payload.sourceMedia).toEqual(input.sourceMedia)
        expect(payload.publicationTargets).toEqual(input.publicationTargets)
        clearPublicationRecovery('project-1', 'user-1')
        browser.sessionStorage = second
        expect(readPublicationRecovery('project-1', 'user-1')?.postContent).toBe('Tab B')
        // A damaged tab copy must not hide a valid shared recovery point.
        writePublicationRecovery('project-1', 'user-1', {
            ...input,
            postContent: 'Shared fallback',
        })
        second.setItem(publicationRecoveryKey('project-1', 'user-1'), '{invalid')
        expect(readPublicationRecovery('project-1', 'user-1')?.postContent).toBe('Shared fallback')
        Object.defineProperty(browser, 'localStorage', {
            configurable: true,
            get() {
                throw new Error('Storage blocked')
            },
        })
        writePublicationRecovery('project-1', 'user-1', {
            ...input,
            postContent: 'Tab-only storage',
        })
        expect(readPublicationRecovery('project-1', 'user-1')?.postContent).toBe('Tab-only storage')
    } finally {
        if (descriptor) Object.defineProperty(globalThis, 'window', descriptor)
        else Reflect.deleteProperty(globalThis, 'window')
    }
})

test('keeps recovery separate per author and never reads unscoped legacy entries', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
    const storage = memoryStorage()
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { sessionStorage: memoryStorage(), localStorage: storage },
    })
    const input = {
        postTitle: '',
        postContent: 'Author one',
        sourceMedia: [],
        publicationTargets: [target('')],
        publicationTagIds: [],
        defaultDeliveryMode: 'manual' as const,
        defaultScheduledAt: '',
        customizedTargetIds: new Set<string>(),
        customizedContentTargetIds: new Set<string>(),
        activePublicationTabId: 'shared',
        activeContentScopeId: 'shared',
    }
    try {
        const legacyKey = 'postdot:publication-composer:v1:project-1'
        storage.setItem(legacyKey, '{"legacy":true}')
        writePublicationRecovery('project-1', 'user-1', input)
        expect(readPublicationRecovery('project-1', 'user-2')).toBeNull()
        writePublicationRecovery('project-1', 'user-2', { ...input, postContent: 'Author two' })
        clearPublicationRecovery('project-1', 'user-2')
        expect(readPublicationRecovery('project-1', 'user-1')?.postContent).toBe('Author one')
        expect(readPublicationRecovery('project-1', 'user-2')).toBeNull()
        expect(storage.getItem(legacyKey)).toBe('{"legacy":true}')
    } finally {
        if (descriptor) Object.defineProperty(globalThis, 'window', descriptor)
        else Reflect.deleteProperty(globalThis, 'window')
    }
})

test('recognizes an already-committed recovery payload without ignoring array order or content', () => {
    expect(
        composerContentsEqual(
            {
                postContent: 'Kept',
                sourceMedia: [{ assetId: 'one', accessibilityText: undefined }],
            },
            { sourceMedia: [{ assetId: 'one' }], postContent: 'Kept' }
        )
    ).toBe(true)
    expect(
        composerContentsEqual({ sourceMedia: ['one', 'two'] }, { sourceMedia: ['two', 'one'] })
    ).toBe(false)
    expect(composerContentsEqual({ postContent: 'Local' }, { postContent: 'Remote' })).toBe(false)
})
