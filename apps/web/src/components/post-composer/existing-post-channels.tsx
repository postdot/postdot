import { Button } from '@postdot/ui/components/button'
import { Field, FieldLabel } from '@postdot/ui/components/field'
import { Popover, PopoverContent, PopoverTrigger } from '@postdot/ui/components/popover'
import { CalendarMinimalisticIcon } from '@solar-icons/react/linear/calendar-minimalistic'
import { useState } from 'react'

import { AddPostDestination } from '@/components/add-post-destination'
import { PublicationRowMenu, PublicationStatus } from '@/components/dashboard-publication-parts'
import { DateTimePicker } from '@/components/date-time-picker'
import { ChannelAvatar } from '@/components/identity-visuals'
import { PublicationDraftDeletionDialog } from '@/components/publication-draft-deletion-dialog'
import { PublicationMoveDialog } from '@/components/publication-move-dialog'
import { StatusText } from '@/components/status-text'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import { useProjectPublicationActions } from '@/lib/project-publication-actions'
import * as m from '@/paraglide/messages.js'

import type { useExistingPostComposition } from './use-existing-post-composition'

export function ExistingPostChannels({
    session,
    blocked,
    getAccessEpoch,
    onAccessRefused,
    onSelect,
}: {
    readonly session: ReturnType<typeof useExistingPostComposition>
    readonly blocked: boolean
    readonly getAccessEpoch: () => number
    readonly onAccessRefused: () => void
    readonly onSelect: (id: string) => void
}) {
    const { locale } = useLanguage()
    const { project, channels, activeChannels } = useProjectDashboard()
    const actions = useProjectPublicationActions()
    const [deleteId, setDeleteId] = useState<string | null>(null)
    const [moveId, setMoveId] = useState<string | null>(null)
    const { composition, data } = session
    const moveEditor = data.editors.find(editor => editor.publication.id === moveId)
    const disabled =
        blocked ||
        session.dirty ||
        session.scheduleDirty ||
        session.saving ||
        session.applying ||
        actions.pending
    async function refreshAndSelect(id: string) {
        const epoch = getAccessEpoch()
        await session.reload()
        if (epoch === getAccessEpoch()) onSelect(id)
    }
    return (
        <div className="min-w-0 space-y-2" data-publication-channel-selection="true">
            <div
                className="flex min-w-0 flex-wrap items-center gap-2"
                role="group"
                aria-label={m.publication_new_editing_scope()}>
                <Button
                    variant="ghost"
                    className={
                        composition.activeContentScopeId === 'shared'
                            ? 'rounded-full bg-surface-control shadow-control'
                            : 'rounded-full'
                    }
                    aria-pressed={composition.activeContentScopeId === 'shared'}
                    onClick={() => onSelect('shared')}>
                    {m.publication_new_common_tab()}
                </Button>
                {composition.publicationTargets.map(target => {
                    const editor = data.editors.find(editor => editor.publication.id === target.id)
                    const publication = data.publications.find(
                        publication => publication.id === target.id
                    )
                    if (!editor || !publication) return null
                    const result = session.applyResults[target.id]
                    return (
                        <div
                            key={target.id}
                            data-channel-selected
                            data-publication-id={target.id}
                            className={`flex min-w-0 max-w-full flex-wrap items-center gap-1 rounded-full px-1 ${composition.activeContentScopeId === target.id ? 'bg-surface-raised ring-2 ring-primary/70' : 'bg-surface-control shadow-control'}`}>
                            <Button
                                variant="ghost"
                                className="min-w-0 max-w-56 gap-2 rounded-full ps-1"
                                data-channel-selected-button
                                data-channel-id={target.channelId}
                                aria-label={editor.channel.name}
                                aria-pressed={composition.activeContentScopeId === target.id}
                                onClick={() => onSelect(target.id)}>
                                <ChannelAvatar channel={editor.channel} size="sm" />
                                <span className="truncate">{editor.channel.name}</span>
                            </Button>
                            {result ? (
                                <StatusText
                                    tone={result.state === 'applied' ? 'positive' : 'attention'}>
                                    {result.state === 'applied'
                                        ? m.editor_saved()
                                        : m.common_error_title()}
                                </StatusText>
                            ) : (
                                <PublicationStatus state={editor.publication.state} />
                            )}
                            {target.customized && !target.locked ? (
                                <span
                                    className="px-1 text-xs text-muted-foreground"
                                    data-channel-own-text>
                                    {m.editor_channel_customized()}
                                </span>
                            ) : null}
                            <Popover>
                                <PopoverTrigger
                                    render={
                                        <Button
                                            size="icon-sm"
                                            variant="ghost"
                                            aria-label={`${editor.channel.name}: ${m.publication_new_schedule_settings()}`}
                                        />
                                    }>
                                    <CalendarMinimalisticIcon aria-hidden="true" />
                                </PopoverTrigger>
                                <PopoverContent
                                    align="start"
                                    className="w-80 max-w-[calc(100vw-2rem)]">
                                    <div className="space-y-4">
                                        <p className="text-sm font-medium">{editor.channel.name}</p>
                                        <p className="text-sm text-muted-foreground">
                                            {target.deliveryMode === 'automatic'
                                                ? m.publication_new_automatic_publication()
                                                : m.publication_new_manual_publication()}
                                        </p>
                                        <Field>
                                            <FieldLabel htmlFor={`deliver-at-${target.id}`}>
                                                {m.editor_deliver_at()}
                                            </FieldLabel>
                                            <DateTimePicker
                                                id={`deliver-at-${target.id}`}
                                                value={target.scheduledAt}
                                                onChange={scheduledAt =>
                                                    composition.onPublicationTargetsChange(
                                                        current =>
                                                            current.map(item =>
                                                                item.id === target.id
                                                                    ? { ...item, scheduledAt }
                                                                    : item
                                                            )
                                                    )
                                                }
                                                disabled={
                                                    blocked ||
                                                    target.locked ||
                                                    session.applying ||
                                                    session.applyResults[target.id]?.state ===
                                                        'unconfirmed'
                                                }
                                                timeZone={project.timeZone}
                                                locale={locale}
                                                clearLabel={m.common_clear()}
                                                dateLabel={m.date_time_picker_date()}
                                                timeLabel={m.date_time_picker_time()}
                                                placeholder={m.date_time_picker_placeholder()}
                                            />
                                        </Field>
                                        {editor.movement?.canMove && !blocked ? (
                                            <Button
                                                variant="ghost"
                                                disabled={disabled}
                                                onClick={() => setMoveId(target.id)}>
                                                {m.publication_move_action()}
                                            </Button>
                                        ) : null}
                                    </div>
                                </PopoverContent>
                            </Popover>
                            <PublicationRowMenu
                                publication={publication}
                                pending={actions.pending || session.saving || session.applying}
                                onDuplicateDraft={
                                    !blocked && !target.locked
                                        ? id => {
                                              const epoch = getAccessEpoch()
                                              void session.flush().then(async saved => {
                                                  if (!saved || epoch !== getAccessEpoch()) return
                                                  const copy =
                                                      await actions.onDuplicateDraftPublication(id)
                                                  if (copy && epoch === getAccessEpoch())
                                                      await refreshAndSelect(copy.id)
                                              })
                                          }
                                        : undefined
                                }
                                onDeleteDraft={
                                    !blocked && !target.locked
                                        ? publication => setDeleteId(publication.id)
                                        : undefined
                                }
                                onMove={
                                    !blocked && editor.movement?.canMove
                                        ? () => setMoveId(target.id)
                                        : undefined
                                }
                            />
                        </div>
                    )
                })}
                {!blocked ? (
                    <span inert={disabled}>
                        <AddPostDestination
                            projectId={project.id}
                            postId={data.post.id}
                            channels={activeChannels}
                            onAdded={refreshAndSelect}
                        />
                    </span>
                ) : null}
            </div>
            {actions.error ? (
                <p role="alert" className="text-sm text-state-failed">
                    {actions.error}
                </p>
            ) : null}
            <PublicationDraftDeletionDialog
                open={deleteId !== null}
                onOpenChange={open => {
                    if (!open) setDeleteId(null)
                }}
                pending={actions.pending || blocked}
                onDelete={async () => {
                    const epoch = getAccessEpoch()
                    if (!deleteId || blocked) return false
                    const deleted = await actions.onDeleteDraftPublication(deleteId)
                    if (epoch !== getAccessEpoch()) return false
                    if (deleted) await refreshAndSelect('shared')
                    return deleted
                }}
            />
            {moveEditor ? (
                <PublicationMoveDialog
                    editor={moveEditor}
                    channels={channels}
                    disabled={disabled}
                    onError={onAccessRefused}
                    onClose={() => setMoveId(null)}
                    onMoved={async id => {
                        setMoveId(null)
                        await refreshAndSelect(id)
                    }}
                />
            ) : null}
        </div>
    )
}
