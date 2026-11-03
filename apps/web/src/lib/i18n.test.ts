/* cspell:disable */
import { beforeAll, describe, expect, test } from 'bun:test'

import * as m from '../paraglide/messages.js'
import { loadLocale } from './i18n-store.js'

describe('web localization foundation', () => {
    beforeAll(async () => {
        await loadLocale('fr')
        await loadLocale('es')
        await loadLocale('de')
    })
    test('compiles English, French, Spanish, and German catalogs with typed interpolation', () => {
        const englishMenuLabel = String(m.language_menu_label({}, { locale: 'en' }))
        const frenchMenuLabel = String(m.language_menu_label({}, { locale: 'fr' }))
        const spanishMenuLabel = String(m.language_menu_label({}, { locale: 'es' }))
        const germanMenuLabel = String(m.language_menu_label({}, { locale: 'de' }))

        const frenchLanguage = String(m.language_french({}, { locale: 'fr' }))
        const spanishLanguage = String(m.language_spanish({}, { locale: 'es' }))
        const germanLanguage = String(m.language_german({}, { locale: 'de' }))

        const frenchSwitchLabel = String(
            m.language_switch_to({ language: frenchLanguage }, { locale: 'fr' })
        )
        const spanishSwitchLabel = String(
            m.language_switch_to({ language: spanishLanguage }, { locale: 'es' })
        )
        const germanSwitchLabel = String(
            m.language_switch_to({ language: germanLanguage }, { locale: 'de' })
        )

        expect(englishMenuLabel).toBe('Language')
        expect(frenchMenuLabel).toBe('Langue')
        expect(spanishMenuLabel).toBe('Idioma')
        expect(germanMenuLabel).toBe('Sprache')

        expect(frenchSwitchLabel).toContain(frenchLanguage)
        expect(spanishSwitchLabel).toContain(spanishLanguage)
        expect(germanSwitchLabel).toContain(germanLanguage)
    })

    test('keeps the reviewed media copy translated across all 4 locales', () => {
        const englishUpload = String(m.media_upload({}, { locale: 'en' }))
        const frenchUpload = String(m.media_upload({}, { locale: 'fr' }))
        const spanishUpload = String(m.media_upload({}, { locale: 'es' }))
        const germanUpload = String(m.media_upload({}, { locale: 'de' }))

        expect(englishUpload).toBe('Add media')
        expect(frenchUpload).toBe('Ajouter un média')
        expect(spanishUpload).toBe('Añadir multimedia')
        expect(germanUpload).toBe('Medien hinzufügen')

        const spanishUploading = String(
            m.media_uploading({ filename: 'hero.png' }, { locale: 'es' })
        )
        const germanUploading = String(
            m.media_uploading({ filename: 'hero.png' }, { locale: 'de' })
        )

        expect(spanishUploading).toContain('hero.png')
        expect(germanUploading).toContain('hero.png')
    })
})
