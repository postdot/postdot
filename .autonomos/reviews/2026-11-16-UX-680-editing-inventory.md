<!-- cspell:disable -->
# UX-680: Editing Surface Inventory for SPEC-013

## Context and Route Mapping

SPEC-013 replaces three separate authoring and editing surfaces with a single shared post composer:

| Current surface | Current route | Current role | Target under SPEC-013 |
| --- | --- | --- | --- |
| Surface 1 | `/dashboard/projects/$projectId/publications/new` | Create a post and initial channel publications | Create mode on the shared composer (unchanged URL) |
| Surface 2 | `/dashboard/projects/$projectId/publications/$publicationId` | Edit one channel publication, manage lifecycle, view post source | Edit mode on the shared composer with that channel's tab active (unchanged URL) |
| Surface 3 | `/dashboard/projects/$projectId/posts/$postId` | View/edit shared post source, list destinations, add channels, review stale drafts | Edit mode on the shared composer opening on the "All channels" tab (unchanged URL) |

Legend for single-surface flags in the tables below:
- **Only S1**: Capability currently exists only on `/publications/new`.
- **Only S2**: Capability currently exists only on `/publications/$publicationId`.
- **Only S3**: Capability currently exists only on `/posts/$postId`.
- **S2 + S3**: Exists on both edit surfaces, missing from S1.
- **S1 + S2**: Exists on S1 and S2, missing from S3.
- **All (S1+S2+S3)**: Present in some form across all three surfaces.

Placement column values align with SPEC-013:
- `create mode`
- `edit mode "All channels" tab`
- `edit mode channel tab`
- `below the composer`
- `retire, owner decision needed`

*(Capabilities shared across create and edit modes are marked with their mode plus the corresponding SPEC-013 area, e.g., `create mode + edit mode "All channels" tab`.)*

---

## Surface 1: `/publications/new`

Primary route and files:
- `apps/web/src/routes/dashboard/projects/$projectId/publications/new.tsx` (`NewPublicationRoute`)
- `apps/web/src/components/new-publication-page.tsx` (`NewPublicationPage`)
- `apps/web/src/components/publication-composer.tsx` (`PublicationComposer`, `PublicationChannelTabs`, `PublicationChannelSettings`)
- `apps/web/src/components/composer-draft-conflict.tsx` (`ComposerDraftConflict`)
- `apps/web/src/components/channel-creation-dialog.tsx` (`ChannelCreationDialog`)
- `apps/web/src/components/media-attachment-picker.tsx` (`MediaAttachmentPicker`)
- `apps/web/src/components/publication-tag-picker.tsx` (`PublicationTagPicker`, `ProjectTagDialog`)
- `apps/web/src/components/publication-draft-preview.tsx` (`PublicationDraftPreview`)
- `apps/web/src/components/publication-text-count.tsx` (`PublicationTextCount`, `XWeightedTextCount`)
- `apps/web/src/components/configured-publication-editor.tsx` (`ConfiguredPublicationEditor`)
- `apps/web/src/components/publication-text-editor.tsx` (`PublicationTextEditor`)

| Capability | Description | Where it lives | API calls | Who can use (roles, states) | SPEC-013 placement | Surface flag |
| --- | --- | --- | --- | --- | --- | --- |
| Route access and lifecycle guard | Redirects viewers and non-active projects away from create route to Queue | `publications/new.tsx` (`NewPublicationRoute`) | `GET /api/projects/:projectId/lifecycle` (`useProjectLifecycle` via context) | Redirects `viewer` and `project.state !== 'active'`; `owner`, `editor` allowed | `create mode` | **Only S1** (S2/S3 stay readable as read-only for viewers and archived projects) |
| Calendar slot URL prefill | Reads `?date=YYYY-MM-DD` and `?time=HH:MM` search params to seed default scheduled time | `publications/new.tsx`, `new-publication-page.tsx` | None (URL search params + `project.timeZone`) | `owner`, `editor` in active project | `create mode` | **Only S1** |
| Server composer draft load and local recovery comparison | Loads per-user create draft from server and checks newer `localStorage` draft buffer | `new-publication-page.tsx` (`usePublicationComposer` hydration effect) | `GET /api/projects/:projectId/publication-composer-draft?expectedUserId=` (`api.getPublicationComposerDraft`) | `owner`, `editor` with confirmed access | `create mode` | **Only S1** (S2 uses per-publication draft + `localStorage` v3 buffer; S3 has no draft) |
| Composer draft autosave and retry | Debounced background PUT saving whole create state with retry button on failure | `new-publication-page.tsx` (`enqueueAutosave`, `retryAutosave`) | `PUT /api/projects/:projectId/publication-composer-draft` (`api.savePublicationComposerDraft`) | `owner`, `editor`; pauses on `401`, account switch, or `409` conflict | `create mode` | **Only S1** (S2 saves per-publication draft via `PATCH .../draft`) |
| Create draft conflict review and JSON export | Side-by-side comparison of local vs server draft (body, title, tags, media, schedules, targets) with "Use saved", "Save local", and `postdot-draft-versions.json` download | `composer-draft-conflict.tsx` (`ComposerDraftConflict`), `new-publication-page.tsx` (`reviewConflict`, `resolveConflict`) | `GET .../publication-composer-draft`, `PUT .../publication-composer-draft`, `GET /api/projects/:projectId/media/:assetId` (`api.getMedia`) | `owner`, `editor` when `409 write_conflict` occurs | `create mode` (conflict resolution) | **Only S1** (S2 uses `PublicationEditorSidebar` + `PublicationRecoveryComparison` without JSON export) |
| Start over and dismiss recovery notice | Clears both local buffer and server composer draft and resets form state | `new-publication-page.tsx` (`startOver`, `discardServerDraft`) | `DELETE /api/projects/:projectId/publication-composer-draft` (`api.deletePublicationComposerDraft`) | `owner`, `editor` when recovery banner is shown | `create mode` | **Only S1** |
| Session ended and account changed pause | Marks form `inert` and offers Sign in (`/login?continue=...`) or Reload when `401` or user switch happens | `new-publication-page.tsx` (`pauseForSessionError`) | Triggered by `401` or mismatched `expectedUserId` | Any user whose session expires or switches mid-draft | `create mode` (extend guard semantics to edit mode as well) | **Only S1** (S2 clears or suspends via project access revocation instead of inline login CTA) |
| Channel tabs, selection toggle, and layout groups | Renders "All channels" tab, selectable destination chips grouped by channel state, and multi-select checkboxes | `publication-composer.tsx` (`PublicationChannelTabs`), `new-publication-page.tsx` | `GET /api/projects/:projectId/channels` (`useProjectDashboard` context) | `owner`, `editor` for active project; only active channels selectable | `create mode` (chip selection) + `edit mode "All channels" tab` (navigation) + `edit mode channel tab` (chip row) | **Only S1** (create multi-select chips; S2 has single-select `PublicationChannelRail` + `AddPostDestination`) |
| Inline channel creation | Opens modal to create a channel without leaving the composer and selects it automatically | `channel-creation-dialog.tsx` (`ChannelCreationDialog`), `new-publication-page.tsx` | `GET /api/channel-profile-presets`, `GET /api/provider-applications`, `POST /api/projects/:projectId/channels` (`api.createChannel`) | `owner`, `editor` | `create mode` (and decide if inline creation also belongs on `edit mode "All channels" tab`) | **Only S1** |
| Customized target removal confirmation | Prompts confirmation before dropping a channel chip whose text was customized | `new-publication-page.tsx` (`requestTargetRemoval`, `pendingRemovalId` Dialog) | None (local state) | `owner`, `editor` when channel has non-shared copy | `create mode` (S2/S3 edit mode deletes draft or cancels scheduled per SPEC-013) | **Only S1** |
| Shared schedule & delivery popovers and defaults | Sets shared `deliveryMode` (`manual` / `automatic`) and `scheduledAt`, plus per-channel popover override and "Use defaults" reset; disables `automatic` if channel has no active connection/execution | `publication-composer.tsx` (`PublicationChannelSettings`, `ChannelChip`), `new-publication-page.tsx` | `GET /api/projects/:projectId/publisher-connections` (context), `GET /api/projects/:projectId/channels/:channelId/cadence` (if previewed? no, occupancy/cadence checked on submit) | `owner`, `editor`; `automatic` only when channel execution != `manual` and connection active | `create mode` + `edit mode "All channels" tab` (batch defaults/chips) + `edit mode channel tab` (per-channel chip popover) | **S1 + S2** (S1 has shared defaults + per-channel popovers + delivery mode switch; S2 only has single `DateTimePicker` schedule without changing `deliveryMode`) |
| Conditional headline input and live char limit | Shows `new-post-title` only when active channel profile has a headline field; shows count when invalid, limit <= 500, or >= 80% used | `new-publication-page.tsx` (`showHeadline`, `headlineCount`) | `GET /api/projects/:projectId/channels/:channelId/profile` (`api.getChannelProfileState`) | `owner`, `editor` when `showHeadline` is true | `create mode` + `edit mode "All channels" tab` (note: SPEC-013 must show title if ANY selected channel uses one, matching SPEC-013) | **Only S1** (S2/S3 put headline inside "Content options" `<details>` regardless of profile) |
| Profile constraint loading & error retry | Fetches active channel's profile schema to drive headline visibility, editor profile, and limits; shows retry button on failure | `new-publication-page.tsx` (`profileQuery`), `lib/publication-composer-constraints.ts` | `GET /api/projects/:projectId/channels/:channelId/profile` (`api.getChannelProfileState`) | `owner`, `editor` when a channel tab is active | `create mode` + `edit mode channel tab` | **Only S1** (S2 embeds `profile` inside `getPublicationEditor`) |
| Multi-scope rich text editor (TipTap & legacy) | Renders persistent hidden/visible `ConfiguredPublicationEditor` (or `PublicationTextEditor` with `?editor=legacy` in DEV) per visited scope; marks channel custom on edit; supports "Use text for all channels" reset | `new-publication-page.tsx` (`renderedEditorScopes`, `editScopeText`, `useSharedTargetContent`), `configured-publication-editor.tsx` | None (updates state -> autosave) | `owner`, `editor` | `create mode` + `edit mode "All channels" tab` + `edit mode channel tab` | **Only S1** (multi-scope mounted switcher; S2 edits source + separate target JSON fields) |
| Live body character/grapheme/X-weighted counter | Computes X weighted length (`parseXPostText` / `XWeightedTextCount`) or `PublicationTextCount` near/above limits | `new-publication-page.tsx`, `publication-text-count.tsx` | Derived from `profileQuery` capabilities/schema | `owner`, `editor` when a channel with text limits is active | `create mode` + `edit mode channel tab` | **Only S1** (S2 lacks live weighted/grapheme counter on source editor!) |
| Media attachment picker & upload recovery | Attaches, reorders, sets alt text, uploads via Uppy (`localStorage` recovery), imports URL, or deletes/restores project media inside inline toolbar | `media-attachment-picker.tsx` (`MediaAttachmentPicker variant="publication-new-inline"`) | `GET .../media`, `GET .../media/:id`, `GET .../media/upload-policy`, `GET .../media/import-sources`, `POST .../media/uploads`, `PUT .../media/uploads/:id`, `POST .../media/uploads/:id/finalize`, `POST .../media/import`, `DELETE/POST .../media/*` | `owner`, `editor` (read-only/disabled for viewers) | `create mode` + `edit mode "All channels" tab` (and `edit mode channel tab` media override if supported) | **S1 + S2** (missing from S3 read-only view; present in S3 `PostSourceEditor` via `PublicationEditorSourceSection`) |
| Media preparation submit lock | Blocks submit ("Save as draft" / "Schedule") while uploads/imports are preparing and announces `status` | `new-publication-page.tsx` (`mediaPreparationPending`, `reportMediaPreparation`) | None (callback from `MediaAttachmentPicker`) | `owner`, `editor` during media upload/import | `create mode` + `edit mode "All channels" tab` + `edit mode channel tab` | **Only S1** (S2 autosaves without waiting for upload lock unless finalized; wait: S2 `PublicationEditorSourceSection` passes `mediaDisabled` only when `accessWritesBlocked` etc.) |
| Live channel preview | Shows channel-accurate post preview (`PublicationDraftPreview`), including media grid, X/Bluesky/Mastodon/Telegram/Discord/Dev.to formatting | `publication-draft-preview.tsx` (`PublicationDraftPreview`) | `GET /api/projects/:projectId/media/:assetId/content` (for thumbnails/video) | `owner`, `editor` when a channel is selected | `create mode` + `edit mode channel tab` (and preview of active/first channel in "All channels" per SPEC-013) | **S1 + S2** (not on S3) |
| Internal tags picker and inline tag creation | Selects tags from project catalog (`includeArchived: true` to preserve historical) and creates new tags inline via modal | `publication-tag-picker.tsx` (`PublicationTagPicker`, `ProjectTagDialog`), `new-publication-page.tsx` | `GET /api/projects/:projectId/tags?includeArchived=true`, `POST /api/projects/:projectId/tags` (`api.createProjectTag`) | Select: `owner`, `editor`; Create tag: `owner`, `editor`; Archived tags remain selectable only if already on post/draft | `create mode` + `edit mode "All channels" tab` (note: tags are per-publication on backend today, see Risks!) | **S1 + S2** (not on S3; S3 does not edit or show tags!) |
| Keyboard shortcuts (`Mod+Enter`, `Mod+Shift+M`) | `Cmd/Ctrl+Enter` submits schedule/save; `Cmd/Ctrl+Shift+M` opens media picker (`shortcutMatches` gated on `/publications/new` and `/posts/`) | `new-publication-page.tsx` (keydown listeners), `lib/shortcuts.ts` | Triggers form submit (`POST /api/projects/:projectId/posts`) or opens picker | `owner`, `editor` when composer ready and not blocked | `create mode` + `edit mode "All channels" tab` + `edit mode channel tab` | **Only S1** (`Cmd/Ctrl+Shift+M` missing on S2/S3; `Cmd/Ctrl+Enter` in S2 triggers `promoteDraft`, not registered in `shortcuts.ts` for `/publications/$publicationId`) |
| Post creation ("Save as draft" / "Schedule N") + cadence confirmation | Validates targets, blocks while uploads run, submits `POST /posts`, handles `409 cadence_conflict` prompt (`withCadenceConfirmation`), deletes composer draft, redirects to `/posts/$postId` (with partial tag failure warning toast if tag apply failed) | `new-publication-page.tsx` (`handleSubmit`), `lib/cadence-confirmation.ts` | `POST /api/projects/:projectId/posts` (`api.createPost`), `DELETE .../publication-composer-draft` | `owner`, `editor` when >= 1 channel selected and not in conflict/session pause | `create mode` | **Only S1** |

*(Note: Capabilities missing from Surface 1 compared to S2/S3: body `format` selector `plain_text`/`markdown`, `language` combobox, and schema-driven target fields like polls, threads, Bluesky link cards, and Dev.to metadata. Under SPEC-013 these live inside "Content options" on each channel tab.)*

---

## Surface 2: `/publications/$publicationId`

Primary route and files:
- `apps/web/src/routes/dashboard/projects/$projectId/publications/$publicationId.tsx` (`PublicationEditorRoute`, `PublicationUnavailable`)
- `apps/web/src/components/publication-editor.tsx` (`PublicationEditor`)
- `apps/web/src/components/publication-lifecycle-panel.tsx` (`PublicationLifecyclePanel`)
- `apps/web/src/components/publication-move-dialog.tsx` (`PublicationMoveDialog`)
- `apps/web/src/components/publication-cancellation-dialog.tsx` (`PublicationCancellationDialog`)
- `apps/web/src/components/publication-cadence-status.tsx` (`PublicationCadenceStatus`)
- `apps/web/src/components/publication-destination.tsx` (`PublicationDestination`)
- `apps/web/src/components/publication-outcome-panel.tsx` (`PublicationOutcomePanel`)
- `apps/web/src/components/publication-comments-panel.tsx` (`PublicationCommentsPanel`)
- `apps/web/src/components/publication-first-comment-panel.tsx` (`PublicationFirstCommentPanel`)
- `apps/web/src/components/publication-replies-panel.tsx` (`PublicationRepliesPanel`, `usePublicationReplies`)
- `apps/web/src/components/publication-thread-progress.tsx` (`PublicationThreadProgress`)
- `apps/web/src/components/publication-profile-adoption.tsx` (`PublicationProfileAdoption`)
- `apps/web/src/components/publication-adoption-history.tsx` (`PublicationAdoptionHistory`)
- `apps/web/src/components/publication-editor-status.tsx` (`PublicationEditorStatus`, `PublicationEditorSaveIndicator`)
- `apps/web/src/components/publication-editor-source-section.tsx` (`PublicationEditorSourceSection`)
- `apps/web/src/components/publication-editor-target-section.tsx` (`PublicationEditorTargetSection`)
- `apps/web/src/components/publication-target-editor.tsx` (`PublicationTargetEditor`)
- `apps/web/src/components/publication-target-field-control.tsx` (`TargetFieldControl`)
- `apps/web/src/components/publication-editor-promotion-section.tsx` (`PublicationEditorDeliverySettings`, `PublicationEditorPromotionAction`)
- `apps/web/src/components/publication-editor-sidebar.tsx` (`PublicationEditorSidebar`, `SourceComparisonContent`)
- `apps/web/src/components/publication-recovery-comparison.tsx` (`PublicationRecoveryComparison`)
- `apps/web/src/components/publication-activity-timeline.tsx` (`PublicationActivityTimeline`)
- `apps/web/src/components/publication-target-list.tsx` (`PublicationChannelRail`)
- `apps/web/src/components/copy-publication-link.tsx` (`CopyPublicationLink`)

| Capability | Description | Where it lives | API calls | Who can use (roles, states) | SPEC-013 placement | Surface flag |
| --- | --- | --- | --- | --- | --- | --- |
| Back-to-calendar vs Back-to-queue context preservation | Preserves `?from=calendar&date=&view=` across sibling channel navigation and renders "Back to calendar" or "Back to queue", including on 404/unavailable screen | `publications/$publicationId.tsx`, `publication-editor.tsx` (`backToCalendar`, header `<Link>`) | None (router search params) | All project roles (`owner`, `editor`, `viewer`), all states including `404` | Shared header of unified edit mode (preserve search across channel tab switches & moves) | **Only S2** (S3 always links "Back to queue" with no search params) |
| Copy canonical publication link | Copies `/dashboard/projects/:projectId/publications/:publicationId` to clipboard, with manual copy fallback dialog if clipboard denied | `copy-publication-link.tsx` (`CopyPublicationLink`), `publication-editor.tsx` | None (browser `navigator.clipboard` + dialog fallback) | All roles (`owner`, `editor`, `viewer`), all states | `edit mode channel tab` (or header when on channel tab) | **Only S2** (also in Queue/List row menu; absent on S1/S3 headers) |
| Save status indicator pill & status alert bar | Displays header status (`Saved`, `Saving...`, `Changes pending`, `Conflict`, `Local recovery`, `Save failed`), passive background notice, and `Check server` / `Review conflict` buttons | `publication-editor-status.tsx` (`PublicationEditorSaveIndicator`, `PublicationEditorStatus`), `publication-editor.tsx` | Triggers `GET .../editor` on "Check server" | Editable publications for `owner`, `editor` | Shared edit mode header + inline status banner | **Only S2** (S1 has footer status span; S3 has explicit Save button only) |
| Publication movement links & notice | Shows links to `fromPublicationId` ("Original publication") and `toPublicationId` ("Replacement publication"), plus requested move time if cancelled original had one | `publication-editor.tsx` (`editor.movement` block) | Data from `GET .../editor` | All roles when `editor.movement` is present | `edit mode channel tab` (above lifecycle strip or `below the composer`) | **Only S2** |
| Lifecycle status strip and connection repair CTA | Shows status badge, scheduled/published timestamp, failed `errorMessage`, and direct repair `<Link>` (`#publisher-connection-:channelId`) when automatic connection is missing/revoked/needs reconnect | `publication-lifecycle-panel.tsx` (`PublicationLifecyclePanel`) | Data from `GET .../editor` + `publisherConnections` | Visible to all roles; repair CTA shows "Channels" to viewers, "Connect/Reconnect" to `owner`/`editor` | `below the composer` on `edit mode channel tab` | **Only S2** (S3 shows compact status in `PublicationList` without connection repair CTA) |
| Record manual publish & Undo manual publish | Marks due manual publication as published with 10s undo toast; Undo button remains on published manual publication | `publication-lifecycle-panel.tsx`, `publication-editor.tsx`, `lib/project-publication-actions.ts` | `POST /api/projects/:projectId/publications/:id/publish`, `POST .../publish/undo`, `GET .../editor` | `owner`, `editor`; blocked if local changes, unsaved, conflict, review required, or unpromoted draft diffs; undo on `published` + `manual` | `below the composer` on `edit mode channel tab` | **S2 + S3** (S3 exposes inside `PublicationList` row action buttons; S2 renders full panel + draft guard) |
| Retry automatic delivery | Retries a `failed` automatic publication (handles `409 cadence_conflict` confirmation) | `publication-lifecycle-panel.tsx`, `publication-editor.tsx`, `lib/project-publication-actions.ts` | `POST /api/projects/:projectId/publications/:id/retry`, `GET .../editor` | `owner`, `editor`; `state === 'failed'` & `deliveryMode === 'automatic'`; blocked if unsaved/conflict/connection/review issues | `below the composer` on `edit mode channel tab` | **S2 + S3** (S3 exposes in `PublicationList` row without dirty-draft guards) |
| Cancel scheduled publication | Opens confirmation dialog and cancels a `scheduled` publication | `publication-lifecycle-panel.tsx`, `publication-cancellation-dialog.tsx` | `PATCH /api/projects/:projectId/publications/cancel` (`api.cancelPublications`) | `owner`, `editor`; `state === 'scheduled'`; blocked if unsaved/conflict | `below the composer` on `edit mode channel tab` AND channel chip remove action per SPEC-013 | **Only S2** (not on S3 single-row buttons; exists in Queue bulk) |
| Move publication to another channel | Opens `PublicationMoveDialog` to pick target active channel + delivery mode (`manual`/`automatic`), handles `cadence_conflict`, deletes recovery buffer, navigates to new publication ID | `publication-move-dialog.tsx` (`PublicationMoveDialog`), `publication-editor.tsx` | `POST /api/projects/:projectId/publications/:id/move` (`api.movePublication`) | `owner`, `editor` when `canEditPublication` & active channels exist; blocked while dirty/conflict/unpromoted | `below the composer` on `edit mode channel tab` | **Only S2** |
| Delete draft publication? (MISSING on S2!) | Notice: S2 has NO single-publication "Delete draft" button (unlike `PublicationRowMenu` on S3/Queue), though SPEC-013 calls for chip removal to delete draft publications | `PublicationRowMenu` (`dashboard-publication-parts.tsx`), missing in `publication-editor.tsx` | `DELETE /api/projects/:projectId/publications/:id` (`api.deleteDraftPublication`) | `owner`, `editor` on `draft` publications | `edit mode channel tab` (chip removal per SPEC-013) + `below the composer` | **Only S3** (via `PublicationList` row menu; absent on S2) |
| Cadence status and planning exception override | Displays channel cadence delay reason/next slot when an automatic `scheduled`/`ready` publication is cadence-held, with override button ("Publish at scheduled time") | `publication-cadence-status.tsx` (`PublicationCadenceStatus`) | `GET /api/projects/:projectId/publications/:id/cadence`, `POST .../cadence-override` | Visible on `automatic` + (`scheduled` or `ready`); override allowed for `owner`, `editor` | `below the composer` on `edit mode channel tab` | **Only S2** |
| Destination identity confirmation & history | Shows target destination identity (`account`, `page`, etc.) when automatic, warns if unconfirmed/changed, and lets operator confirm destination or review current editor | `publication-destination.tsx` (`PublicationDestination`) | `GET /api/projects/:projectId/publications/:id/destination`, `POST .../confirm-destination` | Editable in `draft`, `scheduled`, `ready`, `failed` for `owner`, `editor` when `automatic` | `below the composer` on `edit mode channel tab` | **Only S2** |
| Ambiguous outcome reconciliation panel | When `publication.state === 'ambiguous'` or a thread message is `ambiguous`/`sending`, lets operator resolve outcome as published (with external ID / URL / optional Bluesky CID) or failed | `publication-outcome-panel.tsx` (`PublicationOutcomePanel`), `publication-editor.tsx` | `POST /api/projects/:projectId/publications/:id/reconcile`, `GET .../editor` | `owner`, `editor` when `state === 'ambiguous'` or thread message ambiguous; read-only note for viewers | `below the composer` on `edit mode channel tab` | **Only S2** |
| Thread progress tracker | Displays per-message progress list (sent / sending / failed / ambiguous) when `editor.threadMessages` exists; locks editing once any message reaches `confirmed`/`sending`/`ambiguous` | `publication-thread-progress.tsx` (`PublicationThreadProgress`), `publication-editor.tsx` (`threadStarted`) | Data from `GET .../editor` (`threadMessages`) | Visible to all roles when `threadMessages.length > 0`; editing disabled if `threadStarted` | `below the composer` on `edit mode channel tab` (and locks channel tab read-only) | **Only S2** |
| Published provider comments & manual refresh | Lists fetched comments on published post for providers supporting inspection (`comments.inspectable`) and triggers provider refresh | `publication-comments-panel.tsx` (`PublicationCommentsPanel`) | `GET /api/projects/:projectId/publications/:id/comments`, `POST .../comments/refresh` | Visible when `state === 'published'` + `externalId`; Refresh requires `owner`, `editor` | `below the composer` on `edit mode channel tab` | **Only S2** |
| First comment preparation & cancellation | Schedules/saves/cancels an automatic follow-up comment (`firstComment`) supported by provider | `publication-first-comment-panel.tsx` (`PublicationFirstCommentPanel`) | `GET .../first-comment`, `PUT .../first-comment`, `DELETE .../first-comment` | `owner`, `editor` when `firstCommentSupported` and not read-only | `below the composer` on `edit mode channel tab` | **Only S2** |
| Public replies / conversation thread & idempotent send | Infinite-scrolling reply stream (with 2s poll while reply pending/running), reply composer, and idempotent `requestId` retry on ambiguous/failed send | `publication-replies-panel.tsx` (`PublicationRepliesPanel`) | `GET /api/projects/:projectId/publications/:id/replies`, `POST /api/projects/:projectId/publications/:id/replies` | Visible when `repliesSupported`; Send allowed for `owner`, `editor` | `below the composer` on `edit mode channel tab` | **Only S2** |
| Sibling channel rail & Add destination | Switches between sibling publications of the same post (preserving calendar search) and embeds `AddPostDestination` action | `publication-target-list.tsx` (`PublicationChannelRail`), `add-post-destination.tsx` | `GET .../publications` (`loadPostPublications`), `AddPostDestination` APIs | All roles switch tabs; Add destination for `owner`, `editor` | Replaced by SPEC-013 unified channel chip row (`"All channels"` + channel chips + Add) | **S2 + S3** (`PublicationChannelRail` Only S2; `AddPostDestination` S2+S3) |
| Post source section (`format`, `headline`, `language`, media, body) | Edits `post.sourceContent` inline (TipTap or legacy), collapses body toggle (`Add text`) when media-only, puts `format` (`plain_text`/`markdown`), `headline`, and `language` (`LanguageCombobox`) in `Content options` | `publication-editor-source-section.tsx` (`PublicationEditorSourceSection`), `language-combobox.tsx` | Autosaved via `PATCH .../draft` (`sourceContent` payload alongside `content`) | Editable for `owner`, `editor` when `publicationEditable`; read-only summary when locked/viewer | Split across `edit mode "All channels" tab` (post body/media/title) & `edit mode channel tab` `"Content options"` (`format`, `language`) per SPEC-013 | **S2 + S3** (`PublicationEditorSourceSection` is shared with S3 `PostSourceEditor`, NOT used by S1!) |
| "Own text" toggle & reset to post text | Tracks `channelFollowsPost` (`channelVersionFollowsSource`); shows "Own text" notice and "Use post text" button to project `sourceContent` back onto `target` | `publication-editor.tsx` (`channelFollowsPost`, `applyPostTextToChannel`) | `applySourceContentToTarget` + draft autosave `PATCH .../draft` | `owner`, `editor` when editable | `edit mode channel tab` ("Same as all channels" / "Use the text for all channels" on chip & tab) | **S1 + S2** (S1 does shared/custom text for plain body; S2 does structured projection across target schema) |
| Schema-driven channel fields, threads, polls, link cards & validation diagnostics | Renders `ThreadControl` + `inlineFields` outside disclosure, plus remaining fields (Bluesky link card, Mastodon/Telegram polls, Dev.to article fields, media overrides, alt text) inside "Adapt for channel" disclosure with `[data-validation-diagnostics]` | `publication-editor-target-section.tsx`, `publication-target-editor.tsx`, `publication-target-field-control.tsx`, `providers/thread-control.tsx`, `providers/*-ui.tsx` | Validates server-side on `PATCH .../draft` (`validationIssues`, `reviewState`) | `owner`, `editor` when `publicationEditable` (read-only view otherwise) | `edit mode channel tab` inside `"Content options"` disclosure (and consider promoting thread/poll ergonomics per SPEC-013) | **Only S2** (S1 lacks polls, threads, Bluesky link cards, Dev.to fields, alt-text/target media overrides) |
| Channel profile adoption & history | Checks if channel profile changed after draft creation; lets operator assess impact, adopt new profile rules (`PublicationProfileAdoption`), and browse `PublicationAdoptionHistory` | `publication-profile-adoption.tsx`, `publication-adoption-history.tsx`, `publication-editor.tsx` | `GET .../channels/:channelId/profile`, `POST .../draft/assess-adoption`, `POST .../draft/adopt-profile`, `GET .../draft/adoptions`, `GET .../editor` | `owner`, `editor` when channel profile version drifted or adoption count > 0 | `edit mode channel tab` (above or inside `"Content options"`) | **Only S2** |
| Per-publication draft autosave & promotion ("Save" / "Schedule") + Undo / Discard | Debounced `PATCH .../draft` (`expectedRevision`, `sourceContent`, `content`), plus explicit `Schedule` / `Update schedule` / `Return to draft` / `Save version` (`promotePublicationDraft`) and `Discard changes` with 10s undo toast | `publication-editor.tsx` (autosave effect, `promoteDraft`, `discardChanges`), `publication-editor-promotion-section.tsx` | `PATCH .../publications/:id/draft`, `POST .../publications/:id/draft/promote` (with `cadenceConfirmation`), `GET .../editor` | `owner`, `editor` when `publicationEditable` | Replaced in edit mode by unified composition autosave + SPEC-013 single `"Save"` and `"Discard changes"` | **Only S2** |
| Schedule picker (`DateTimePicker`) | Edits publication `scheduledAt` in project timezone (note: NOT autosaved in `PATCH .../draft`, only applied on Promote; `deliveryMode` cannot be edited here) | `publication-editor-promotion-section.tsx` (`PublicationEditorDeliverySettings`), `date-time-picker.tsx` | `POST .../draft/promote` (`scheduledAt`) | `owner`, `editor` when `publicationEditable` | `edit mode channel tab` (channel chip delivery popover) | **S1 + S2** (S1 edits both mode+time in chip; S2 edits time only in footer/settings card) |
| LocalStorage v3 recovery buffer & profile-mismatch comparison dialog | Persists local edits + `scheduleValue` in `localStorage` (`postdot:publication-editor-recovery:v3:...`); silently restores if `baseRevision >= draft.revision` and profile matches, or opens blocking `PublicationRecoveryComparison` dialog | `publication-editor.tsx` (`readRecovery`, `restoreRecovery`, `restoreRecoveryAgainstLatestServer`), `publication-recovery-comparison.tsx` | Reads `GET .../editor` and `GET .../media/:id` | `owner`, `editor` when `publicationEditable` | Shared edit mode recovery layer (must generalize key & schema to multi-channel composition!) | **Only S2** |
| Source conflict & stale revision sidebar + rebase | Detects `409 write_conflict` or `draft.sourceRevision !== post.sourceRevision`; displays `SourceComparisonContent` word-diff and actions ("Use post text & keep/replace", "Load server", "Load local") | `publication-editor-sidebar.tsx` (`PublicationEditorSidebar`, `SourceComparisonContent`), `publication-editor.tsx` (`rebaseToLatestSource`, `reloadServerVersion`) | `POST .../publications/:id/draft/rebase`, `GET .../editor` | `owner`, `editor` on conflict / stale draft | `edit mode channel tab` / shared conflict banner (for external API/MCP/CLI edits per SPEC-013) | **S2 + S3** (S2 handles active editor rebase; S3 uses `PostSourceReview` batch rebase) |
| Immediate publication tag assignment | Updates tags immediately on selection change (does NOT wait for autosave or Promote!) and allows inline tag creation | `publication-tag-picker.tsx`, `publication-editor.tsx` (`handlePublicationTagIdsChange`) | `GET .../publications/:id/tags`, `PUT /api/projects/:projectId/publications/:id/tags` (`api.replacePublicationTags`), `POST .../tags` | `owner`, `editor` (read-only display when locked/viewer, even on published publications!) | Shared across post / per-channel (needs SPEC-013 alignment: tags are stored per-publication in API today, see Risks) | **S1 + S2** (not on S3) |
| Locked / read-only publication layout | When `readOnly` (viewer) or `published`/`cancelled`/`publishing`/`threadStarted`, hides source/target editors and shows single `PublicationDraftPreview`, tags, lifecycle, comments/replies, and activity | `publication-editor.tsx` (`!publicationEditable`) | Same read queries as active view (`GET .../editor`, tags, media, comments, replies, audit) | `viewer` (any state) or `owner`/`editor` when publication is non-editable | `edit mode channel tab` (locked channel renders read-only preview + below-composer panels per SPEC-013) | **Only S2** |
| Activity timeline | Collapsible disclosure listing audit events filtered for this publication and parent post | `publication-activity-timeline.tsx` (`PublicationActivityTimeline`), `publication-editor.tsx` | `GET /api/projects/:projectId/audit-events` (`api.listAuditEvents`) | All roles (`owner`, `editor`, `viewer`), all states | `below the composer` (collapsible disclosure) | **Only S2** |
| Reactive access revocation & editor reread state machine | Subscribes to `subscribeProjectAccessRevocation` (SSE/403/404); transitions between `active`, `checking` ("Checking project access..."), `recovery_required` (technical error Retry), `revoked` (`AccessRemovedSurface`), quarantines in-flight saves/promotions, and performs deferred reread when access recovers | `publication-editor.tsx` + `publications/$publicationId.tsx` + `lib/project-access-verification.ts` | `GET /api/projects/:projectId/membership` (`api.getProjectMembership`), `GET .../editor` | Any authenticated session whose project membership changes or is revoked while open | Must be preserved at top level of unified edit mode (`$postId` and `$publicationId`) | **S2 + S3** (S2 has full state machine + recovery buffer retention; S3 has simpler `suspended` flag) |

---

## Surface 3: `/posts/$postId`

Primary route and files:
- `apps/web/src/routes/dashboard/projects/$projectId/posts/$postId.tsx` (`PostRoute`)
- `apps/web/src/components/post-source-editor.tsx` (`PostSourceEditor`)
- `apps/web/src/components/add-post-destination.tsx` (`AddPostDestination`)
- `apps/web/src/components/post-source-review.tsx` (`PostSourceReview`)
- `apps/web/src/components/dashboard-publication-parts.tsx` (`PublicationList`, `PublicationRow`, `PublicationRowMenu`)

| Capability | Description | Where it lives | API calls | Who can use (roles, states) | SPEC-013 placement | Surface flag |
| --- | --- | --- | --- | --- | --- | --- |
| Post page shell, heading & 404/error retry | Renders post title/excerpt heading, Back to queue link, loading state, 404 "Post unavailable" state, or `QueryErrorState` retry | `posts/$postId.tsx` (`PostRoute`) | `GET /api/projects/:projectId/posts/:postId`, `GET .../membership`, `GET .../publications` (`loadPostPublications`), `GET .../media/:id` | All roles (`owner`, `editor`, `viewer`) | Replaced by unified edit mode composer opening on `"All channels"` tab | **Only S3** (shell retired under SPEC-013) |
| Explicit post source viewer and editor with navigation blocker | Views read-only `SourceComparisonContent`; clicking "Edit text" opens `PublicationEditorSourceSection` with manual Save/Cancel, concurrent revision check, and `useBlocker`/`beforeunload` Discard confirmation | `post-source-editor.tsx` (`PostSourceEditor`) | `PATCH /api/projects/:projectId/posts/:postId` (`api.savePostSource`) | View: all roles; Edit: `owner`, `editor` (not `viewer`, not suspended) | Replaced by `edit mode "All channels" tab` (with autosave + unified `"Save"` instead of explicit Edit/Save toggle) | **Only S3** (explicit source-only `PATCH /posts/:postId` editor) |
| Destination list with inline quick actions and menu | Lists every publication of the post with status, channel, schedule, inline quick actions (Edit/View, Retry, Record published, Undo publish, Review outcome), and `PublicationRowMenu` (Copy link, Duplicate draft, Delete draft) | `posts/$postId.tsx`, `dashboard-publication-parts.tsx` (`PublicationList`, `PublicationRow`, `PublicationRowMenu`), `lib/project-publication-actions.ts` | `POST .../publish`, `POST .../publish/undo`, `POST .../retry`, `POST .../duplicate`, `DELETE .../publications/:id` | View: all roles; Actions: `owner`, `editor` (hidden for `viewer`); Edit links work for all | Channel chips replace list navigation; Duplicate draft & Delete draft must be preserved via chip removal / menu or `below the composer` | **Only S3** (overview list of all destinations; Duplicate draft on post page is **Only S3** vs S2!) |
| Add destination to existing post | Opens dialog to select any channel and delivery mode (`manual`/`automatic`); warns and requires explicit second-click confirmation if post already has a publication on that channel; hidden while `editingSource` | `add-post-destination.tsx` (`AddPostDestination`) | `GET .../posts/:postId`, `GET .../publications` (`loadPostPublications`), `POST /api/projects/:projectId/posts/:postId/destinations` (`api.addPostDestinations`) | `owner`, `editor` (hidden when `viewer` or editing source on S3; always visible in rail on S2) | `create mode` + `edit mode "All channels" tab` + `edit mode channel tab` (Add channel button in chip row) | **S2 + S3** |
| Batch stale channel version notice and review dialog | Counts editable channel drafts with `draft.sourceRevision < post.sourceRevision`; opens dialog with diff preview (`SourceComparisonContent`), locked reasons, checkbox selection, partial failure per-row errors, and sequential rebase (`replaceContent: true`) | `post-source-review.tsx` (`PostSourceReview`) | `GET .../posts/:postId`, `GET .../publications`, `GET .../publications/:id/editor`, `GET .../media/:id`, `POST /api/projects/:projectId/publications/:id/draft/rebase` | `owner`, `editor` when `staleCount > 0` (and not `editingSource` on S3) | `edit mode "All channels" tab` + `edit mode channel tab` (external source-drift review dialog per SPEC-013) | **S2 + S3** |
| Access suspension on revocation (S3) | Hides source editor and shows `QueryErrorState` when `subscribeProjectAccessRevocation` fires; clears `suspended` on successful refetch | `posts/$postId.tsx` (`suspended`, `generation` epoch) | `GET .../posts/:postId`, `GET .../membership` | Any session losing access while viewing `/posts/$postId` | Unified edit mode must adopt S2's stricter access verification & recovery preservation | **S2 + S3** (S3 version is simpler and does not preserve recovery buffer) |

---

## Single-Surface Capabilities Summary (Migration Checklist)

These capabilities live on only one surface today and are the easiest to drop accidentally during SPEC-013 consolidation:

1. **Only on S1 (`/publications/new`):**
   - Calendar slot `?date=&time=` prefill.
   - Server-synced create draft + JSON download (`postdot-draft-versions.json`) + "Start over".
   - Session expiration (`401`) / account switch inline pause with `/login?continue=...` button.
   - Inline channel creation (`ChannelCreationDialog`) from the channel bar.
   - Changing `deliveryMode` (`manual` vs `automatic`) per channel and via shared defaults.
   - Conditional post title visibility driven by channel profile schema.
   - Live body/title character, grapheme, and X-weighted counters (`XWeightedTextCount`, `PublicationTextCount`).
   - Blocking submit while media uploads/imports finalize (`mediaPreparationPending`).
   - `Cmd/Ctrl+Shift+M` shortcut to open the media picker (`shortcuts.ts` documents it for `/posts/` too, even though S3 does not handle it today).
2. **Only on S2 (`/publications/$publicationId`):**
   - `?from=calendar&date=&view=` navigation memory across channel tabs and unavailable/404 screens.
   - `CopyPublicationLink` button with clipboard-denied fallback modal.
   - Movement links (`fromPublicationId` / `toPublicationId`) and requested schedule display.
   - Lifecycle strip (`PublicationLifecyclePanel`), connection repair link (`#publisher-connection-:channelId`), single-publication `Cancel`, and `Move` (`PublicationMoveDialog`).
   - Cadence delay notice and override (`PublicationCadenceStatus`).
   - Automatic destination identity confirmation (`PublicationDestination`).
   - Ambiguous outcome reconciliation (`PublicationOutcomePanel`).
   - Thread progress display and post-start edit locking (`PublicationThreadProgress`).
   - Provider comments (`PublicationCommentsPanel`), first comment (`PublicationFirstCommentPanel`), and replies (`PublicationRepliesPanel`).
   - Structured target fields (threads, Mastodon/Telegram polls, Bluesky link card, Dev.to metadata, validation diagnostics) and channel profile adoption + history.
   - `localStorage` v3 recovery comparison dialog, `Discard changes` with 10s undo toast, immediate publication tag replacement (`replacePublicationTags`), activity timeline (`PublicationActivityTimeline`), and read-only locked publication preview.
3. **Only on S3 (`/posts/$postId`):**
   - Duplicate draft action on a destination (`PublicationRowMenu` -> `duplicateDraftPublication`).
   - Delete draft action on a destination (`PublicationRowMenu` -> `deleteDraftPublication`; S2 does not expose delete!).
   - Dirty navigation blocker (`useBlocker` + `beforeunload`) for non-autosaved source edits.
   - Batch overview of every destination's status/outcome on one screen without clicking every channel tab (SPEC-013 addresses status via channel chips, but error messages, scheduled timestamps, duplicate draft, and published external links for each channel should stay easy to inspect).

---

## Browser Journeys (Surfaces 2 and 3)

Every Playwright spec and test in `e2e/` that navigates to, renders, or asserts behavior on Surface 2 (`/publications/$publicationId`) or Surface 3 (`/posts/$postId`), grouped by capability.

### 1. Post Editing, Sibling Navigation, and Locked States
- **`e2e/experience/detail-journeys.spec.ts`**
  - `reviews post and publication detail states in en` / `reviews post and publication detail states in fr`:
    - Opens Queue, switches to posts view (`[data-queue-post-group]`), follows `View post` link to `/posts/$postId`, checks `Destinations` region (`[data-page-column="management"]`), clicks `Back to queue`.
    - Inspects `/posts/$postId`, draft, scheduled, and published `/publications/$publicationId` across `1920`, `820`, `390` viewports with reduced motion, dark/light themes, EN/FR locales, zero horizontal overflow, Axe accessibility = 0 violations, `[data-publication-composer]` width > 90% at `1920px`, `nav_queue` active state.
    - Asserts `#source-body` is visible for draft/scheduled and absent (`count(0)`) for published, and lifecycle cancel/record-published/retry buttons are hidden when published.
    - Renders mocked `failed` state and asserts `[data-publication-error]` is visible.
    - Tests `404` and `503` failures on both `/posts/$postId` and `/publications/$publicationId`, including retry on `503` and `Back to calendar` preserving `?date=2026-10-28&view=week`.
    - Exercises mobile (`390px`) cancel confirmation dialog on scheduled publication.
  - `keeps sibling destinations reachable beyond the first publications page`:
    - Creates > 100 publications so the target post falls past the first `/publications?limit=100` cursor; visits `/publications/:id1` and verifies sibling button `Community` is visible and switches to `/publications/:id2`.
  - `returns an unavailable publication to its calendar context`:
    - Visits 404 `/publications/:id?from=calendar&date=2026-10-28&view=week`, asserts unavailable heading, clicks `Back to calendar`, verifies URL `/overview?date=2026-10-28&view=week`.
- **`e2e/publication-media.spec.ts`**
  - `persists mixed and media-only publications, previews every representation, and prevents removing active media`:
    - Redirects from create to `/posts/$postId`, opens `/publications/$id` from Queue, verifies mixed text+media and media-only layout (`[data-source-media-toolbar]` showing `Add text` / `Add media` without body field), opens from Calendar Preview (`?date=...&from=calendar&view=month`), edits draft via `PATCH .../draft`, switches channels via sibling rail while keeping calendar back link, verifies `[data-publication-draft-preview]`.

### 2. Concurrent Editing, Stale Source Review, Recovery Buffer, and Rebase
- **`e2e/publication-concurrent-editing.spec.ts`**
  - `keeps an open editor on its loaded revision when a sibling edit advances the server`: Opens two tabs on `/publications/$id`, saves in tab 1, confirms tab 2 displays passive update (`[data-publication-editor-message][data-passive-update]`) and keeps local state.
  - `recovers local edits after a server conflict instead of overwriting them`: Forces `409` conflict, asserts `[data-publication-conflict="true"]`, verifies recovery prompt & "Load local" vs "Load server".
  - `does not overwrite newer in-flight edits when an older realtime event arrives`: Intercepts autosave and SSE timing so an older invalidation does not overwrite newer typing.
  - `reconciles missed realtime updates when the page becomes visible again`: Triggers `visibilitychange` refetch and verifies UI reconciles.
  - `promotes the edited draft once while protecting unsaved follow-up edits`: Promotes draft while protecting subsequent keystrokes.
  - `explains ambiguous promotion results without auto-retrying`: Simulates ambiguous promote failure (`500`/network) and asserts manual `Check server` recovery (`[data-publication-editor-message]`) without auto-retry.
  - `reviews stale sibling channels selectively from the source post`: Opens `/posts/$postId` from Queue `"View post"`, clicks `Edit text` (`PostSourceEditor`), saves source, opens `PostSourceReview` ("Review changes"), unchecks one channel, applies rebase only to checked channel, verifies unchecked channel remains stale.
  - `keeps partial source review progress and retries only remaining destinations`: Simulates failure on one destination during batch rebase in `PostSourceReview`, verifies failed one stays checked while succeeded one is cleared, retries only remaining.
  - `requires an explicit fresh choice when a source review update hits a stale destination`: Forces `409` inside `PostSourceReview` rebase and verifies checkboxes reset (`setSelected(new Set())`) requiring fresh confirmation.
  - `shows a complete source diff when long post text diverges after an ellipsis`: Verifies `SourceComparisonContent` expand/collapse toggle (`500` char limit) and diff highlighting.
  - `shows a calm notice when a post changes elsewhere and resolves cleanly once`: Verifies calm source-drift notice in editor and one-step resolution.
  - `explains locked destinations separately during source review`: Ensures published/cancelled/inactive destinations show explicit locked reason inside `PostSourceReview` without checkboxes.
  - `discards uncommitted post source edits only after confirmation`: Tests `PostSourceEditor` dirty state + `Cancel` / navigation blocker confirmation dialog on `/posts/$postId`.
  - `adds a new destination from the source post with repeat-channel confirmation`: Uses `AddPostDestination` on `/posts/$postId`, confirms duplicate channel warning, creates destination, verifies list updates.
  - *(Note: file also has create/realtime tests; the 14 above directly test S2/S3.)*

### 3. Real-time Updates, Validation Diagnostics, and Provider-Specific Authoring
- **`e2e/realtime-validation.spec.ts`**
  - `refreshes an open publication editor after a worker state change`: Opens `/publications/$id`, completes worker run externally, asserts live status refresh without reload.
  - `opens notification subjects without acknowledgement and handles unavailable publications`: Clicks notification linking to `/publications/$id`, verifies URL lands cleanly without auto-marking notification read, handles 404 unavailable target.
- **`e2e/realtime-automatic-acceptance.spec.ts`**
  - `keeps publication editor dirty=false when realtime updates idle state` and `protects dirty local edits during realtime invalidation`: Opens `/publications/$id` and verifies SSE `project.update` updates idle editor vs preserves dirty local edits.
- **`e2e/editor-composer-pilot.spec.ts`**
  - `keeps destination validation diagnostics in the disclosure and hides technical metadata`: Opens `/publications/$id` with failing target schema/content, asserts `[data-validation-diagnostics="true"]` inside `[data-publication-customization="true"]` without exposing JSON schema/hash details.
  - `keeps article headline and markdown customization inside the disclosure and preview`: Edits article target fields, verifies `[data-publication-draft-preview]`, and verifies locked/published view never leaks unpromoted draft content.
  - `corrects destination media inside the customization disclosure without replacing post media`: Modifies `[data-target-field="media"]` on S2 without mutating post source media.
  - `separates native execution controls from channel profile identity`: Inspects `?editor=tiptap` vs target field controls.
  - `renders publication preview media for video attachments and supports descriptions`: Checks video `<video>` preview and description field on S2.
  - `adds a repeated channel destination with confirmation from an existing publication`: Uses `AddPostDestination` from S2 rail, confirms repeat channel, navigates/updates.
  - `keeps partial tag application warnings visible after creating a post`: Submits S1, lands on `/posts/$postId`, and asserts partial tag warning toast survives navigation.
- **`e2e/provider-depth.spec.ts`**
  - Tests Bluesky external link card (`[data-target-field]`, auto-populate from text, `[data-bluesky-link-card]` preview) and DEV.to article metadata (`tags`, `description`, `series`, `canonical_url`, `organization_id`, `ai_disclosure`, `published`, `[data-preview-platform="devto"]`) on `/publications/$id`.
- **`e2e/mastodon-poll.spec.ts`**
  - Tests Mastodon poll creation, choice limits/duration validation, `[data-mastodon-poll-preview]`, and localization on `/publications/$id`.
- **`e2e/telegram-poll.spec.ts`**
  - Tests Telegram poll creation (quiz vs regular, anonymous, multiple answers, validation, `[data-telegram-poll-preview]`, EN/FR copy) on `/publications/$id`.
- **`e2e/telegram-album.spec.ts`**
  - Tests Telegram mixed media album reordering (`[data-media-reorderable]`) and caption limits on `/publications/$id`.
- **`e2e/thread-authoring.spec.ts`**
  - Tests multi-item thread authoring (`[data-thread-editor]`, add/move up/down/remove items, per-item X/Bluesky/Mastodon counters, `[data-thread-preview]`) on `/publications/$id`.

### 4. Lifecycle Actions, Outcomes, Cadence, Comments, Replies, Move, Profile Adoption, Tags
- **`e2e/publication-detail-actions.spec.ts`**
  - `handles lifecycle actions, confirmation, and passive background updates`: Tests Cancel confirmation dialog, Record manual published + Undo publish, Retry failed automatic delivery, and passive SSE message on `/publications/$id`.
  - `refuses active-profile promotion of a superseded draft across channels`: Blocks promotion when channel profile changed; prompts adoption/review.
  - `adopts changed channel profile rules cleanly and preserves previous versions in recovery`: Walks through `PublicationProfileAdoption`, `PublicationAdoptionHistory`, and `PublicationRecoveryComparison` against mismatch.
  - `reconfirms destination identity after reconnecting an automatic channel`: Tests `PublicationDestination` unconfirmed identity banner and `confirmPublicationDestination` on `/publications/$id`.
- **`e2e/channel-profile-presets.spec.ts`**
  - `shows affected publications before stricter rules apply, without rewriting them`: Follows impact preview link from Channels to `/publications/$id` and verifies draft content was not silently rewritten.
  - `confirms stricter rules, preserves affected work, and exposes explicit adaptation`: Navigates to `/publications/$id`, verifies `Draft requires review` / `[data-publication-customization]` opens with validation diagnostics.
- **`e2e/publication-move.spec.ts`**
  - Moves a publication via `PublicationMoveDialog`, asserts `POST .../move`, verifies navigation to replacement `/publications/$newId`, tests `Original publication` and `Replacement publication` links and requested time notice.
- **`e2e/manual-publish-undo.spec.ts`**
  - Exercises recording manual publish and undoing manual publish from Queue and `/publications/$id` (including 10s undo toast and `data-publication-action="undo-publish"`).
- **`e2e/publication-copy-link.spec.ts`**
  - Exercises `CopyPublicationLink` button on `/publications/$id`, verifies canonical URL copy and French fallback dialog when clipboard write is denied.
- **`e2e/publisher-connection-recovery.spec.ts`**
  - Verifies `[data-publication-connection-issue]` and `[data-publication-connection-repair]` link to `#publisher-connection-<channelId>` on `/publications/$id` when connection is broken/revoked.
- **`e2e/web-124-ambiguous-recovery.spec.ts` & `e2e/web-124-outcome-states.spec.ts`**
  - Tests `PublicationOutcomePanel` reconciliation of `ambiguous` state (mark failed or mark published with external ID/URL, never offering Retry while ambiguous), responsive/i18n/theme checks, Back to queue, and Queue -> `/posts/$postId` -> `/publications/$id` drill-down.
- **`e2e/publication-first-comment.spec.ts`**
  - Tests enabling, saving, validation/conflict handling, and cancelling `PublicationFirstCommentPanel` on `/publications/$id`.
- **`e2e/publication-comments.spec.ts`**
  - Tests `PublicationCommentsPanel` on published `/publications/$id`: loading, on-demand refresh (`POST .../comments/refresh`), XSS-safe text rendering, and viewer read-only hiding Refresh.
- **`e2e/publication-replies.spec.ts`**
  - Tests `PublicationRepliesPanel` on published `/publications/$id`: pagination, sending reply (`POST .../replies`), idempotent `requestId` retry on ambiguous/failed send, and localized copy.
- **`e2e/project-tags.spec.ts`**
  - `creates tags without losing composition and synchronizes archived assignments`: Creates tag during composition, redirects to `/posts/$postId`, then navigates to `/publications/$id`, assigns/unassigns tags via `replacePublicationTags`, verifies archived tags stay selectable only while attached.

### 5. Search, Access Revocation, and Lifecycle Guards
- **`e2e/dashboard-search.spec.ts`**
  - `searches across projects, opens source posts and keeps failures inside the palette`: Opens Command Palette search, clicks a `post` result, asserts navigation to `/dashboard/projects/:projectId/posts/:postId`.
- **`e2e/web-312-live-access-revocation.spec.ts`**
  - Verifies live SSE/API revocation while `/publications/$id` is open transitions immediately to `AccessRemovedSurface` without leaving stale editing controls interactive.
- **`e2e/web-314-editor-access-state.spec.ts`** (6 tests targeting `/publications/$id`):
  - Tests `Checking project access...` state, quarantine of late draft/save responses during revocation, technical error retry -> conflict reconciliation, deferred editor reread after role restoration, failing reread retry with `localStorage` recovery buffer preservation, and post-close refusal handling.
- **`e2e/resource-lifecycle.spec.ts`**
  - Visits `/publications/$id` on an archived project (asserting read-only inspection) and `/publications/new` (asserting redirect away when archived).

*(Note: `e2e/channel-cadence.spec.ts` configures cadence on `/channels` and triggers conflict on `/queue`, inspecting `/editor` via API rather than opening Surface 2 in the browser; `e2e/separate-studio.spec.ts` likewise polls `/editor` via API.)*

---

## Incoming Links Into These Surfaces

Search across `apps/web/src`, `apps/api/src`, `packages/email`, `packages/cli`, and MCP modules:

### Links to `/dashboard/projects/$projectId/posts/$postId`

| Source | File & component | Trigger / context | Search params passed |
| --- | --- | --- | --- |
| Create composer redirect | `apps/web/src/components/new-publication-page.tsx:339` (`usePublicationComposer`) | After `POST /posts` creates draft or scheduled post | None |
| Grouped post list header (Queue / Performance / Posts) | `apps/web/src/components/dashboard-publication-parts.tsx:168` (`PublicationList` with `groupByPost=true`) | `"View post"` link on grouped post header | None |
| Publication row/card post link | `apps/web/src/components/dashboard-publication-parts.tsx:344` (`PublicationListItem` with `showPostLink=true`) | Link to parent post from publication item | None |
| Notification inbox (grouped by post) | `apps/web/src/components/notification-inbox.tsx:541` (`NotificationInbox`) | Grouped notification row when `context` includes `postId` | None |
| Command palette / global search | `apps/web/src/components/dashboard-search.tsx:533` (`DashboardSearch`) | Selecting a search result with `kind === 'post'` | None |
| Performance page grouped post heading | `apps/web/src/components/publication-performance-page.tsx:628` (`PublicationPerformancePage`) | Clicking post title `<h3>` in performance table | None |

### Links to `/dashboard/projects/$projectId/publications/$publicationId`

| Source | File & component | Trigger / context | Search params passed |
| --- | --- | --- | --- |
| Calendar event / hover preview | `apps/web/src/components/publication-calendar.tsx:203` (`openPublication`, invoked from calendar event click & `PublicationCalendarPreview`) | `"Edit publication"` / `"View publication"` | `from: 'calendar'`, `date` (`YYYY-MM-DD`), `view` (`day` \| `week` \| `month`, if valid) |
| Sibling channel rail in editor | `apps/web/src/components/publication-editor.tsx:565` (`handleChannelChange`) | Switching sibling channel tabs in S2 | Preserves `from`, `date`, `view` (`backToCalendar`) if present (`undefined` otherwise) |
| Post-move redirect | `apps/web/src/components/publication-editor.tsx:1778` (`PublicationMoveDialog.onMoved`) | Navigating to replacement publication after move | Preserves `from`, `date`, `view` (`backToCalendar`) if present (`undefined` otherwise) |
| Movement banner links (Original / Replacement) | `apps/web/src/components/publication-editor.tsx:1732, 1743` (`editor.movement`) | Clicking original or replacement publication link | None |
| Publication list items & table rows (Queue, Post destinations, etc.) | `apps/web/src/components/dashboard-publication-parts.tsx:396, 422, 664` (`PublicationListItem`, `PublicationRow` `[data-publication-edit-link="true"]`) | Primary link / `"Edit"` / `"View"` / `"Resume draft"` / `"Review outcome"` button | None |
| Publication row menu "Copy link" | `apps/web/src/components/dashboard-publication-parts.tsx:477` (`PublicationRowMenu`) | Builds canonical URL string for clipboard | None |
| Editor header "Copy link" | `apps/web/src/components/copy-publication-link.tsx:39` (`CopyPublicationLink`) | Builds canonical URL string for clipboard | None |
| Queue "Duplicate draft" | `apps/web/src/components/publication-queue-page.tsx:220` (`handleDuplicateDraft`) | Redirects to newly duplicated draft publication | None |
| Notification inbox (single publication) | `apps/web/src/components/notification-inbox.tsx:125, 551` (`NotificationInbox`) | Pre-checks `getPublicationEditor` then navigates to publication | `{ from: undefined, date: undefined, view: undefined }` |
| Queue "Awaiting approval" card | `apps/web/src/components/publication-approval-requests.tsx:193` (`PublicationApprovalRequests`) | Clicking approval request card link | None |
| Dashboard / Queue "Next" summary bar | `apps/web/src/components/publication-summary-bar.tsx:49` (`PublicationSummaryBar`) | Clicking next scheduled publication link | None |
| Performance table channel cell | `apps/web/src/components/publication-performance-page.tsx:351` (`PublicationPerformancePage`) | Clicking channel row link in analytics | None |
| Channel profile impact preview | `apps/web/src/components/channel-profile-impact-preview.tsx:109` (`ChannelProfileImpactPreview`) | `"Inspect"` / `"Open"` link on affected publications before activating stricter channel rules | None |
| Media asset info "Used in" list | `apps/web/src/components/media-information-dialog.tsx:362` (`MediaInformationDialog`) | Clicking an active publication usage reference | None |
| Transactional outcome alert emails | `apps/api/src/modules/notifications/email-runtime.ts:72`, `packages/email/src/templates/PublicationOutcomeEmail.tsx:12-20` | `publication_failed` and `publication_ambiguous` alert email CTA -> `${webOrigin}/dashboard/projects/${projectId}/publications/${subject.id}` | None |

### Links to `/dashboard/projects/$projectId/publications/new` (for completeness)
- Sidebar navigation (`apps/web/src/components/dashboard-shell.tsx`), Queue/Overview/Empty-state `"New post"` CTAs (`publication-queue-page.tsx:298` passing `date: undefined`), Calendar slot/day create (`publication-calendar.tsx:220` and `publication-calendar-page.tsx:231` passing `date` and `time`), Post-creation redirect? No, S1 redirects to `/posts/$postId`.

### Route-ID and Path-Sensitive Utilities (Must Be Audited During UX-683)
1. `apps/web/src/routes/dashboard/projects/$projectId.tsx:73`: `editorOwnsAccess = match.routeId === '/dashboard/projects/$projectId/publications/$publicationId'`. Adding `/posts/$postId` or unified composer routes here is critical so layout-level access-revocation doesn't unmount recovery state before the unified editor handles it!
2. `apps/web/src/lib/shortcuts.ts:92, 102`: currently matches `pathname.includes('/publications/new') || pathname.includes('/posts/')`, omitting `/publications/$publicationId` and implying `Cmd/Ctrl+Shift+M` works on `/posts/` even though S3 lacked that listener.
3. **DEV-only `?editor=tiptap|legacy` search param** (`apps/web/src/lib/editor-search.ts`): validated on `/publications/new` and `/publications/$publicationId`, not currently validated on `/posts/$postId`.
4. **CLI (`packages/cli/`) & MCP (`apps/api/src/modules/mcp/`):** Verified via repo search that neither prints web Studio URLs (they output JSON payloads, resource IDs, and plain summaries only).

---

## Risks (Most Severe First)

1. **Data loss across un-autosaved / non-transactional fields (`scheduleAt`, `deliveryMode`, `tags`, media preparation, and `localStorage` recovery migration)**
   - On Surface 2 today, `tags` (`replacePublicationTags`) apply immediately on click without waiting for Save/Promote, while `scheduledAt` sits in `scheduleValue` outside `PATCH .../draft` autosave and `deliveryMode` cannot be edited at all.
   - Surface 1 autosaves `tags`, `defaultDeliveryMode`, `defaultScheduledAt`, and per-target overrides inside one server composer draft, plus blocks submit while media uploads/imports finalize (`mediaPreparationPending`).
   - If SPEC-013's unified `PUT /posts/:postId/composition` persists `deliveryMode` and `scheduledAt` per publication while `tags` still mutate immediately (or per-publication instead of per-post), users switching channel tabs or refreshing mid-edit can lose schedule/tag consistency or silently publish partial edits. Furthermore, retiring S2's `localStorage` recovery key (`postdot:publication-editor-recovery:v3:...`) without migrating or reading existing in-flight buffers risks discarding uncommitted local drafts on upgrade.

2. **Split transaction between atomic composition save and non-atomic per-publication promotion**
   - SPEC-013 explicitly makes `PUT /posts/:postId/composition` atomic (`sourceContent` + all `publications[]` drafts, returning `write_conflict` + conflicting IDs), while keeping draft promotion (`POST .../draft/promote`) a sequential per-publication call.
   - If the user edits 4 channels and clicks "Save", `PUT .../composition` can succeed, updating `post.sourceContent` and all 4 drafts, and then channel 3 of 4 can fail promotion (e.g., `409 cadence_conflict`, `channel_profile_changed`, missing/revoked connection, or `validationIssues`).
   - That leaves channels 1-2 applied ("live"), channel 3-4 still "Changes pending" (applied != shown), and requires clear per-channel chip/tab error states, partial-promotion retry without repeating succeeded promotions, and ensuring `cadenceConfirmation` prompts do not silently re-trigger after partial success.

3. **Access revocation, viewer permissions, and route-owned recovery state races**
   - Surface 2 (`$publicationId.tsx` + `publication-editor.tsx`) implements a strict state machine (`createProjectAccessState`, `editorOwnsAccess` in `$projectId.tsx:73`, request generation quarantine, deferred reread, recovery preservation on technical `503` errors) covered by 6 dedicated tests in `e2e/web-312` and `e2e/web-314`. Surface 3 (`$postId.tsx`) only toggles a boolean `suspended`, and `$projectId.tsx` only delegates `editorOwnsAccess` for `/publications/$publicationId`.
   - Unifying S2 and S3 without extending `editorOwnsAccess` to `/posts/$postId` and keeping S2's request-generation quarantine across both `/posts/$postId` and `/publications/$publicationId` could cause the parent layout to unmount the composer on a transient error or allow stale in-flight composition saves to clear local recovery after membership removal.

4. **Mixed-state post permissions & locked channels sharing one composer**
   - A single post commonly contains both editable (`draft`/`scheduled`) and locked (`published`/`cancelled`/`publishing`/`threadStarted` or archived channel) destinations.
   - Editing on "All channels" must never modify locked channels, invalidate a published channel's preview, or show misleading "Changes pending" badges on locked chips. Conversely, switching from an editable channel tab to a locked channel tab (or opening a post as `viewer`) must keep tags, lifecycle actions (e.g., `Undo publish`, `Comments`, `Replies`, `Activity`), and read-only previews reachable without hiding the rest of the post or accidentally disabling chip navigation.

5. **Performance and memory overhead of mounting N rich-text editors and N per-channel queries simultaneously**
   - Surface 1 lazily mounts a `ConfiguredPublicationEditor` (TipTap/ProseMirror) only for tabs in `renderedEditorScopes` and keeps them mounted with `hidden` so cursor/undo history survives tab switches. On a post with 8-12 channels, eagerly loading `getPublicationEditor`, `getPublicationCadence`, `getPublicationDestination`, `getPublicationComments`, `getPublicationReplies`, `getPublicationFirstComment`, `getPublicationTags`, `listPublicationDraftAdoptions`, and `getChannelProfileState` for every channel on `/posts/$postId` mount would trigger dozens of requests and instantiate many heavy editors at once.
   - Lazy-mounting editors via `renderedEditorScopes` (plus unmounting or skipping editor instantiation on locked tabs) and scoping heavy below-composer queries (`comments`, `replies`, `cadence`, `destination`, `adoptions`, `audit-events`) to the active channel tab only is necessary to avoid slow initial render and stale query storms.

6. **Accessibility, keyboard shortcuts, and mobile navigation density**
   - SPEC-013 combines channel chips (with delivery popovers, status badges, own-text indicators, error badges, and add/remove controls), `"All channels"` tab, editor + media toolbar + `"Content options"` disclosure, live preview, AND below-composer lifecycle/outcome/comments/replies panels.
   - At `390px` mobile width (`detail-journeys.spec.ts` checks `scrollWidth <= clientWidth + 1` and Axe = 0 violations), long channel rows, nested `<details>` disclosures, per-channel error indicators, and popovers risk horizontal overflow, focus traps, or unlabelled icon triggers. Additionally, `Cmd/Ctrl+Enter` and `Cmd/Ctrl+Shift+M` shortcuts must work consistently across all composer tabs/routes (`shortcuts.ts` currently skips `/publications/$publicationId` and S3 does not listen for `Mod+Shift+M`).

7. **Cross-surface semantic gaps needing explicit product alignment before UX-682/UX-683**
   - **Tags granularity**: Today `listPublicationTags` / `replacePublicationTags` are per-publication in the backend, whereas S1 treats tags as a post-level field applied to all created publications (showing a partial-tag-failure toast). Opening `/posts/$postId` in edit mode when two channels of the same post have different tag sets has no obvious representation in a single post-level tag picker unless UX-681/UX-683 defines per-post union/intersection or per-channel tag editing.
   - **Headline & format in "All channels" vs channel tabs**: S1 hides the post title unless an active channel profile includes a headline field, while S2/S3 always show `headline`, `format` (`plain_text` / `markdown`), and `language` under `"Content options"`. Under SPEC-013, `"All channels"` must surface title whenever any selected channel uses one, and `"Content options"` must cleanly bridge `format`/`language` into create mode too so S1 and edit mode truly use one composer.
   - **Missing S2/S3 parity actions**: `Duplicate draft` and `Delete draft` exist only in S3's `PublicationRowMenu` (not on S2), while `Cancel` and `Move` exist only on S2 (not on S3's inline row actions). UX-683 must ensure all four remain cleanly reachable in edit mode.
