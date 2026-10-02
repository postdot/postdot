import { Button } from '@herald/ui/components/button'
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@herald/ui/components/dialog'
import { Field, FieldLabel } from '@herald/ui/components/field'
import { Input } from '@herald/ui/components/input'
import { CameraIcon } from '@solar-icons/react/linear/camera'
import { CloseIcon } from '@solar-icons/react/linear/close'
import { EyeIcon } from '@solar-icons/react/linear/eye'
import { EyeClosedIcon } from '@solar-icons/react/linear/eye-closed'
import { KeyMinimalisticIcon } from '@solar-icons/react/linear/key-minimalistic'
import { useRouter } from '@tanstack/react-router'
import { useRef, useState, type FormEvent } from 'react'

import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { UserAvatar } from '@/components/identity-visuals'
import { api, ApiError, formatApiError } from '@/lib/api'
import { useDashboardGlobal } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export function UserAccountPage() {
    useLanguage()
    const { session } = useDashboardGlobal()
    const router = useRouter()
    const [name, setName] = useState(session.user.name)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const fileInput = useRef<HTMLInputElement>(null)

    async function update(action: () => Promise<unknown>, message: string) {
        setPending(true)
        setError(null)
        setNotice(null)
        try {
            await action()
            await router.invalidate()
            setNotice(message)
        } catch (caught) {
            setError(
                caught instanceof ApiError &&
                    (['avatar_format', 'avatar_size'].includes(caught.code) ||
                        caught.status === 413)
                    ? m.account_photo_format()
                    : formatApiError(caught)
            )
        } finally {
            setPending(false)
        }
    }

    return (
        <main className="min-w-0 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
            <DashboardPageHeader centered title={m.nav_preferences_account()} />
            <div className="mx-auto grid max-w-xl gap-5">
                <section
                    aria-label={m.account_profile()}
                    className="rounded-md bg-surface-raised p-5 shadow-surface sm:p-6">
                    <form
                        aria-busy={pending}
                        onSubmit={(event: FormEvent) => {
                            event.preventDefault()
                            void update(() => api.updateProfile(name), m.account_saved())
                        }}>
                        <div className="flex items-start gap-4 sm:gap-5">
                            <div className="relative size-16 shrink-0 [&_[data-slot=avatar]]:size-16">
                                <UserAvatar
                                    imageUrl={session.user.image}
                                    name={session.user.name}
                                    seed={session.user.id}
                                    size="lg"
                                />
                                <Button
                                    aria-label={m.account_change_photo()}
                                    title={m.account_change_photo()}
                                    className="absolute -right-1 -bottom-1 bg-surface-control shadow-control"
                                    disabled={pending}
                                    onClick={() => fileInput.current?.click()}
                                    size="icon-sm"
                                    type="button"
                                    variant="secondary">
                                    <CameraIcon aria-hidden="true" />
                                </Button>
                            </div>
                            <div className="min-w-0 flex-1">
                                <Field>
                                    <FieldLabel htmlFor="account-name">
                                        {m.account_name()}
                                    </FieldLabel>
                                    <Input
                                        autoComplete="name"
                                        disabled={pending}
                                        id="account-name"
                                        maxLength={100}
                                        onChange={event => {
                                            setName(event.target.value)
                                            setNotice(null)
                                        }}
                                        required
                                        value={name}
                                    />
                                </Field>
                                <p className="mt-2 break-all text-sm text-muted-foreground">
                                    {session.user.email}
                                </p>
                            </div>
                        </div>
                        <input
                            accept="image/png,image/jpeg,image/webp"
                            aria-label={m.account_change_photo()}
                            className="sr-only"
                            disabled={pending}
                            onChange={event => {
                                const file = event.target.files?.[0]
                                event.target.value = ''
                                if (!file) return
                                if (file.size > 5 * 1024 * 1024) {
                                    setError(m.account_photo_format())
                                    return
                                }
                                void update(() => api.uploadAvatar(file), m.account_photo_saved())
                            }}
                            ref={fileInput}
                            tabIndex={-1}
                            type="file"
                        />
                        {session.user.image || name.trim() !== session.user.name ? (
                            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                                {session.user.image ? (
                                    <Button
                                        disabled={pending}
                                        onClick={() =>
                                            void update(
                                                () => api.removeAvatar(),
                                                m.account_photo_removed()
                                            )
                                        }
                                        size="sm"
                                        type="button"
                                        variant="ghost">
                                        {m.account_remove_photo()}
                                    </Button>
                                ) : (
                                    <span />
                                )}
                                {name.trim() !== session.user.name ? (
                                    <Button
                                        disabled={
                                            pending ||
                                            name.trim() === '' ||
                                            name.trim() === session.user.name
                                        }
                                        size="sm"
                                        type="submit">
                                        {m.account_save()}
                                    </Button>
                                ) : null}
                            </div>
                        ) : null}
                        {error ? (
                            <p className="mt-3 text-sm text-state-failed" role="alert">
                                {error}
                            </p>
                        ) : null}
                        {notice ? (
                            <p className="mt-3 text-sm text-state-success" role="status">
                                {notice}
                            </p>
                        ) : null}
                    </form>
                </section>
                <section
                    aria-label={m.account_security()}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-surface-raised p-5 shadow-surface sm:p-6">
                    <h2 className="flex items-center gap-2 font-heading text-base font-medium">
                        <KeyMinimalisticIcon
                            aria-hidden="true"
                            className="size-5 text-muted-foreground"
                        />
                        {m.account_security()}
                    </h2>
                    <PasswordChangeDialog />
                </section>
            </div>
        </main>
    )
}

function PasswordChangeDialog() {
    const [open, setOpen] = useState(false)
    const [currentPassword, setCurrentPassword] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [confirmation, setConfirmation] = useState('')
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [complete, setComplete] = useState(false)

    async function submit(event: FormEvent) {
        event.preventDefault()
        setError(null)
        if (newPassword !== confirmation) {
            setError(m.auth_password_reset_mismatch())
            return
        }
        setPending(true)
        try {
            await api.changePassword(currentPassword, newPassword)
            setCurrentPassword('')
            setNewPassword('')
            setConfirmation('')
            setOpen(false)
            setComplete(true)
        } catch (caught) {
            setError(
                caught instanceof ApiError && caught.code === 'INVALID_PASSWORD'
                    ? m.account_password_invalid()
                    : m.account_password_failed()
            )
        } finally {
            setPending(false)
        }
    }

    return (
        <div className="text-right">
            <Dialog
                onOpenChange={next => {
                    if (pending) return
                    setOpen(next)
                    setError(null)
                    setCurrentPassword('')
                    setNewPassword('')
                    setConfirmation('')
                }}
                open={open}>
                <DialogTrigger render={<Button size="sm" variant="secondary" />}>
                    {m.account_change_password()}
                </DialogTrigger>
                <DialogContent
                    className="bg-surface-raised"
                    aria-describedby="account-password-consequence"
                    showCloseButton={false}>
                    {!pending ? (
                        <DialogClose
                            render={
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={m.common_close()}
                                    className="absolute top-2 right-2"
                                />
                            }>
                            <CloseIcon aria-hidden="true" />
                        </DialogClose>
                    ) : null}
                    <DialogHeader>
                        <DialogTitle>{m.account_change_password()}</DialogTitle>
                        <DialogDescription id="account-password-consequence">
                            {m.account_password_consequence()}
                        </DialogDescription>
                    </DialogHeader>
                    <form
                        aria-busy={pending}
                        className="grid gap-4"
                        onSubmit={event => void submit(event)}>
                        <AccountPasswordField
                            id="account-current-password"
                            label={m.account_current_password()}
                            autoComplete="current-password"
                            value={currentPassword}
                            onChange={setCurrentPassword}
                            disabled={pending}
                        />
                        <AccountPasswordField
                            id="account-new-password"
                            label={m.account_new_password()}
                            autoComplete="new-password"
                            value={newPassword}
                            onChange={setNewPassword}
                            disabled={pending}
                            minLength={8}
                            maxLength={128}
                        />
                        <AccountPasswordField
                            id="account-confirm-password"
                            label={m.account_confirm_password()}
                            autoComplete="new-password"
                            value={confirmation}
                            onChange={setConfirmation}
                            disabled={pending}
                            minLength={8}
                            maxLength={128}
                        />
                        {error ? (
                            <p className="text-sm text-state-failed" role="alert">
                                {error}
                            </p>
                        ) : null}
                        <DialogFooter className="bg-transparent">
                            <Button disabled={pending} type="submit">
                                {m.account_change_password()}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
            {complete ? (
                <p className="mt-2 text-sm text-state-success" role="status">
                    {m.account_password_changed()}
                </p>
            ) : null}
        </div>
    )
}

function AccountPasswordField({
    id,
    label,
    autoComplete,
    value,
    onChange,
    disabled,
    minLength,
    maxLength,
}: {
    readonly id: string
    readonly label: string
    readonly autoComplete: 'current-password' | 'new-password'
    readonly value: string
    readonly onChange: (value: string) => void
    readonly disabled: boolean
    readonly minLength?: number
    readonly maxLength?: number
}) {
    const [visible, setVisible] = useState(false)
    return (
        <Field>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            <div className="relative">
                <Input
                    id={id}
                    autoComplete={autoComplete}
                    value={value}
                    onChange={event => onChange(event.target.value)}
                    type={visible ? 'text' : 'password'}
                    required
                    disabled={disabled}
                    minLength={minLength}
                    maxLength={maxLength}
                    className="pr-10"
                />
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    aria-controls={id}
                    aria-pressed={visible}
                    aria-label={`${visible ? m.auth_hide_password() : m.auth_show_password()}: ${label}`}
                    className="absolute top-1 right-1 z-10 text-muted-foreground"
                    onClick={() => setVisible(current => !current)}>
                    {visible ? (
                        <EyeClosedIcon aria-hidden="true" />
                    ) : (
                        <EyeIcon aria-hidden="true" />
                    )}
                </Button>
            </div>
        </Field>
    )
}
