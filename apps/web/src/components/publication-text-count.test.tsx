import { expect, test } from 'bun:test'

import { renderToStaticMarkup } from 'react-dom/server'

import { countComposerText, getComposerTextFields } from '@/lib/composer-text-constraints'
import { LanguageProvider } from '@/lib/i18n'

import { PublicationTextCount } from './publication-text-count'

function renderCount(maxLength: number | null) {
    const constraint = getComposerTextFields({
        contentSchema: { type: 'object', properties: { text: { type: 'string' } } },
        fieldBindings: [{ id: 'text', semantic: 'primary_text', path: '/text' }],
        capabilities: {
            textFields: [{ bindingId: 'text', acceptedSourceFormats: ['plain_text'], maxLength }],
        },
    }).body!
    return renderToStaticMarkup(
        <LanguageProvider>
            <PublicationTextCount
                id="text-count"
                constraint={constraint}
                result={countComposerText('Hello', constraint)}
            />
        </LanguageProvider>
    )
}

test('unknown text limits render the actual count without a denominator', () => {
    const html = renderCount(null)
    expect(html).toContain('5 characters')
    expect(html).not.toContain(' / ')
    expect(html).not.toContain('Infinity')
})

test('known text limits retain their denominator and overflow styling', () => {
    const html = renderCount(4)
    expect(html).toContain('5 / 4')
    expect(html).toContain('text-destructive')
})
