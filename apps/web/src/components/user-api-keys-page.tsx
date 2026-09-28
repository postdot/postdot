import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { Badge } from '@herald/ui/components/badge'
import { Button } from '@herald/ui/components/button'
import {
    Combobox,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxItemIndicator,
    ComboboxLabel,
    ComboboxList,
    ComboboxPopup,
    ComboboxPortal,
    ComboboxPositioner,
    ComboboxTrigger,
    ComboboxValue,
} from '@herald/ui/components/combobox'
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@herald/ui/components/dialog'
import { Field, FieldLabel } from '@herald/ui/components/field'
import { Input } from '@herald/ui/components/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@herald/ui/components/select'
import { AddIcon } from '@solar-icons/react/linear/add'
import { CopyIcon } from '@solar-icons/react/linear/copy'
import { KeyMinimalisticIcon } from '@solar-icons/react/linear/key-minimalistic'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/linear/trash-bin-minimalistic'
import {
    useEffect,
    useMemo,
    useState,
    type Dispatch,
    type FormEvent,
    type SetStateAction,
} from 'react'

import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { EmptyState } from '@/components/empty-state'
import {
    api,
    formatApiError,
    type Project,
    type UserApiKey,
    type UserApiKeyCapability,
} from '@/lib/api'
import { useDashboardGlobal } from '@/lib/dashboard-context'
import { formatDateTime } from '@/lib/format'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

const keyExpirationDays = [30, 90, 180, 365] as const
const millisecondsPerDay = 24 * 60 * 60 * 1_000

type KeyScope = 'all' | 'selected'
type ActionScope = 'all' | 'selected'

export function UserApiKeysPage() {
    const { locale } = useLanguage()
    const { projects } = useDashboardGlobal()
    const [keys, setKeys] = useState<UserApiKey[] | null>(null)
    const [name, setName] = useState('')
    const [scope, setScope] = useState<KeyScope>('all')
    const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([])
    const [actionScope, setActionScope] = useState<ActionScope>('all')
    const [selectedCapabilities, setSelectedCapabilities] = useState<UserApiKeyCapability[]>([])
    const [expirationDays, setExpirationDays] = useState('180')
    const [createdKey, setCreatedKey] = useState<{ name: string; token: string } | null>(null)
    const [keyToRevoke, setKeyToRevoke] = useState<UserApiKey | null>(null)
    const [keyToEditActions, setKeyToEditActions] = useState<UserApiKey | null>(null)
    const [createOpen, setCreateOpen] = useState(false)
    const [copied, setCopied] = useState(false)
    const [copyError, setCopyError] = useState<string | null>(null)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const projectNames = useMemo(
        () => new Map(projects.map(project => [project.id, project.name])),
        [projects]
    )
    const selectedProjects = useMemo(
        () => projects.filter(project => selectedProjectIds.includes(project.id)),
        [projects, selectedProjectIds]
    )

    useEffect(() => {
        let cancelled = false
        setKeys(null)
        setError(null)
        void api
            .listUserApiKeys()
            .then(response => {
                if (!cancelled) setKeys(response.keys)
            })
            .catch(caughtError => {
                if (!cancelled) setError(formatApiError(caughtError))
            })
        return () => {
            cancelled = true
        }
    }, [])

    function resetCreateForm() {
        setName('')
        setScope('all')
        setSelectedProjectIds([])
        setActionScope('all')
        setSelectedCapabilities([])
        setExpirationDays('180')
    }

    async function handleCreate(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (
            (scope === 'selected' && selectedProjectIds.length === 0) ||
            (actionScope === 'selected' && selectedCapabilities.length === 0)
        ) {
            return
        }

        await runAction(async () => {
            const normalizedName = name.trim()
            const response = await api.createUserApiKey(
                normalizedName || undefined,
                scope === 'all' ? null : selectedProjectIds,
                Date.now() + Number(expirationDays) * millisecondsPerDay,
                actionScope === 'all' ? null : selectedCapabilities
            )
            setCreatedKey({ name: response.key.name, token: response.token })
            setCopied(false)
            setCopyError(null)
            setKeys(current => (current === null ? current : [response.key, ...current]))
            setCreateOpen(false)
            resetCreateForm()
        })
    }

    async function handleRevoke() {
        if (keyToRevoke === null) return
        const keyId = keyToRevoke.id
        await runAction(async () => {
            await api.revokeUserApiKey(keyId)
            setKeys(current => current?.filter(key => key.id !== keyId) ?? null)
            setKeyToRevoke(null)
        })
    }

    function beginEditActions(key: UserApiKey) {
        setKeyToEditActions(key)
        setActionScope(key.actionAccess === 'all' ? 'all' : 'selected')
        setSelectedCapabilities(key.actionAccess === 'all' ? [] : [...key.actionAccess])
    }

    async function handleUpdateActions(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (
            keyToEditActions === null ||
            (actionScope === 'selected' && selectedCapabilities.length === 0)
        ) {
            return
        }

        const keyId = keyToEditActions.id
        await runAction(async () => {
            const response = await api.updateUserApiKey(keyId, {
                actionAccess: actionScope === 'all' ? null : selectedCapabilities,
            })
            setKeys(current => current?.map(key => (key.id === keyId ? response.key : key)) ?? null)
            setKeyToEditActions(null)
        })
    }

    async function handleCopy() {
        if (createdKey === null) return
        setCopyError(null)
        try {
            await navigator.clipboard.writeText(createdKey.token)
            setCopied(true)
        } catch {
            setCopyError(m.api_keys_copy_unavailable())
        }
    }

    async function runAction(action: () => Promise<void>) {
        setError(null)
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
            <div className="mx-auto w-full max-w-6xl">
                <DashboardPageHeader
                    action={
                        <Button type="button" onClick={() => setCreateOpen(true)}>
                            <AddIcon aria-hidden="true" />
                            {m.api_keys_create()}
                        </Button>
                    }
                    description={m.api_keys_description()}
                    title={m.api_keys_title()}
                />

                {error ? (
                    <Alert className="mb-6" variant="destructive">
                        <AlertTitle>{m.access_action_failed()}</AlertTitle>
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                ) : null}

                {createdKey ? (
                    <section className="mb-8 bg-primary/10 p-5 shadow-surface sm:p-6">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <h2 className="font-heading text-base font-medium">
                                    {m.api_keys_created_for({ name: createdKey.name })}
                                </h2>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    {m.api_keys_show_once()}
                                </p>
                            </div>
                            <Badge>{m.api_keys_shown_once()}</Badge>
                        </div>
                        <code className="mt-4 block overflow-x-auto bg-background px-3 py-3 text-xs leading-5 shadow-field">
                            {createdKey.token}
                        </code>
                        {copyError ? (
                            <p className="mt-2 text-sm text-state-failed" role="alert">
                                {copyError}
                            </p>
                        ) : null}
                        <div className="mt-4 flex flex-wrap gap-2">
                            <Button type="button" size="sm" onClick={() => void handleCopy()}>
                                <CopyIcon aria-hidden="true" />
                                {copied ? m.api_keys_copied() : m.api_keys_copy()}
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setCreatedKey(null)}>
                                {m.api_keys_done()}
                            </Button>
                        </div>
                    </section>
                ) : null}

                {keys === null ? (
                    <p className="text-sm text-muted-foreground" role="status">
                        {m.api_keys_loading()}
                    </p>
                ) : keys.length === 0 ? (
                    <EmptyState
                        description={m.api_keys_empty_description()}
                        illustration="access"
                        title={m.api_keys_empty()}
                    />
                ) : (
                    <section aria-labelledby="user-api-keys-list" className="min-w-0">
                        <div className="flex items-center gap-3">
                            <KeyMinimalisticIcon
                                aria-hidden="true"
                                className="size-5 text-primary"
                            />
                            <h2
                                id="user-api-keys-list"
                                className="font-heading text-lg font-medium">
                                {m.api_keys_title()}
                            </h2>
                            <span className="text-xs tabular-nums text-muted-foreground">
                                {keys.length}
                            </span>
                        </div>
                        <ul className="mt-4 grid gap-2">
                            {keys.map(key => (
                                <li
                                    key={key.id}
                                    className="flex min-w-0 flex-col gap-4 bg-surface-inset/45 px-4 py-4 shadow-surface sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <span className="truncate text-sm font-medium">
                                                {key.name}
                                            </span>
                                            <Badge>{m.api_keys_active()}</Badge>
                                        </div>
                                        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                                            {key.tokenPrefix} ·{' '}
                                            {key.expiresAt === null
                                                ? m.common_never_expires()
                                                : m.common_expires_on({
                                                      date: formatDateTime(
                                                          key.expiresAt,
                                                          'UTC',
                                                          locale
                                                      ),
                                                  })}
                                        </p>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {key.projectAccess === 'all'
                                                ? m.api_keys_scope_all()
                                                : m.api_keys_scope_selected({
                                                      count: key.projectAccess.length,
                                                      projects: key.projectAccess
                                                          .map(id => projectNames.get(id) ?? id)
                                                          .join(', '),
                                                  })}
                                        </p>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {key.actionAccess === 'all'
                                                ? m.api_keys_action_access_all_summary()
                                                : m.api_keys_action_access_summary({
                                                      actions: key.actionAccess
                                                          .map(capabilityLabel)
                                                          .join(', '),
                                                  })}
                                        </p>
                                    </div>
                                    <div className="flex shrink-0 flex-wrap gap-2">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            disabled={pending}
                                            onClick={() => beginEditActions(key)}>
                                            {m.api_keys_edit_actions()}
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            disabled={pending}
                                            onClick={() => setKeyToRevoke(key)}>
                                            <TrashBinMinimalisticIcon aria-hidden="true" />
                                            {m.api_keys_revoke()}
                                        </Button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}
            </div>

            <Dialog
                open={createOpen}
                onOpenChange={open => {
                    if (!open && !pending) {
                        setCreateOpen(false)
                        resetCreateForm()
                    }
                }}>
                <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>{m.api_keys_create()}</DialogTitle>
                        <DialogDescription className="sr-only">
                            {m.api_keys_create_description()}
                        </DialogDescription>
                    </DialogHeader>
                    <form className="grid gap-4" onSubmit={handleCreate}>
                        <Field className="gap-1.5">
                            <FieldLabel htmlFor="user-api-key-name">{m.api_keys_name()}</FieldLabel>
                            <Input
                                id="user-api-key-name"
                                maxLength={100}
                                onChange={event => setName(event.target.value)}
                                placeholder={m.api_keys_name_placeholder()}
                                value={name}
                            />
                        </Field>
                        <fieldset className="grid gap-2">
                            <legend className="text-sm font-medium">{m.api_keys_scope()} :</legend>
                            <label
                                className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors focus-within:ring-3 focus-within:ring-ring/50 ${scope === 'all' ? 'bg-secondary' : 'bg-surface-control hover:bg-muted'}`}>
                                <input
                                    checked={scope === 'all'}
                                    className="size-4 accent-primary"
                                    name="user-api-key-scope"
                                    onChange={() => setScope('all')}
                                    type="radio"
                                    value="all"
                                />
                                <span className="min-w-0 truncate font-medium">
                                    {m.api_keys_scope_all()}
                                </span>
                            </label>
                            <label
                                className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors focus-within:ring-3 focus-within:ring-ring/50 ${scope === 'selected' ? 'bg-secondary' : 'bg-surface-control hover:bg-muted'}`}>
                                <input
                                    checked={scope === 'selected'}
                                    className="size-4 accent-primary"
                                    name="user-api-key-scope"
                                    onChange={() => setScope('selected')}
                                    type="radio"
                                    value="selected"
                                />
                                <span className="min-w-0 truncate font-medium">
                                    {m.api_keys_scope_selected_label()}
                                </span>
                            </label>
                        </fieldset>

                        {scope === 'selected' ? (
                            <div className="grid gap-1.5">
                                <Combobox
                                    autoHighlight
                                    items={projects}
                                    itemToStringLabel={(project: Project) => project.name}
                                    multiple
                                    onValueChange={values =>
                                        setSelectedProjectIds(values.map(project => project.id))
                                    }
                                    value={selectedProjects}>
                                    <ComboboxLabel className="sr-only">
                                        {m.api_keys_projects_placeholder()}
                                    </ComboboxLabel>
                                    <ComboboxTrigger
                                        aria-label={m.api_keys_projects_placeholder()}
                                        className="bg-surface-control">
                                        <ComboboxValue
                                            placeholder={m.api_keys_projects_placeholder()}>
                                            {(items: Project[]) => (
                                                <span className="min-w-0 flex-1 truncate text-left">
                                                    {items.length === 0
                                                        ? m.api_keys_projects_placeholder()
                                                        : items.length === 1
                                                          ? items[0]?.name
                                                          : m.api_keys_projects_selected({
                                                                count: items.length,
                                                            })}
                                                </span>
                                            )}
                                        </ComboboxValue>
                                    </ComboboxTrigger>
                                    <ComboboxPortal>
                                        <ComboboxPositioner align="start" sideOffset={4}>
                                            <ComboboxPopup>
                                                <div className="p-2">
                                                    <ComboboxInput
                                                        aria-label={m.api_keys_projects_search()}
                                                        placeholder={m.api_keys_projects_search()}
                                                    />
                                                </div>
                                                <ComboboxList>
                                                    {(project, index) => (
                                                        <ComboboxItem
                                                            index={index}
                                                            key={project.id}
                                                            value={project}>
                                                            <span className="min-w-0 flex-1 truncate">
                                                                {project.name}
                                                            </span>
                                                            <ComboboxItemIndicator />
                                                        </ComboboxItem>
                                                    )}
                                                </ComboboxList>
                                                <ComboboxEmpty>
                                                    <div className="px-3 py-4 text-center">
                                                        {m.api_keys_no_projects()}
                                                    </div>
                                                </ComboboxEmpty>
                                            </ComboboxPopup>
                                        </ComboboxPositioner>
                                    </ComboboxPortal>
                                </Combobox>
                            </div>
                        ) : null}

                        <ApiKeyActionAccessFieldset
                            name="create"
                            scope={actionScope}
                            selectedCapabilities={selectedCapabilities}
                            onScopeChange={setActionScope}
                            onCapabilitiesChange={setSelectedCapabilities}
                        />

                        <Field className="gap-1.5">
                            <FieldLabel htmlFor="user-api-key-expiration">
                                {m.api_keys_expiration()}
                            </FieldLabel>
                            <Select
                                value={expirationDays}
                                onValueChange={value => {
                                    if (value !== null) setExpirationDays(value)
                                }}>
                                <SelectTrigger id="user-api-key-expiration">
                                    <SelectValue>
                                        {expirationLabel(
                                            keyExpirationDays.find(
                                                days => String(days) === expirationDays
                                            ) ?? 180
                                        )}
                                    </SelectValue>
                                </SelectTrigger>
                                <SelectContent align="start">
                                    {keyExpirationDays.map(days => (
                                        <SelectItem key={days} value={String(days)}>
                                            {expirationLabel(days)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </Field>

                        <DialogFooter>
                            <DialogClose render={<Button type="button" variant="ghost" />}>
                                {m.common_cancel()}
                            </DialogClose>
                            <Button
                                type="submit"
                                disabled={
                                    pending ||
                                    (scope === 'selected' && selectedProjectIds.length === 0) ||
                                    (actionScope === 'selected' &&
                                        selectedCapabilities.length === 0)
                                }>
                                <AddIcon aria-hidden="true" />
                                {m.api_keys_create()}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog
                open={keyToEditActions !== null}
                onOpenChange={open => !open && !pending && setKeyToEditActions(null)}>
                <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>{m.api_keys_edit_actions_title()}</DialogTitle>
                        <DialogDescription>{keyToEditActions?.name ?? ''}</DialogDescription>
                    </DialogHeader>
                    <form className="grid gap-4" onSubmit={handleUpdateActions}>
                        <ApiKeyActionAccessFieldset
                            name="edit"
                            scope={actionScope}
                            selectedCapabilities={selectedCapabilities}
                            onScopeChange={setActionScope}
                            onCapabilitiesChange={setSelectedCapabilities}
                        />
                        <DialogFooter>
                            <Button
                                type="button"
                                variant="ghost"
                                disabled={pending}
                                onClick={() => setKeyToEditActions(null)}>
                                {m.common_cancel()}
                            </Button>
                            <Button
                                type="submit"
                                disabled={
                                    pending ||
                                    (actionScope === 'selected' &&
                                        selectedCapabilities.length === 0)
                                }>
                                {m.api_keys_save_actions()}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog
                open={keyToRevoke !== null}
                onOpenChange={open => !open && setKeyToRevoke(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{m.api_keys_revoke_title()}</DialogTitle>
                        <DialogDescription>
                            {m.api_keys_revoke_description({ name: keyToRevoke?.name ?? '' })}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <DialogClose render={<Button type="button" variant="ghost" />}>
                            {m.common_cancel()}
                        </DialogClose>
                        <Button
                            type="button"
                            variant="destructive"
                            disabled={pending}
                            onClick={() => void handleRevoke()}>
                            <TrashBinMinimalisticIcon aria-hidden="true" />
                            {m.api_keys_revoke()}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </main>
    )
}

const editableCapabilities: readonly UserApiKeyCapability[] = [
    'project:read',
    'publication:manage',
    'publication:dispatch',
    'channel:manage',
    'media:manage',
    'analytics:refresh',
    'media:permanently_delete',
]

function capabilityLabel(capability: UserApiKeyCapability) {
    switch (capability) {
        case 'project:read':
            return m.api_keys_action_read_project()
        case 'publication:manage':
            return m.api_keys_action_manage_publications()
        case 'publication:dispatch':
            return m.api_keys_action_dispatch_publications()
        case 'channel:manage':
            return m.api_keys_action_manage_channels()
        case 'media:manage':
            return m.api_keys_action_manage_media()
        case 'analytics:refresh':
            return m.api_keys_action_refresh_analytics()
        case 'media:permanently_delete':
            return m.api_keys_action_delete_media()
    }
}

function ApiKeyActionAccessFieldset({
    name,
    scope,
    selectedCapabilities,
    onScopeChange,
    onCapabilitiesChange,
}: {
    readonly name: string
    readonly scope: ActionScope
    readonly selectedCapabilities: readonly UserApiKeyCapability[]
    readonly onScopeChange: (scope: ActionScope) => void
    readonly onCapabilitiesChange: Dispatch<SetStateAction<UserApiKeyCapability[]>>
}) {
    return (
        <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">{m.api_keys_action_access()}</legend>
            <label
                className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors focus-within:ring-3 focus-within:ring-ring/50 ${scope === 'all' ? 'bg-secondary' : 'bg-surface-control hover:bg-muted'}`}>
                <input
                    checked={scope === 'all'}
                    className="size-4 accent-primary"
                    name={`user-api-key-actions-${name}`}
                    onChange={() => onScopeChange('all')}
                    type="radio"
                    value="all"
                />
                <span className="min-w-0 truncate font-medium">
                    {m.api_keys_action_access_all()}
                </span>
            </label>
            <label
                className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors focus-within:ring-3 focus-within:ring-ring/50 ${scope === 'selected' ? 'bg-secondary' : 'bg-surface-control hover:bg-muted'}`}>
                <input
                    checked={scope === 'selected'}
                    className="size-4 accent-primary"
                    name={`user-api-key-actions-${name}`}
                    onChange={() => onScopeChange('selected')}
                    type="radio"
                    value="selected"
                />
                <span className="min-w-0 truncate font-medium">
                    {m.api_keys_action_access_selected()}
                </span>
            </label>
            {scope === 'selected' ? (
                <div className="grid max-h-48 gap-1 overflow-y-auto rounded-md bg-surface-inset/45 p-1">
                    {editableCapabilities.map(capability => (
                        <label
                            className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted focus-within:ring-3 focus-within:ring-ring/50"
                            key={capability}>
                            <input
                                checked={selectedCapabilities.includes(capability)}
                                className="size-4 shrink-0 accent-primary"
                                onChange={() =>
                                    onCapabilitiesChange(current =>
                                        current.includes(capability)
                                            ? current.filter(item => item !== capability)
                                            : [...current, capability]
                                    )
                                }
                                type="checkbox"
                                value={capability}
                            />
                            <span className="min-w-0">{capabilityLabel(capability)}</span>
                        </label>
                    ))}
                </div>
            ) : null}
        </fieldset>
    )
}

function expirationLabel(days: (typeof keyExpirationDays)[number]) {
    if (days === 30) return m.api_keys_expiration_30_days()
    if (days === 90) return m.api_keys_expiration_90_days()
    if (days === 365) return m.api_keys_expiration_365_days()
    return m.api_keys_expiration_180_days()
}
