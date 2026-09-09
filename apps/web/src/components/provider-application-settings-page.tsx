import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { Badge } from '@herald/ui/components/badge'
import { Button } from '@herald/ui/components/button'
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from '@herald/ui/components/empty'
import { AddIcon } from '@solar-icons/react/bold/add'
import { CheckReadIcon } from '@solar-icons/react/bold/check-read'
import { SettingsIcon } from '@solar-icons/react/bold/settings'
import { useEffect, useState, type FormEvent } from 'react'

import {
    ProviderApplicationForm,
    newProviderApplicationForm,
    providerApplicationInput,
} from '@/components/provider-application-form'
import type { ProviderApplicationFormState } from '@/components/provider-application-form'
import { ProviderApplicationRow } from '@/components/provider-application-row'
import { api, formatApiError, type ProviderApplication } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export function ProviderApplicationSettingsPage() {
    useLanguage()
    const [applications, setApplications] = useState<ProviderApplication[] | null>(null)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [form, setForm] = useState<ProviderApplicationFormState>(newProviderApplicationForm)
    const [formOpen, setFormOpen] = useState(true)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        setApplications(null)
        setError(null)

        void api
            .listProviderApplications()
            .then(response => {
                if (!cancelled) {
                    setApplications(response.applications)
                    setFormOpen(response.applications.length === 0)
                }
            })
            .catch(caughtError => {
                if (!cancelled) setError(formatApiError(caughtError))
            })

        return () => {
            cancelled = true
        }
    }, [])

    const editingApplication =
        editingId === null
            ? undefined
            : applications?.find(application => application.id === editingId)

    function beginEdit(application: ProviderApplication) {
        setEditingId(application.id)
        setFormOpen(true)
        setForm({
            providerId: application.providerId,
            name: application.name,
            clientId: application.clientId ?? '',
            clientMetadataUrl: application.clientMetadataUrl ?? '',
            handleResolver: application.handleResolver ?? 'https://bsky.social',
            blueskyOAuthMode:
                application.oauthMode === 'web' || application.clientMetadataUrl !== null
                    ? 'web'
                    : 'loopback',
            clientSecret: '',
            isDefault: application.isDefault,
        })
        setError(null)
        setNotice(null)
    }

    function cancelEdit() {
        setEditingId(null)
        setForm(newProviderApplicationForm())
        setFormOpen(false)
        setError(null)
        setNotice(null)
    }

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (pending) return

        await runAction(async () => {
            if (editingId === null) {
                await api.createProviderApplication(providerApplicationInput(form, true))
                await reloadApplications()
                setNotice(m.provider_apps_created())
            } else {
                await api.updateProviderApplication(
                    editingId,
                    providerApplicationInput(form, false)
                )
                await reloadApplications()
                setNotice(m.provider_apps_updated())
            }
            setEditingId(null)
            setForm(newProviderApplicationForm())
            setFormOpen(false)
        })
    }

    async function makeDefault(application: ProviderApplication) {
        await runAction(async () => {
            await api.updateProviderApplication(application.id, {
                isDefault: true,
                state: 'active',
            })
            await reloadApplications()
            setNotice(m.provider_apps_updated())
        })
    }

    async function toggleState(application: ProviderApplication) {
        await runAction(async () => {
            await api.updateProviderApplication(application.id, {
                state: application.state === 'active' ? 'disabled' : 'active',
                isDefault: application.state === 'active' ? false : application.isDefault,
            })
            await reloadApplications()
            setNotice(m.provider_apps_updated())
        })
    }

    async function reloadApplications() {
        const response = await api.listProviderApplications()
        setApplications(response.applications)
    }

    async function runAction(action: () => Promise<void>) {
        setError(null)
        setNotice(null)
        setPending(true)
        try {
            await action()
        } catch (caughtError) {
            setError(formatApiError(caughtError))
        } finally {
            setPending(false)
        }
    }

    return (
        <main className="min-w-0 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
            <div className="mx-auto max-w-6xl">
                <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <h1 className="font-heading text-3xl font-semibold leading-[1.02] tracking-[-0.05em] sm:text-4xl">
                                {m.provider_apps_title()}
                            </h1>
                            <Badge variant="secondary">{m.nav_instance_settings()}</Badge>
                        </div>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                            {m.provider_apps_description()}
                        </p>
                    </div>
                </header>

                {error ? (
                    <Alert className="mt-6" variant="destructive">
                        <AlertTitle>{m.provider_apps_action_failed()}</AlertTitle>
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                ) : null}
                {notice ? (
                    <div
                        className="mt-6 flex items-center gap-2 text-sm text-state-success"
                        role="status">
                        <CheckReadIcon aria-hidden="true" className="size-4" />
                        <span>{notice}</span>
                    </div>
                ) : null}

                <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
                    <div className="min-w-0">
                        {applications?.length && editingId === null ? (
                            <Button
                                type="button"
                                variant="outline"
                                aria-expanded={formOpen || editingId !== null}
                                onClick={() => setFormOpen(current => !current)}>
                                <AddIcon aria-hidden="true" />
                                {m.provider_apps_new()}
                            </Button>
                        ) : null}
                        {applications === null ||
                        applications.length === 0 ||
                        formOpen ||
                        editingId !== null ? (
                            <div className={applications?.length ? 'mt-3' : undefined}>
                                <ProviderApplicationForm
                                    editingApplication={editingApplication}
                                    editingId={editingId}
                                    form={form}
                                    onCancel={cancelEdit}
                                    onFormChange={setForm}
                                    onSubmit={event => void handleSubmit(event)}
                                    pending={pending}
                                />
                            </div>
                        ) : null}
                    </div>

                    <section aria-label={m.provider_apps_title()} className="min-w-0">
                        <div className="flex justify-end">
                            {applications ? (
                                <span className="text-sm text-muted-foreground">
                                    {applications.length}
                                </span>
                            ) : null}
                        </div>

                        {applications === null ? (
                            <p className="mt-4 text-sm text-muted-foreground" role="status">
                                {m.provider_apps_loading()}
                            </p>
                        ) : applications.length === 0 ? (
                            <Empty className="mt-4 min-h-0 flex-row items-center justify-start gap-3 rounded-lg border border-dashed border-border/80 bg-muted/40 px-4 py-3 text-left">
                                <EmptyMedia className="mb-0 size-7" variant="icon">
                                    <SettingsIcon aria-hidden="true" />
                                </EmptyMedia>
                                <EmptyHeader className="items-start gap-0.5">
                                    <EmptyTitle>{m.provider_apps_empty()}</EmptyTitle>
                                    <EmptyDescription className="text-left text-xs/5">
                                        {m.provider_apps_empty_description()}
                                    </EmptyDescription>
                                </EmptyHeader>
                            </Empty>
                        ) : (
                            <div className="mt-4 space-y-3">
                                {applications.map(application => (
                                    <ProviderApplicationRow
                                        key={application.id}
                                        application={application}
                                        disabled={pending}
                                        onEdit={beginEdit}
                                        onMakeDefault={makeDefault}
                                        onToggleState={toggleState}
                                    />
                                ))}
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </main>
    )
}
