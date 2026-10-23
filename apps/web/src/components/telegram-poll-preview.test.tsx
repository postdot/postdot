import { expect, test } from 'bun:test'

import { renderToStaticMarkup } from 'react-dom/server'

import { TelegramPollPreview } from '@/providers/telegram/poll-preview'

test('previews the answers, the closing period and the anonymity of a poll', () => {
    const html = renderToStaticMarkup(
        <TelegramPollPreview
            poll={{ options: ['Product updates', 'Tutorials'], multiple: true, openPeriod: 3600 }}
        />
    )

    expect(html).toContain('data-telegram-poll-preview="true"')
    expect(html).toContain('Product updates')
    expect(html).toContain('Tutorials')
    expect(html).toContain('Closes 1 hour after publication')
    expect(html).toContain('Anonymous answers')
    expect(html).toContain('Allow multiple selections')
})

test('previews a poll without an automatic closing', () => {
    const html = renderToStaticMarkup(<TelegramPollPreview poll={{ options: ['One', 'Two'] }} />)

    expect(html).toContain('No automatic closing')
    expect(html).not.toContain('Closes')
})

test('does not simulate votes and offers no voting control', () => {
    const html = renderToStaticMarkup(
        <TelegramPollPreview poll={{ options: ['Product updates', 'Tutorials'] }} />
    )

    expect(html).not.toContain('<button')
    expect(html).not.toContain('%')
    expect(html).not.toContain('vote')
})

test('renders nothing for a target without a poll', () => {
    expect(renderToStaticMarkup(<TelegramPollPreview poll={undefined} />)).toBe('')
})
