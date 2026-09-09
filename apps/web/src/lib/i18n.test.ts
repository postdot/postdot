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

    test('keeps the reviewed media copy translated in both locales', () => {
        expect(String(m.media_upload({}, { locale: 'en' }))).toBe('Add media')
        expect(String(m.media_upload({}, { locale: 'fr' }))).toBe('Ajouter un média')
        expect(String(m.media_uploading({ filename: 'hero.png' }, { locale: 'fr' }))).toBe(
            'Ajout de hero.png…'
        )
        expect(String(m.editor_sidebar_no_source_format({}, { locale: 'fr' }))).toBe(
            'Aucun format source'
        )
        expect(String(m.media_file_type({}, { locale: 'fr' }))).toBe('Fichier')
    })
})
