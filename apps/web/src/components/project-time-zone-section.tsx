import { Alert, AlertDescription } from '@postdot/ui/components/alert'
import { Button } from '@postdot/ui/components/button'
import { Field, FieldDescription, FieldLabel } from '@postdot/ui/components/field'
import { toast } from '@postdot/ui/components/toast'
import { useRouter } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'

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
        <section
            aria-labelledby="project-timezone-title"
            className="mt-8 border-t border-border pt-6">
            <h2 className="font-heading text-lg font-medium" id="project-timezone-title">
                {m.project_timezone_title()}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {m.project_timezone_description()}
            </p>

            <form
                className="mt-4 flex max-w-md flex-col gap-3"
                onSubmit={e => void handleSubmit(e)}>
                <Field className="gap-1.5">
                    <FieldLabel htmlFor="project-timezone">{m.project_timezone_label()}</FieldLabel>
                    <TimeZoneCombobox
                        disabled={!canEdit || pending}
                        id="project-timezone"
                        label={m.project_timezone_label()}
                        onValueChange={setTimeZone}
                        value={timeZone}
                    />
                    {!canEditRole && access.status === 'confirmed' ? (
                        <FieldDescription>{m.project_timezone_viewer_note()}</FieldDescription>
                    ) : null}
                </Field>

                {error ? (
                    <Alert role="alert" variant="destructive">
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                ) : null}

                {canEditRole ? (
                    <div>
                        <Button disabled={!canEdit || pending || !isDirty} type="submit">
                            {m.project_timezone_save()}
                        </Button>
                    </div>
                ) : null}
            </form>
        </section>
    )
}
