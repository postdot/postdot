import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { Button } from '@herald/ui/components/button'
import { AddIcon } from '@solar-icons/react/linear/add'
import { CheckIcon } from '@solar-icons/react/linear/check'
import { SettingsIcon } from '@solar-icons/react/linear/settings'
import { useEffect, useState, type FormEvent } from 'react'

import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { EmptyState } from '@/components/empty-state'
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
    const [xCallbackUri, setXCallbackUri] = useState<string | null>(null)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [form, setForm] = useState<ProviderApplicationFormState>(newProviderApplicationForm)
    const [formOpen, setFormOpen] = useState(false)
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
                    setXCallbackUri(response.xCallbackUri)
                    setFormOpen(false)
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
        setXCallbackUri(response.xCallbackUri)
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
            <div className="w-full">
                <DashboardPageHeader
                    centered
                    title={m.provider_apps_title()}
                    description={m.provider_apps_description()}
                    action={
                        applications?.length ? (
                            <Button
                                type="button"
                                variant="outline"
                                aria-expanded={formOpen || editingId !== null}
                                onClick={() => setFormOpen(current => !current)}>
                                <AddIcon aria-hidden="true" />
                                {m.provider_apps_new()}
                            </Button>
                        ) : null
                    }
                />

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
                        <CheckIcon aria-hidden="true" className="size-4" />
                        <span>{notice}</span>
                    </div>
                ) : null}

                <div className="mt-8 grid gap-8">
                    <div
                        className={
                            applications !== null && (formOpen || editingId !== null)
                                ? 'min-w-0'
                                : 'hidden'
                        }>
                        {applications !== null && (formOpen || editingId !== null) ? (
                            <div>
                                <ProviderApplicationForm
                                    editingApplication={editingApplication}
                                    editingId={editingId}
                                    form={form}
                                    xCallbackUri={xCallbackUri ?? ''}
                                    onCancel={cancelEdit}
                                    onFormChange={setForm}
                                    onSubmit={event => void handleSubmit(event)}
                                    pending={pending}
                                />
                            </div>
                        ) : null}
                    </div>

                    <section aria-label={m.provider_apps_title()} className="min-w-0">
                        {applications === null ? (
                            <p className="mt-4 text-sm text-muted-foreground" role="status">
                                {m.provider_apps_loading()}
                            </p>
                        ) : applications.length === 0 && !formOpen ? (
                            <EmptyState
                                action={
                                    <Button type="button" onClick={() => setFormOpen(true)}>
                                        <AddIcon aria-hidden="true" />
                                        {m.provider_apps_new()}
                                    </Button>
                                }
                                className="mt-4"
                                description={m.provider_apps_empty_description()}
                                icon={<SettingsIcon aria-hidden="true" />}
                                layout="compact"
                                title={m.provider_apps_empty()}
                            />
                        ) : applications.length === 0 ? null : (
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
