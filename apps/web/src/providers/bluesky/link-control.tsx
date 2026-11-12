import { Input } from '@postdot/ui/components/input'
import { Textarea } from '@postdot/ui/components/textarea'

import * as m from '@/paraglide/messages.js'

import type { ProviderFieldProps } from '../contract'

export function BlueskyLinkControl({
    value,
    disabled,
    fieldId,
    question,
    onChange,
    error,
}: ProviderFieldProps) {
    const card = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
    const read = (key: string) => (typeof card[key] === 'string' ? (card[key] as string) : '')
    const patch = (change: Record<string, string>) =>
        onChange({
            uri: read('uri'),
            title: read('title'),
            description: read('description'),
            ...change,
        })
    function initialCard() {
        const uri = question.match(/https?:\/\/[^\s<>()]+/)?.[0]?.replace(/[.,!?;:]+$/, '') ?? ''
        let title = ''
        try {
            title = new URL(uri).hostname
        } catch {
            /* The empty field remains editable. */
        }
        return { uri, title, description: '' }
    }
    return (
        <fieldset
            disabled={disabled}
            className="min-w-0 space-y-3 rounded-md bg-surface-inset/35 p-3"
            aria-describedby={error ? `${fieldId}-error` : undefined}>
            <legend className="sr-only">{m.bluesky_link_card()}</legend>
            <label
                htmlFor={`${fieldId}-enabled`}
                className="flex items-center gap-2 text-sm font-medium">
                <input
                    id={`${fieldId}-enabled`}
                    type="checkbox"
                    checked={value !== undefined}
                    onChange={event => onChange(event.target.checked ? initialCard() : undefined)}
                />
                {m.bluesky_link_card()}
            </label>
            {value !== undefined ? (
                <div className="grid gap-3">
                    <label className="grid gap-1.5 text-sm" htmlFor={`${fieldId}-uri`}>
                        {m.bluesky_link_card_url()}
                        <Input
                            id={`${fieldId}-uri`}
                            value={read('uri')}
                            type="url"
                            placeholder="https://example.com/article"
                            maxLength={2048}
                            onChange={event => patch({ uri: event.target.value })}
                        />
                    </label>
                    <label className="grid gap-1.5 text-sm" htmlFor={`${fieldId}-title`}>
                        {m.publication_new_post_title()}
                        <Input
                            id={`${fieldId}-title`}
                            value={read('title')}
                            maxLength={3000}
                            onChange={event => patch({ title: event.target.value })}
                        />
                    </label>
                    <label className="grid gap-1.5 text-sm" htmlFor={`${fieldId}-description`}>
                        {m.bluesky_link_card_description()}
                        <Textarea
                            id={`${fieldId}-description`}
                            value={read('description')}
                            maxLength={10000}
                            onChange={event => patch({ description: event.target.value })}
                        />
                    </label>
                    <p className="text-xs text-muted-foreground">{m.bluesky_link_card_help()}</p>
                </div>
            ) : null}
            {error ? (
                <p id={`${fieldId}-error`} role="alert" className="text-sm text-destructive">
                    {error}
                </p>
            ) : null}
        </fieldset>
    )
}
