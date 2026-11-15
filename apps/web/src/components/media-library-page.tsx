import { Button } from '@postdot/ui/components/button'
import { ButtonGroup, ButtonGroupSeparator } from '@postdot/ui/components/button-group'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@postdot/ui/components/dropdown-menu'
import { AltArrowDownIcon } from '@solar-icons/react/linear/alt-arrow-down'
import { CameraIcon } from '@solar-icons/react/linear/camera'
import { LinkIcon } from '@solar-icons/react/linear/link'
import { UploadIcon } from '@solar-icons/react/linear/upload'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useState } from 'react'
import { createPortal } from 'react-dom'

import { MediaAttachmentPicker } from '@/components/media-attachment-picker'
import { ProjectPage } from '@/components/project-page'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export function MediaLibraryPage() {
    useLanguage()
    const navigate = useNavigate({ from: '/dashboard/projects/$projectId/media' })
    const { assetId } = useSearch({ from: '/dashboard/projects/$projectId/media' })
    const { project, projectRole, access } = useProjectDashboard()
    const [headerAction, setHeaderAction] = useState<HTMLDivElement | null>(null)
    const readOnly = projectRole === 'viewer' || access.status !== 'confirmed'

    return (
        <ProjectPage
            title={m.media_title()}
            width="full"
            action={readOnly ? undefined : <div ref={setHeaderAction} />}>
            <section className="w-full">
                <MediaAttachmentPicker
                    onError={access.reportRefusal}
                    emptyDescription={m.media_empty_description()}
                    projectId={project.id}
                    inspectAssetId={assetId}
                    onInspectClose={() => {
                        if (assetId) void navigate({ search: {}, replace: true })
                    }}
                    renderHeader={({
                        disabled,
                        onImport,
                        onImportFromUrl,
                        onTakePhoto,
                        uploading,
                        view,
                    }) =>
                        headerAction
                            ? createPortal(
                                  readOnly || view === 'trash' ? null : onImportFromUrl ||
                                    onTakePhoto ? (
                                      <ButtonGroup>
                                          <Button
                                              type="button"
                                              disabled={disabled}
                                              className="border-r-0 shadow-none focus-visible:border-r"
                                              onClick={onImport}>
                                              <UploadIcon aria-hidden="true" />
                                              {uploading === null
                                                  ? m.media_import()
                                                  : m.media_uploading({ filename: uploading })}
                                          </Button>
                                          <ButtonGroupSeparator
                                              className={`bg-[color-mix(in_srgb,var(--action)_80%,var(--action-foreground))] ${
                                                  disabled ? 'opacity-50' : ''
                                              }`}
                                          />
                                          <DropdownMenu>
                                              <DropdownMenuTrigger
                                                  render={
                                                      <Button
                                                          type="button"
                                                          size="icon"
                                                          variant="default"
                                                          disabled={disabled}
                                                          aria-label={m.media_import_more_options()}
                                                          data-media-import-menu-trigger="true"
                                                          className="shadow-none aria-expanded:bg-action/90">
                                                          <AltArrowDownIcon aria-hidden="true" />
                                                      </Button>
                                                  }
                                              />
                                              <DropdownMenuContent align="end">
                                                  {onImportFromUrl ? (
                                                      <DropdownMenuItem
                                                          disabled={disabled}
                                                          data-media-import-menu-item="url"
                                                          onClick={onImportFromUrl}>
                                                          <LinkIcon aria-hidden="true" />
                                                          {m.media_import_from_url()}
                                                      </DropdownMenuItem>
                                                  ) : null}
                                                  {onTakePhoto ? (
                                                      <DropdownMenuItem
                                                          disabled={disabled}
                                                          data-media-import-menu-item="webcam"
                                                          onClick={onTakePhoto}>
                                                          <CameraIcon aria-hidden="true" />
                                                          {m.media_import_take_photo()}
                                                      </DropdownMenuItem>
                                                  ) : null}
                                              </DropdownMenuContent>
                                          </DropdownMenu>
                                      </ButtonGroup>
                                  ) : (
                                      <Button
                                          type="button"
                                          disabled={disabled}
                                          className="shadow-none"
                                          onClick={onImport}>
                                          <UploadIcon aria-hidden="true" />
                                          {uploading === null
                                              ? m.media_import()
                                              : m.media_uploading({ filename: uploading })}
                                      </Button>
                                  ),
                                  headerAction
                              )
                            : null
                    }
                    readOnly={readOnly}
                    selectionMode="manage"
                    value={[]}
                    onChange={ignoreMediaSelection}
                />
            </section>
        </ProjectPage>
    )
}

function ignoreMediaSelection() {}
