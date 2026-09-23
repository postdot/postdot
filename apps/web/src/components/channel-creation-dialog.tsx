import { Button } from '@herald/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@herald/ui/components/dialog'
import { Field, FieldDescription, FieldLabel } from '@herald/ui/components/field'
import { Input } from '@herald/ui/components/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@herald/ui/components/select'
import { Textarea } from '@herald/ui/components/textarea'
import { AddIcon } from '@solar-icons/react/linear/add'
import { CheckIcon } from '@solar-icons/react/linear/check'
import { CodeFileIcon } from '@solar-icons/react/linear/code-file'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { ChannelAvatar } from '@/components/identity-visuals'
import { api, type ChannelCreationProfile, type RuntimeChannelProfile } from '@/lib/api'
import {
    builtInChannelProfileTemplatePrefix,
    channelProfileTemplates,
    profileForTemplate,
    templatesFromPresets,
} from '@/lib/channel-profile-presets'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

type ProfileChoice =
    | 'manual-message'
    | 'linkedin'
    | 'bluesky'
    | 'mastodon'
    | 'discord'
    | 'devto'
    | 'custom'

export function ChannelCreationDialog({
    onCreate,
    pending,
}: {
    readonly onCreate: (name: string, profile: ChannelCreationProfile) => Promise<boolean>
    readonly pending: boolean
}) {
    useLanguage()
    const presetsQuery = useQuery({
        queryKey: ['channel-profile-presets'],
        queryFn: () => api.listChannelProfilePresets(),
        staleTime: Number.POSITIVE_INFINITY,
        retry: 1,
    })
    const templates = useMemo(() => {
        const presets = presetsQuery.data?.presets
        return [
            ...channelProfileTemplates,
            ...(presets === undefined ? [] : templatesFromPresets(presets)),
        ]
    }, [presetsQuery.data?.presets])
    const templateItems = useMemo(
        () =>
            Object.fromEntries(
                templates.map(template => [template.id, templateLabel(template.id)])
            ),
        [templates]
    )
    const [open, setOpen] = useState(false)
    const [name, setName] = useState('')
    const [choice, setChoice] = useState<ProfileChoice>('manual-message')
    const [templateId, setTemplateId] = useState(channelProfileTemplates[0]?.id ?? '')
    const [profileText, setProfileText] = useState('')
    const [validationError, setValidationError] = useState<string | null>(null)

    function reset() {
        setName('')
        setChoice('manual-message')
        setTemplateId(channelProfileTemplates[0]?.id ?? '')
        setProfileText('')
        setValidationError(null)
    }

    function selectCustomTemplate(value: string | null) {
        if (value === null) return
        setTemplateId(value)
        const profile = profileForTemplate(value, templates)
        if (profile !== undefined) setProfileText(JSON.stringify(profile, null, 2))
        setValidationError(null)
    }

    function selectProfile(nextChoice: ProfileChoice) {
        setChoice(nextChoice)
        if (nextChoice === 'custom' && profileText === '') {
            const profile = profileForTemplate(templateId, templates)
            if (profile !== undefined) setProfileText(JSON.stringify(profile, null, 2))
        }
    }

    async function submit() {
        const trimmedName = name.trim()
        if (trimmedName === '') {
            setValidationError(m.channel_name_required())
            return
        }

        let profile: ChannelCreationProfile = choice === 'custom' ? 'manual-message' : choice
        if (choice === 'custom') {
            try {
                const parsed: unknown = JSON.parse(profileText)
                if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    setValidationError(m.channel_custom_profile_object())
                    return
                }
                profile = parsed as RuntimeChannelProfile
            } catch {
                setValidationError(m.channel_custom_profile_invalid())
                return
            }
        }

        setValidationError(null)
        const created = await onCreate(trimmedName, profile)
        if (created) {
            reset()
            setOpen(false)
        }
    }

    const profileChoices: readonly { value: ProfileChoice; label: string }[] = [
        { value: 'manual-message', label: m.channel_manual_profile() },
        { value: 'linkedin', label: m.channel_linkedin_profile() },
        { value: 'bluesky', label: m.channel_bluesky_profile() },
        { value: 'mastodon', label: m.channel_mastodon_profile() },
        { value: 'discord', label: m.channel_discord_profile() },
        { value: 'devto', label: m.channel_devto_profile() },
        { value: 'custom', label: m.channel_custom_profile() },
    ]

    return (
        <>
            <Button
                onClick={() => {
                    reset()
                    setOpen(true)
                }}>
                <AddIcon aria-hidden="true" />
                {m.channel_add()}
            </Button>
            <Dialog
                open={open}
                onOpenChange={nextOpen => {
                    setOpen(nextOpen)
                    if (!nextOpen) reset()
                }}>
                <DialogContent className="max-h-[min(42rem,calc(100dvh-2rem))] w-[calc(100%-2rem)] max-w-2xl overflow-x-hidden overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{m.channel_create_title()}</DialogTitle>
                        <DialogDescription>
                            {m.channel_creation_profile_description()}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-5">
                        <Field className="gap-1.5">
                            <FieldLabel htmlFor="new-channel-name">{m.channel_name()}</FieldLabel>
                            <Input
                                id="new-channel-name"
                                autoFocus
                                value={name}
                                onChange={event => setName(event.target.value)}
                                placeholder={m.channel_name_placeholder()}
                            />
                        </Field>

                        <Field className="gap-1.5">
                            <FieldLabel>{m.channel_profile()}</FieldLabel>
                            <div
                                className="grid gap-2 sm:grid-cols-2"
                                role="radiogroup"
                                aria-label={m.channel_profile()}>
                                {profileChoices.map(profile => (
                                    <ProfileChoiceButton
                                        key={profile.value}
                                        label={profile.label}
                                        selected={choice === profile.value}
                                        value={profile.value}
                                        onSelect={() => selectProfile(profile.value)}
                                    />
                                ))}
                            </div>
                        </Field>

                        {choice === 'custom' ? (
                            <div className="grid gap-4 rounded-lg bg-muted p-4">
                                <Field className="gap-1.5">
                                    <FieldLabel htmlFor="new-channel-template">
                                        {m.channel_starter_template()}
                                    </FieldLabel>
                                    <Select
                                        items={templateItems}
                                        value={templateId}
                                        onValueChange={selectCustomTemplate}>
                                        <SelectTrigger id="new-channel-template">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent align="start">
                                            {templates.map(template => (
                                                <SelectItem key={template.id} value={template.id}>
                                                    {templateLabel(template.id)}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FieldDescription>
                                        {templateDescription(templateId)}
                                    </FieldDescription>
                                </Field>
                                <Field className="gap-1.5">
                                    <FieldLabel htmlFor="new-channel-profile-json">
                                        {m.channel_custom_profile_json()}
                                    </FieldLabel>
                                    <Textarea
                                        id="new-channel-profile-json"
                                        value={profileText}
                                        onChange={event => setProfileText(event.target.value)}
                                        onFocus={() => {
                                            if (profileText !== '') return
                                            const profile = profileForTemplate(
                                                templateId,
                                                templates
                                            )
                                            if (profile !== undefined)
                                                setProfileText(JSON.stringify(profile, null, 2))
                                        }}
                                        spellCheck={false}
                                        rows={14}
                                        className="font-mono text-xs leading-5"
                                    />
                                    <FieldDescription>
                                        {m.channel_custom_profile_validation()}
                                    </FieldDescription>
                                </Field>
                            </div>
                        ) : null}

                        {validationError ? (
                            <p role="alert" className="text-sm text-destructive">
                                {validationError}
                            </p>
                        ) : null}
                    </div>

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                                reset()
                                setOpen(false)
                            }}
                            disabled={pending}>
                            {m.common_cancel()}
                        </Button>
                        <Button type="button" onClick={() => void submit()} disabled={pending}>
                            <CodeFileIcon aria-hidden="true" />
                            {m.channel_create_button()}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}

function ProfileChoiceButton({
    label,
    selected,
    value,
    onSelect,
}: {
    readonly label: string
    readonly selected: boolean
    readonly value: ProfileChoice
    readonly onSelect: () => void
}) {
    return (
        <Button
            type="button"
            role="radio"
            aria-checked={selected}
            variant="ghost"
            className={`h-auto min-h-10 min-w-0 justify-start overflow-hidden px-3 py-2 text-left ${
                selected
                    ? 'bg-surface-inset text-foreground shadow-field hover:bg-surface-inset'
                    : 'bg-surface-control/70 hover:bg-surface-control'
            }`}
            onClick={onSelect}>
            <ChannelAvatar
                channel={{ id: `profile:${value}`, name: label, profileId: value }}
                size="sm"
            />
            <span className="min-w-0 truncate">{label}</span>
            {selected ? (
                <CheckIcon aria-hidden="true" className="ml-auto shrink-0 text-primary" />
            ) : null}
        </Button>
    )
}

function templateLabel(templateId: string) {
    if (templateId === 'custom-manual') return m.channel_template_custom_manual_label()
    if (templateId === 'custom-webhook') return m.channel_template_custom_webhook_label()
    if (templateId.startsWith(builtInChannelProfileTemplatePrefix)) {
        const profileId = templateId.slice(builtInChannelProfileTemplatePrefix.length)
        if (profileId === 'linkedin') return m.channel_linkedin_profile()
        if (profileId === 'bluesky') return m.channel_bluesky_profile()
        if (profileId === 'mastodon') return m.channel_mastodon_profile()
        if (profileId === 'discord') return m.channel_discord_profile()
        if (profileId === 'devto') return m.channel_devto_profile()
        if (profileId === 'x') return m.channel_x_profile()
    }
    return templateId
}

function templateDescription(templateId: string) {
    if (templateId === 'custom-manual') return m.channel_template_custom_manual_description()
    if (templateId === 'custom-webhook') return m.channel_template_custom_webhook_description()
    if (templateId.startsWith(builtInChannelProfileTemplatePrefix))
        return m.channel_custom_profile_starter_description()
    return m.channel_custom_profile_fallback()
}
