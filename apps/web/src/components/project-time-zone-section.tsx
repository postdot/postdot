import { Alert, AlertDescription } from '@postdot/ui/components/alert'
import { Button } from '@postdot/ui/components/button'
import { Field, FieldDescription, FieldLabel } from '@postdot/ui/components/field'
import { toast } from '@postdot/ui/components/toast'
import { useRouter } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'

import { SettingsSection, SettingsCard, SettingsRow } from '@/components/settings-layout'
import { TimeZoneCombobox } from '@/components/time-zone-combobox'
import { api, formatApiError } from '@/lib/api'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export function ProjectTimeZoneSection() {
    useLanguage()
    const router = useRouter()
    const { access, project, projectRole } = useProjectDashboard()
    const [timeZone, setTimeZone] = useState(project.timeZone)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        setTimeZone(project.timeZone)
        setError(null)
    }, [project.id, project.timeZone])

    const canEditRole = projectRole === 'owner' || projectRole === 'editor'
    const canEdit = canEditRole && access.canWrite()
    const isDirty = timeZone !== project.timeZone

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!canEdit || pending || !isDirty) return

        setPending(true)
        setError(null)
        try {
            const updated = await api.updateProjectTimeZone(project.id, timeZone)
            setTimeZone(updated.timeZone)
            toast.add({
                title: m.project_timezone_saved(),
                type: 'success',
            })
            await router.invalidate()
        } catch (caughtError) {
            access.reportRefusal(caughtError)
            setError(formatApiError(caughtError))
        } finally {
            setPending(false)
        }
    }

    return (
        <SettingsSection
            id="project-timezone-title"
            title={m.project_timezone_title()}
            description={m.project_timezone_description()}>
            <SettingsCard>
                <form className="space-y-3" onSubmit={e => void handleSubmit(e)}>
                    <SettingsRow
                        title={m.project_timezone_label()}
                        control={
                            <Field className="gap-1.5">
                                <FieldLabel className="sr-only" htmlFor="project-timezone">
                                    {m.project_timezone_label()}
                                </FieldLabel>
                                <TimeZoneCombobox
                                    disabled={!canEdit || pending}
                                    id="project-timezone"
                                    label={m.project_timezone_label()}
                                    onValueChange={setTimeZone}
                                    value={timeZone}
                                />
                                {!canEditRole && access.status === 'confirmed' ? (
                                    <FieldDescription>
                                        {m.project_timezone_viewer_note()}
                                    </FieldDescription>
                                ) : null}
                            </Field>
                        }
                    />

                    {error ? (
                        <Alert role="alert" variant="destructive">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    ) : null}

                    {canEditRole ? (
                        <SettingsRow
                            title={m.project_timezone_title()}
                            control={
                                <Button disabled={!canEdit || pending || !isDirty} type="submit">
                                    {m.project_timezone_save()}
                                </Button>
                            }
                        />
                    ) : null}
                </form>
            </SettingsCard>
        </SettingsSection>
    )
}
