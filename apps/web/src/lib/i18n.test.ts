import { describe, expect, test } from 'bun:test'

import * as m from '../paraglide/messages.js'

describe('web localization foundation', () => {
    test('compiles the base and French catalogs with typed interpolation', () => {
        expect(String(m.language_menu_label({}, { locale: 'en' }))).toBe('Language')
        expect(String(m.language_menu_label({}, { locale: 'fr' }))).toBe('Langue')
        expect(String(m.language_switch_to({ language: 'Français' }, { locale: 'fr' }))).toBe(
            'Changer la langue pour Français'
        )
    })
})
