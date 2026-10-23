import { expect, test } from 'bun:test'

import { renderToStaticMarkup } from 'react-dom/server'

import { TelegramPollControl } from '@/providers/telegram/poll-control'

test('offers the poll as an opt-in control that starts with two answers', () => {
    const html = renderToStaticMarkup(
        <TelegramPollControl
            fieldId="target-field-poll"
            value={undefined}
            disabled={false}
            question="Which topic next?"
            onChange={() => {}}
        />
    )

    expect(html).toContain('type="checkbox"')
    expect(html).toContain('Add a poll')
    expect(html).not.toContain('Option 1')
    expect(html).not.toContain('Duration after publication')
})

test('shows the persisted answers, the closing period and the anonymity of a poll', () => {
    const html = renderToStaticMarkup(
        <TelegramPollControl
            fieldId="target-field-poll"
            value={{ options: ['Product updates', 'Tutorials'], multiple: true, openPeriod: 3600 }}
            disabled={false}
            question="Which topic next?"
            onChange={() => {}}
        />
    )

    expect(html).toContain('Option 1')
    expect(html).toContain('Option 2')
    expect(html).toContain('Product updates')
    expect(html).toContain('Tutorials')
    expect(html).toContain('Duration after publication')
    expect(html).toContain('>1 hour<')
    expect(html).toContain('Allow multiple selections')
    expect(html).toContain('Anonymous answers')
    expect(html).toContain('The message text is the poll question.')
})

test('reports blank answers and a missing question instead of publishing them', () => {
    const html = renderToStaticMarkup(
        <TelegramPollControl
            fieldId="target-field-poll"
            value={{ options: ['', 'Tutorials'] }}
            disabled={false}
            question=""
            onChange={() => {}}
        />
    )

    expect(html).toContain(
        'Enter a question of up to 300 characters and 1 to 12 answers of up to 100 characters.'
    )
})

test('keeps a persisted closing period that is outside the offered list', () => {
    const html = renderToStaticMarkup(
        <TelegramPollControl
            fieldId="target-field-poll"
            value={{ options: ['One', 'Two'], openPeriod: 12345 }}
            disabled={false}
            question="Which topic next?"
            onChange={() => {}}
        />
    )

    expect(html).toContain('>12345 seconds<')
})

test('offers no automatic closing until a period is chosen', () => {
    const html = renderToStaticMarkup(
        <TelegramPollControl
            fieldId="target-field-poll"
            value={{ options: ['One', 'Two'] }}
            disabled={false}
            question="Which topic next?"
            onChange={() => {}}
        />
    )

    expect(html).toContain('No automatic closing')
})

test('disables every control of a poll the operator cannot change', () => {
    const html = renderToStaticMarkup(
        <TelegramPollControl
            fieldId="target-field-poll"
            value={{ options: ['One', 'Two'] }}
            disabled
            question="Which topic next?"
            onChange={() => {}}
        />
    )

    expect(html).toContain('disabled=""')
    expect(html).toContain('value="One"')
})
