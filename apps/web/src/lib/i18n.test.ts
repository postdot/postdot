import { describe, expect, test } from 'bun:test'

import * as m from '../paraglide/messages.js'

describe('web localization foundation', () => {
    test('compiles the base and French catalogs with typed interpolation', () => {
        const englishMenuLabel = String(m.language_menu_label({}, { locale: 'en' }))
        const frenchMenuLabel = String(m.language_menu_label({}, { locale: 'fr' }))
        const frenchLanguage = String(m.language_french({}, { locale: 'fr' }))
        const frenchSwitchLabel = String(
            m.language_switch_to({ language: frenchLanguage }, { locale: 'fr' })
        )

        expect(englishMenuLabel).not.toBe(frenchMenuLabel)
        expect(frenchSwitchLabel).toContain(frenchLanguage)
        expect(frenchSwitchLabel).not.toBe(
            String(m.language_switch_to({ language: frenchLanguage }, { locale: 'en' }))
        )
    })

    test('keeps the reviewed media copy translated in both locales', () => {
        const englishUpload = String(m.media_upload({}, { locale: 'en' }))
        const frenchUpload = String(m.media_upload({}, { locale: 'fr' }))
        const frenchUploading = String(
            m.media_uploading({ filename: 'hero.png' }, { locale: 'fr' })
        )
        const frenchSourceFormat = String(m.editor_sidebar_no_source_format({}, { locale: 'fr' }))
        const frenchFileType = String(m.media_file_type({}, { locale: 'fr' }))

        expect(englishUpload).not.toBe(frenchUpload)
        expect(frenchUploading).toContain('hero.png')
        expect(frenchSourceFormat).not.toHaveLength(0)
        expect(frenchFileType).not.toHaveLength(0)
    })
})
