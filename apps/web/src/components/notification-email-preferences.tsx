import { Button } from '@postbot/ui/components/button'
import { Field, FieldContent, FieldDescription, FieldTitle } from '@postbot/ui/components/field'
import { Switch } from '@postbot/ui/components/switch'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, formatApiError } from '@/lib/api'
import * as m from '@/paraglide/messages.js'

export function NotificationEmailPreferences({
    projectId,
    projectName,
}: {
    projectId: string | null
    projectName: string | null
}) {
    const [verificationRequested, setVerificationRequested] = useState(false)
    const [working, setWorking] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const query = useQuery({
        queryKey: ['email-alerts', projectId],
        queryFn: () => api.getProjectEmailAlerts(projectId!),
        enabled: projectId !== null,
        retry: false,
        refetchOnWindowFocus: false,
    })
    if (projectId === null)
        return (
            <p className="px-4 pb-4 text-sm text-muted-foreground">
                {m.notification_email_choose_project()}
            </p>
        )
    const value = query.data
    const change = async (enabled: boolean) => {
        setWorking(true)
        setError(null)
        try {
            await api.setProjectEmailAlerts(projectId, enabled)
            await query.refetch()
        } catch (caught) {
            setError(formatApiError(caught))
        } finally {
            setWorking(false)
        }
    }
    const requestVerification = async () => {
        if (value?.email === null || value?.email === undefined) return
        setWorking(true)
        setError(null)
        try {
            await api.sendAccountEmailVerification(value.email)
            setVerificationRequested(true)
        } catch (caught) {
            setError(formatApiError(caught))
        } finally {
            setWorking(false)
        }
    }
    return (
        <div className="px-4 pb-4">
            <Field orientation="horizontal">
                <FieldContent>
                    <FieldTitle>
                        {m.notification_email_title({ project: projectName ?? projectId })}
                    </FieldTitle>
                    <FieldDescription>
                        {value === undefined
                            ? m.common_loading()
                            : !value.available
                              ? m.notification_email_unavailable()
                              : !value.verified
                                ? m.notification_email_verify()
                                : m.notification_email_description({ email: value.email ?? '' })}
                    </FieldDescription>
                </FieldContent>
                <Switch
                    aria-label={m.notification_email_toggle()}
                    checked={value?.enabled ?? false}
                    disabled={
                        working ||
                        value === undefined ||
                        (!value.enabled && (!value.available || !value.verified))
                    }
                    onCheckedChange={enabled => void change(enabled)}
                />
            </Field>
            {value?.available && !value.verified && value.email !== null ? (
                <div className="mt-2">
                    {verificationRequested ? (
                        <>
                            <p role="status" className="text-sm text-muted-foreground">
                                {m.notification_email_verification_requested()}
                            </p>
                            <Button
                                variant="ghost"
                                size="sm"
                                disabled={working || query.isFetching}
                                onClick={() => void query.refetch()}>
                                {m.notification_email_check_verification()}
                            </Button>
                        </>
                    ) : (
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={working}
                            onClick={() => void requestVerification()}>
                            {m.notification_email_send_verification()}
                        </Button>
                    )}
                </div>
            ) : null}
            {value?.lastDeliveryState === 'failed' || value?.lastDeliveryState === 'ambiguous' ? (
                <p role="status" className="mt-2 text-sm text-state-failed">
                    {m.notification_email_delivery_failed()}
                </p>
            ) : null}
            {error !== null || query.isError ? (
                <div role="alert" className="mt-2 text-sm text-destructive">
                    {error ?? formatApiError(query.error)}
                    <Button variant="ghost" size="sm" onClick={() => void query.refetch()}>
                        {m.common_retry()}
                    </Button>
                </div>
            ) : null}
        </div>
    )
}
