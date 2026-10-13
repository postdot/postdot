import { Alert, AlertDescription, AlertTitle } from '@postbot/ui/components/alert'
import { Button } from '@postbot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@postbot/ui/components/dialog'
import { Field, FieldDescription, FieldLabel } from '@postbot/ui/components/field'
import { Input } from '@postbot/ui/components/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@postbot/ui/components/select'
import { Textarea } from '@postbot/ui/components/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@postbot/ui/components/tooltip'
import { AddIcon } from '@solar-icons/react/linear/add'
import { CheckIcon } from '@solar-icons/react/linear/check'
import { CodeFileIcon } from '@solar-icons/react/linear/code-file'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { ChannelAvatar } from '@/components/identity-visuals'
import {
    api,
    type ChannelCreationOutcome,
    type ChannelCreationProfile,
    type CustomChannelProfileInput,
    type ProfileDefinitionIssue,
    type RuntimeChannelProfile,
} from '@/lib/api'
import {
    channelNameExists,
    suggestChannelName,
    type ChannelIdentityPeer,
} from '@/lib/channel-identity'
import {
    builtInChannelProfileTemplatePrefix,
    channelProfileTemplates,
    profileForTemplate,
    templatesFromPresets,
} from '@/lib/channel-profile-presets'
import { useLanguage } from '@/lib/i18n'
import { profileIssueMessage } from '@/lib/profile-validation-feedback'
import * as m from '@/paraglide/messages.js'

type ProfileChoice =
    | 'manual-message'
    | 'linkedin'
    | 'bluesky'
    | 'mastodon'
    | 'x'
    | 'discord'
    | 'devto'
    | 'custom'

export function ChannelCreationDialog({
    onCreate,
    pending,
    channels = [],
    compact = false,
}: {
    readonly onCreate: (
        name: string,
        profile: ChannelCreationProfile
    ) => Promise<ChannelCreationOutcome>
    readonly pending: boolean
    readonly channels?: readonly ChannelIdentityPeer[]
    readonly compact?: boolean
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
    const [nameEdited, setNameEdited] = useState(false)
    const [choice, setChoice] = useState<ProfileChoice>('manual-message')
    const [templateId, setTemplateId] = useState(channelProfileTemplates[0]?.id ?? '')
    const [profileText, setProfileText] = useState('')
    const [validationError, setValidationError] = useState<string | null>(null)
    const [definitionIssues, setDefinitionIssues] = useState<readonly ProfileDefinitionIssue[]>([])
    const [definitionIssueCount, setDefinitionIssueCount] = useState(0)

    function reset() {
        setName('')
        setNameEdited(false)
        setChoice('manual-message')
        setTemplateId(channelProfileTemplates[0]?.id ?? '')
        setProfileText('')
        setValidationError(null)
        setDefinitionIssues([])
        setDefinitionIssueCount(0)
    }

    function selectCustomTemplate(value: string | null) {
        if (value === null) return
        setTemplateId(value)
        const profile = profileForTemplate(value, templates)
        if (profile !== undefined) setProfileText(creationTextForTemplate(profile))
        setValidationError(null)
        setDefinitionIssues([])
        setDefinitionIssueCount(0)
    }

    function selectProfile(nextChoice: ProfileChoice) {
        if (nextChoice !== choice) {
            setValidationError(null)
            setDefinitionIssues([])
            setDefinitionIssueCount(0)
        }
        setChoice(nextChoice)
        if (!nameEdited) setName(suggestedName(nextChoice))
        if (nextChoice === 'custom' && profileText === '') {
            const profile = profileForTemplate(templateId, templates)
            if (profile !== undefined) setProfileText(creationTextForTemplate(profile))
        }
    }

    async function submit() {
        const trimmedName = name.trim()
        if (trimmedName === '') {
            setValidationError(m.channel_name_required())
            return
        }

        if (
            channelNameExists(
                trimmedName,
                channels.map(channel => channel.name)
            )
        ) {
            setValidationError(m.channel_name_exists())
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
                profile = parsed as CustomChannelProfileInput
            } catch {
                setValidationError(m.channel_custom_profile_invalid())
                return
            }
        }

        setValidationError(null)
        setDefinitionIssues([])
        setDefinitionIssueCount(0)
        const outcome = await onCreate(trimmedName, profile)
        if (outcome.created) {
            reset()
            setOpen(false)
        } else if (outcome.profileIssues.length > 0) {
            setDefinitionIssues(outcome.profileIssues)
            setDefinitionIssueCount(outcome.profileIssueCount)
        }
    }

    const profileChoices: readonly { value: ProfileChoice; label: string }[] = [
        { value: 'manual-message', label: m.channel_manual_profile() },
        { value: 'linkedin', label: m.channel_linkedin_profile() },
        { value: 'bluesky', label: m.channel_bluesky_profile() },
        { value: 'mastodon', label: m.channel_mastodon_profile() },
        { value: 'x', label: m.channel_x_profile() },
        { value: 'discord', label: m.channel_discord_profile() },
        { value: 'devto', label: m.channel_devto_profile() },
        { value: 'custom', label: m.channel_custom_profile() },
    ]

    function suggestedName(profile: ProfileChoice) {
        if (profile === 'custom') return ''
        const platformNames = {
            linkedin: 'LinkedIn',
            bluesky: 'Bluesky',
            mastodon: 'Mastodon',
            x: 'X.com',
            discord: 'Discord',
            devto: 'DEV.to',
            'manual-message': m.channel_default_manual_name(),
        }
        const label = platformNames[profile]
        return suggestChannelName(
            label,
            channels.map(channel => channel.name),
            channels.filter(channel => channel.profileId === profile).length
        )
    }

    function openDialog() {
        reset()
        setName(suggestedName('manual-message'))
        setOpen(true)
    }

    return (
        <>
            {compact ? (
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                className="size-11 rounded-md bg-surface-control p-0 shadow-control hover:bg-surface-control-hover"
                                aria-label={m.channel_add()}
                                onClick={openDialog}>
                                <AddIcon aria-hidden="true" />
                            </Button>
                        }
                    />
                    <TooltipContent>{m.channel_add()}</TooltipContent>
                </Tooltip>
            ) : (
                <Button type="button" onClick={openDialog}>
                    <AddIcon aria-hidden="true" />
                    {m.channel_add()}
                </Button>
            )}
            <Dialog
                open={open}
                onOpenChange={nextOpen => {
                    setOpen(nextOpen)
                    if (!nextOpen) reset()
                }}>
                <DialogContent
                    aria-describedby={undefined}
                    className="max-h-[min(42rem,calc(100dvh-2rem))] w-[calc(100%-2rem)] max-w-2xl overflow-x-hidden overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{m.channel_create_title()}</DialogTitle>
                    </DialogHeader>

                    <div className="grid gap-5">
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

                        <Field className="gap-1.5">
                            <FieldLabel htmlFor="new-channel-name">{m.channel_name()}</FieldLabel>
                            <Input
                                id="new-channel-name"
                                value={name}
                                onChange={event => {
                                    setName(event.target.value)
                                    setNameEdited(true)
                                    setValidationError(null)
                                    setDefinitionIssues([])
                                    setDefinitionIssueCount(0)
                                }}
                                placeholder={m.channel_name_placeholder()}
                            />
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
                                        onChange={event => {
                                            setProfileText(event.target.value)
                                            setValidationError(null)
                                            setDefinitionIssues([])
                                            setDefinitionIssueCount(0)
                                        }}
                                        onFocus={() => {
                                            if (profileText !== '') return
                                            const profile = profileForTemplate(
                                                templateId,
                                                templates
                                            )
                                            if (profile !== undefined)
                                                setProfileText(creationTextForTemplate(profile))
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

                        {definitionIssues.length > 0 ? (
                            <Alert variant="destructive">
                                <AlertTitle>{m.profile_definition_invalid()}</AlertTitle>
                                <AlertDescription>
                                    <ul className="space-y-2">
                                        {definitionIssues.map((issue, index) => (
                                            <li key={`${issue.path}:${issue.code}:${index}`}>
                                                <code className="block break-all text-xs">
                                                    {issue.path || m.profile_definition_root()}
                                                </code>
                                                <span>{profileIssueMessage(issue.code)}</span>
                                            </li>
                                        ))}
                                    </ul>
                                    {definitionIssueCount > definitionIssues.length ? (
                                        <p className="mt-2">
                                            {m.profile_issue_more({
                                                count:
                                                    definitionIssueCount - definitionIssues.length,
                                            })}
                                        </p>
                                    ) : null}
                                </AlertDescription>
                            </Alert>
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

/**
 * Fingerprints are derived on the server when the channel is created, so the
 * editable starter omits them while keeping the declared identity, origin and
 * version the operator owns.
 */
function creationTextForTemplate(profile: RuntimeChannelProfile): string {
    const { profileHash: _profileHash, schemaHash: _schemaHash, ...authored } = profile
    return JSON.stringify(authored, null, 2)
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
