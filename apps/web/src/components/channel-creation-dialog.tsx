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
import { AddIcon } from '@solar-icons/react/bold/add'
import { CodeFileIcon } from '@solar-icons/react/bold/code-file'
import { useState } from 'react'

import type { ChannelCreationProfile, RuntimeChannelProfile } from '@/lib/api'
import { channelProfileTemplates, profileForTemplate } from '@/lib/channel-profile-presets'
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
        const profile = profileForTemplate(value)
        if (profile !== undefined) setProfileText(JSON.stringify(profile, null, 2))
        setValidationError(null)
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

    return (
        <>
            <Button onClick={() => setOpen(true)}>
                <AddIcon aria-hidden="true" />
                {m.channel_add()}
            </Button>
            <Dialog
                open={open}
                onOpenChange={nextOpen => {
                    setOpen(nextOpen)
                    if (!nextOpen) reset()
                }}>
                <DialogContent className="max-h-[min(42rem,calc(100vh-2rem))] max-w-2xl overflow-y-auto">
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
                            <FieldLabel htmlFor="new-channel-profile">
                                {m.channel_profile()}
                            </FieldLabel>
                            <Select
                                items={{
                                    'manual-message': m.channel_manual_profile(),
                                    linkedin: m.channel_linkedin_profile(),
                                    bluesky: m.channel_bluesky_profile(),
                                    mastodon: m.channel_mastodon_profile(),
                                    discord: m.channel_discord_profile(),
                                    devto: m.channel_devto_profile(),
                                    custom: m.channel_custom_profile(),
                                }}
                                value={choice}
                                onValueChange={value => {
                                    const nextChoice = value as ProfileChoice
                                    setChoice(nextChoice)
                                    if (nextChoice === 'custom' && profileText === '') {
                                        const profile = profileForTemplate(templateId)
                                        if (profile !== undefined)
                                            setProfileText(JSON.stringify(profile, null, 2))
                                    }
                                }}>
                                <SelectTrigger id="new-channel-profile">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent align="start">
                                    <SelectItem value="manual-message">
                                        {m.channel_manual_profile()}
                                    </SelectItem>
                                    <SelectItem value="linkedin">
                                        {m.channel_linkedin_profile()}
                                    </SelectItem>
                                    <SelectItem value="bluesky">
                                        {m.channel_bluesky_profile()}
                                    </SelectItem>
                                    <SelectItem value="mastodon">
                                        {m.channel_mastodon_profile()}
                                    </SelectItem>
                                    <SelectItem value="discord">
                                        {m.channel_discord_profile()}
                                    </SelectItem>
                                    <SelectItem value="devto">
                                        {m.channel_devto_profile()}
                                    </SelectItem>
                                    <SelectItem value="custom">
                                        {m.channel_custom_profile()}
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </Field>

                        {choice === 'custom' ? (
                            <div className="grid gap-4 rounded-lg bg-muted p-4">
                                <Field className="gap-1.5">
                                    <FieldLabel htmlFor="new-channel-template">
                                        {m.channel_starter_template()}
                                    </FieldLabel>
                                    <Select value={templateId} onValueChange={selectCustomTemplate}>
                                        <SelectTrigger id="new-channel-template">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent align="start">
                                            {channelProfileTemplates.map(template => (
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
                                            const profile = profileForTemplate(templateId)
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
                            onClick={() => setOpen(false)}
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

function templateLabel(templateId: string) {
    if (templateId === 'custom-manual') return m.channel_template_custom_manual_label()
    if (templateId === 'custom-webhook') return m.channel_template_custom_webhook_label()
    return templateId
}

function templateDescription(templateId: string) {
    if (templateId === 'custom-manual') return m.channel_template_custom_manual_description()
    if (templateId === 'custom-webhook') return m.channel_template_custom_webhook_description()
    return m.channel_custom_profile_fallback()
}
