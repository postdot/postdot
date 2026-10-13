import { Button } from '@postbot/ui/components/button'
import { Field, FieldLabel } from '@postbot/ui/components/field'
import { Input } from '@postbot/ui/components/input'
import { Switch } from '@postbot/ui/components/switch'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, type EmailSettings, type EmailSettingsInput } from '@/lib/api'
import * as m from '@/paraglide/messages.js'

export function EmailSettingsForm() {
    const client = useQueryClient()
    const query = useQuery({
        queryKey: ['installation-email-settings'],
        queryFn: api.getEmailSettings,
    })
    if (query.isPending)
        return <p className="mt-8 text-sm text-muted-foreground">{m.common_loading()}</p>
    if (query.isError)
        return (
            <div className="mt-8">
                <p role="alert">{m.smtp_save_failed()}</p>
                <Button variant="outline" onClick={() => void query.refetch()}>
                    {m.common_retry()}
                </Button>
            </div>
        )
    return (
        <EmailSettingsFields
            initial={query.data}
            onSaved={value => client.setQueryData(['installation-email-settings'], value)}
        />
    )
}

function EmailSettingsFields({
    initial,
    onSaved,
}: {
    initial: EmailSettings
    onSaved: (value: EmailSettings) => void
}) {
    const [form, setForm] = useState<EmailSettingsInput>(() => ({
        enabled: initial.enabled,
        host: initial.host,
        port: initial.port,
        secure: initial.secure,
        from: initial.from,
        username: initial.username,
    }))
    const [saved, setSaved] = useState(initial)
    const [dirty, setDirty] = useState(false)
    const [pending, setPending] = useState<'save' | 'test' | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    function update(patch: Partial<EmailSettingsInput>) {
        setForm(previous => ({ ...previous, ...patch }))
        setDirty(true)
        setNotice(null)
        setError(null)
    }
    async function save(event: FormEvent) {
        event.preventDefault()
        setPending('save')
        setError(null)
        setNotice(null)
        try {
            const value = await api.saveEmailSettings(form)
            setSaved(value)
            onSaved(value)
            setForm(previous => ({ ...previous, password: undefined }))
            setDirty(false)
            setNotice(m.smtp_saved())
        } catch {
            setError(m.smtp_save_failed())
        } finally {
            setPending(null)
        }
    }
    async function test() {
        setPending('test')
        setNotice(null)
        setError(null)
        try {
            await api.testEmailSettings()
            setNotice(m.smtp_test_accepted())
        } catch {
            setError(m.smtp_test_failed())
        } finally {
            setPending(null)
        }
    }
    return (
        <section
            className="mx-auto mt-10 w-full max-w-3xl border-t border-border/50 pt-8"
            aria-labelledby="smtp-title">
            <h2 id="smtp-title" className="font-heading text-xl font-semibold">
                {m.smtp_title()}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{m.smtp_description()}</p>
            {saved.source === 'deployment' && (
                <p className="mt-2 text-sm text-muted-foreground">{m.smtp_deployment()}</p>
            )}
            <form className="mt-6 space-y-5" onSubmit={event => void save(event)}>
                <fieldset className="space-y-5" disabled={pending !== null}>
                    <Field orientation="horizontal">
                        <Switch
                            id="smtp-enabled"
                            checked={form.enabled}
                            onCheckedChange={enabled => update({ enabled })}
                        />
                        <FieldLabel htmlFor="smtp-enabled">{m.smtp_enabled()}</FieldLabel>
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
                        <Field>
                            <FieldLabel htmlFor="smtp-host">{m.smtp_host()}</FieldLabel>
                            <Input
                                id="smtp-host"
                                required
                                value={form.host}
                                onChange={event => update({ host: event.target.value })}
                                autoComplete="off"
                                placeholder="smtp.example.com"
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="smtp-port">{m.smtp_port()}</FieldLabel>
                            <Input
                                id="smtp-port"
                                required
                                type="number"
                                min={1}
                                max={65535}
                                value={form.port}
                                onChange={event => update({ port: Number(event.target.value) })}
                            />
                        </Field>
                    </div>
                    <Field orientation="horizontal">
                        <Switch
                            id="smtp-secure"
                            checked={form.secure}
                            onCheckedChange={secure => update({ secure })}
                        />
                        <FieldLabel htmlFor="smtp-secure">{m.smtp_secure()}</FieldLabel>
                    </Field>
                    <p className="text-sm text-muted-foreground">{m.smtp_secure_hint()}</p>
                    <Field>
                        <FieldLabel htmlFor="smtp-from">{m.smtp_from()}</FieldLabel>
                        <Input
                            id="smtp-from"
                            type="email"
                            required
                            value={form.from}
                            onChange={event => update({ from: event.target.value })}
                            autoComplete="off"
                        />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field>
                            <FieldLabel htmlFor="smtp-user">{m.smtp_username()}</FieldLabel>
                            <Input
                                id="smtp-user"
                                value={form.username}
                                onChange={event => update({ username: event.target.value })}
                                autoComplete="off"
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="smtp-password">{m.smtp_password()}</FieldLabel>
                            <Input
                                id="smtp-password"
                                type="password"
                                value={form.password ?? ''}
                                onChange={event =>
                                    update({ password: event.target.value || undefined })
                                }
                                autoComplete="new-password"
                                placeholder={
                                    saved.hasPassword ? m.smtp_password_saved() : undefined
                                }
                            />
                        </Field>
                    </div>
                    {saved.hasPassword && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => update({ password: null, username: '' })}>
                            {m.smtp_clear_password()}
                        </Button>
                    )}
                </fieldset>
                <p className="text-sm text-muted-foreground">{m.smtp_save_hint()}</p>
                {error && (
                    <p role="alert" className="text-sm text-destructive">
                        {error}
                    </p>
                )}
                {notice && (
                    <p role="status" className="text-sm">
                        {notice}
                    </p>
                )}
                <div className="flex flex-wrap gap-3">
                    <Button type="submit" disabled={pending !== null || !dirty}>
                        {pending === 'save' ? m.common_loading() : m.common_save()}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={pending !== null || dirty || !saved.enabled}
                        onClick={() => void test()}>
                        {pending === 'test' ? m.common_loading() : m.smtp_test()}
                    </Button>
                </div>
            </form>
        </section>
    )
}
