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

type ProfileChoice = 'manual-message' | 'linkedin' | 'bluesky' | 'custom'

export function ChannelCreationDialog({
    onCreate,
    pending,
}: {
    readonly onCreate: (name: string, profile: ChannelCreationProfile) => Promise<boolean>
    readonly pending: boolean
}) {
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
            setValidationError('Enter a channel name.')
            return
        }

        let profile: ChannelCreationProfile = choice === 'custom' ? 'manual-message' : choice
        if (choice === 'custom') {
            try {
                const parsed: unknown = JSON.parse(profileText)
                if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    setValidationError('The custom profile must be a JSON object.')
                    return
                }
                profile = parsed as RuntimeChannelProfile
            } catch {
                setValidationError('The custom profile is not valid JSON.')
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
                Add channel
            </Button>
            <Dialog
                open={open}
                onOpenChange={nextOpen => {
                    setOpen(nextOpen)
                    if (!nextOpen) reset()
                }}>
                <DialogContent className="max-h-[min(42rem,calc(100vh-2rem))] max-w-2xl overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Add a channel</DialogTitle>
                        <DialogDescription>
                            Choose a built-in profile or start from a validated custom runtime
                            profile. The server remains authoritative.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-5">
                        <Field className="gap-1.5">
                            <FieldLabel htmlFor="new-channel-name">Channel name</FieldLabel>
                            <Input
                                id="new-channel-name"
                                autoFocus
                                value={name}
                                onChange={event => setName(event.target.value)}
                                placeholder="Community forum"
                            />
                        </Field>

                        <Field className="gap-1.5">
                            <FieldLabel htmlFor="new-channel-profile">Profile</FieldLabel>
                            <Select
                                items={{
                                    'manual-message': 'Manual message',
                                    linkedin: 'LinkedIn text',
                                    bluesky: 'Bluesky post',
                                    custom: 'Custom runtime profile',
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
                                    <SelectItem value="manual-message">Manual message</SelectItem>
                                    <SelectItem value="linkedin">LinkedIn text</SelectItem>
                                    <SelectItem value="bluesky">Bluesky post</SelectItem>
                                    <SelectItem value="custom">Custom runtime profile</SelectItem>
                                </SelectContent>
                            </Select>
                        </Field>

                        {choice === 'custom' ? (
                            <div className="grid gap-4 rounded-lg bg-muted p-4">
                                <Field className="gap-1.5">
                                    <FieldLabel htmlFor="new-channel-template">
                                        Starter template
                                    </FieldLabel>
                                    <Select value={templateId} onValueChange={selectCustomTemplate}>
                                        <SelectTrigger id="new-channel-template">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent align="start">
                                            {channelProfileTemplates.map(template => (
                                                <SelectItem key={template.id} value={template.id}>
                                                    {template.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FieldDescription>
                                        {channelProfileTemplates.find(
                                            template => template.id === templateId
                                        )?.description ??
                                            'Use a valid Herald channel profile definition.'}
                                    </FieldDescription>
                                </Field>
                                <Field className="gap-1.5">
                                    <FieldLabel htmlFor="new-channel-profile-json">
                                        Profile JSON
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
                                        Custom profiles are validated before they become active. You
                                        can edit this definition after creation.
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
                            Cancel
                        </Button>
                        <Button type="button" onClick={() => void submit()} disabled={pending}>
                            <CodeFileIcon aria-hidden="true" />
                            Create channel
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
