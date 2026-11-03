/* cspell:disable */
import { describe, expect, it } from 'bun:test'

import {
    getAppShortcuts,
    getModifierKey,
    getShortcutCategoryTitle,
    isMac,
    isShortcutsQuery,
} from './shortcuts'

describe('shortcuts helper', () => {
    it('detects shortcuts queries correctly', () => {
        expect(isShortcutsQuery('?')).toBe(true)
        expect(isShortcutsQuery('/?')).toBe(true)
        expect(isShortcutsQuery('shortcut')).toBe(true)
        expect(isShortcutsQuery('raccourci')).toBe(true)
        expect(isShortcutsQuery('clavier')).toBe(true)
        expect(isShortcutsQuery('hotkey')).toBe(true)
        expect(isShortcutsQuery('help')).toBe(true)
        expect(isShortcutsQuery('aide')).toBe(true)
        expect(isShortcutsQuery('ayuda')).toBe(true)
        expect(isShortcutsQuery('hilfe')).toBe(true)
        expect(isShortcutsQuery('tastatur')).toBe(true)
        expect(isShortcutsQuery('posts')).toBe(false)
        expect(isShortcutsQuery('')).toBe(false)
    })

    it('returns application shortcuts list with valid categories and keys', () => {
        const shortcuts = getAppShortcuts()
        expect(shortcuts.length).toBeGreaterThanOrEqual(8)

        for (const item of shortcuts) {
            expect(item.id).toBeTruthy()
            expect(item.keys.length).toBeGreaterThan(0)
            expect(item.title()).toBeTruthy()
            expect(item.keywords).toBeTruthy()
            expect(['general', 'composer', 'calendar', 'media']).toContain(item.category)
        }
    })

    it('resolves localized category titles', () => {
        expect(getShortcutCategoryTitle('general')).toBeTruthy()
        expect(getShortcutCategoryTitle('composer')).toBeTruthy()
        expect(getShortcutCategoryTitle('calendar')).toBeTruthy()
        expect(getShortcutCategoryTitle('media')).toBeTruthy()
    })

    it('detects modifier key based on environment', () => {
        const mod = getModifierKey()
        expect(['⌘', 'Ctrl']).toContain(mod)
        expect(typeof isMac()).toBe('boolean')
    })
})
