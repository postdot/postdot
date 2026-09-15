import { Button } from '@herald/ui/components/button'
import { SolarProvider } from '@solar-icons/react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useMemo, useRef, useState, type ReactNode } from 'react'

import { MediaAssetCard } from '@/components/media-asset-card'
import { MediaAttachmentLibraryDialog } from '@/components/media/media-attachment-library-dialog'
import type { MediaLibraryFeatureOptions } from '@/components/media/media-library-toolbar'
import type {
    MediaListDateFilter,
    MediaListFamilyFilter,
    MediaListSort,
    MediaReference,
} from '@/lib/api'
import { LanguageProvider } from '@/lib/i18n'
import type { MediaLibraryViewMode } from '@/lib/media-library-view'
import type { MediaSelection } from '@/lib/target-media'

const STORY_PROJECT_ID = 'storybook-project'
const previewUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 640"><defs><linearGradient id="sky" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#172554"/><stop offset="0.5" stop-color="#2563eb"/><stop offset="1" stop-color="#f97316"/></linearGradient></defs><rect width="960" height="640" fill="url(#sky)"/><circle cx="720" cy="180" r="92" fill="#fde68a" opacity="0.9"/><path d="M0 520 180 350l140 120 170-210 220 260 110-100 140 100v120H0Z" fill="#111827" opacity="0.9"/><path d="M0 570 210 440l150 75 160-115 160 100 120-70 160 95v115H0Z" fill="#030712" opacity="0.88"/><text x="48" y="92" fill="#fff" font-family="sans-serif" font-size="32" font-weight="700">Herald media fixture</text></svg>'
)}`

const assets = [
    createMediaReference('sunset', 'sunset-over-the-ridge.jpg', 1920, 1280),
    createMediaReference('workspace', 'workspace-detail.png', 1280, 960),
    createMediaReference('portrait', 'portrait-study.jpg', 900, 1200),
    createMediaReference('wide', 'wide-landscape.jpg', 2400, 1000),
]

const meta = {
    title: 'Media/Attachment picker',
    component: MediaAttachmentLibraryDialog,
    tags: ['autodocs'],
    parameters: {
        layout: 'fullscreen',
    },
} satisfies Meta<typeof MediaAttachmentLibraryDialog>

export default meta

type Story = StoryObj

export const CardLayouts: Story = {
    render: () => <CardLayoutsExample />,
}

export const AttachmentDialog: Story = {
    render: () => <AttachmentDialogExample />,
}

export const FocusedAttachmentDialog: Story = {
    render: () => (
        <AttachmentDialogExample
            libraryFeatures={{
                filters: false,
                resultCount: false,
                search: true,
                viewModes: false,
            }}
        />
    ),
}

function CardLayoutsExample() {
    const [selectedId, setSelectedId] = useState<string | null>(assets[0]?.asset.id ?? null)

    return (
        <StoryProviders>
            <div className="min-h-screen bg-surface-canvas p-6 text-foreground sm:p-10">
                <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-3">
                    {(['grid', 'compact', 'list'] as const).map(layout => {
                        const asset = assets[layout === 'grid' ? 0 : layout === 'compact' ? 1 : 2]
                        if (asset === undefined) return null

                        return (
                            <section key={layout} className="min-w-0 space-y-2">
                                <div className="flex items-baseline justify-between gap-3">
                                    <h2 className="text-sm font-medium capitalize">{layout}</h2>
                                    <span className="text-xs text-muted-foreground">
                                        Card state
                                    </span>
                                </div>
                                <MediaAssetCard
                                    asset={asset}
                                    interactionDisabled={false}
                                    layout={layout}
                                    onToggle={() => setSelectedId(asset.asset.id)}
                                    previewUrl={previewUrl}
                                    projectId={STORY_PROJECT_ID}
                                    selectable
                                    selected={
                                        selectedId === asset.asset.id
                                            ? { assetId: asset.asset.id }
                                            : undefined
                                    }
                                    showAccessibilityText={false}
                                    showActions={false}
                                />
                            </section>
                        )
                    })}
                </div>
            </div>
        </StoryProviders>
    )
}

function AttachmentDialogExample({
    libraryFeatures = {
        filters: true,
        resultCount: true,
        search: true,
        viewModes: true,
    },
}: {
    readonly libraryFeatures?: MediaLibraryFeatureOptions
}) {
    const [open, setOpen] = useState(true)
    const [selection, setSelection] = useState<MediaSelection[]>([
        { assetId: assets[0]?.asset.id ?? '' },
    ])
    const [searchQuery, setSearchQuery] = useState('')
    const [mediaDateFilter, setMediaDateFilter] = useState<MediaListDateFilter>('all')
    const [mediaFamilyFilter, setMediaFamilyFilter] = useState<MediaListFamilyFilter>('all')
    const [mediaSort, setMediaSort] = useState<MediaListSort>('newest')
    const [mediaViewMode, setMediaViewMode] = useState<MediaLibraryViewMode>('grid')
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null)
    const selectedAssetById = useMemo(
        () => new Map(selection.map(item => [item.assetId, item])),
        [selection]
    )

    function toggleAsset(asset: MediaReference) {
        setSelection(current => {
            const selected = current.some(item => item.assetId === asset.asset.id)
            return selected
                ? current.filter(item => item.assetId !== asset.asset.id)
                : [...current, { assetId: asset.asset.id }]
        })
    }

    return (
        <StoryProviders>
            <div className="min-h-screen bg-surface-canvas p-6 text-foreground">
                <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
                    Open attachment picker
                </Button>
                <MediaAttachmentLibraryDialog
                    assets={assets}
                    error={null}
                    interactionDisabled={false}
                    libraryFeatures={libraryFeatures}
                    loadMoreSentinelRef={loadMoreSentinelRef}
                    loading={false}
                    loadingMore={false}
                    mediaDateFilter={mediaDateFilter}
                    mediaFamilyFilter={mediaFamilyFilter}
                    mediaSort={mediaSort}
                    mediaViewMode={mediaViewMode}
                    nextCursor={null}
                    onConfirm={() => setOpen(false)}
                    onDateChange={setMediaDateFilter}
                    onFamilyChange={setMediaFamilyFilter}
                    onLoadMore={() => undefined}
                    onOpenChange={setOpen}
                    onSearchQueryChange={setSearchQuery}
                    onSortChange={setMediaSort}
                    onToggle={toggleAsset}
                    onUpload={() => undefined}
                    onViewModeChange={setMediaViewMode}
                    open={open}
                    previewUrl={() => previewUrl}
                    projectId={STORY_PROJECT_ID}
                    scrollRef={scrollRef}
                    searchPending={false}
                    searchQuery={searchQuery}
                    selectedAssetById={selectedAssetById}
                    totalAssets={assets.length}
                    uploading={null}
                />
            </div>
        </StoryProviders>
    )
}

function StoryProviders({ children }: { readonly children: ReactNode }) {
    return (
        <LanguageProvider>
            <SolarProvider>{children}</SolarProvider>
        </LanguageProvider>
    )
}

function createMediaReference(
    id: string,
    filename: string,
    width: number,
    height: number
): MediaReference {
    const representation = {
        id: `${id}-original`,
        projectId: STORY_PROJECT_ID,
        assetId: id,
        kind: 'original' as const,
        state: 'ready' as const,
        declaredContentType: filename.endsWith('.png') ? 'image/png' : 'image/jpeg',
        detectedContentType: filename.endsWith('.png') ? 'image/png' : 'image/jpeg',
        detectedFormat: filename.endsWith('.png') ? 'png' : 'jpeg',
        family: 'image' as const,
        byteSize: 24_000,
        sha256: null,
        width,
        height,
        durationMs: null,
        pageCount: null,
        isAnimated: false,
        processorId: null,
        processorVersion: null,
        recipeJson: null,
        failureCode: null,
        failureMessage: null,
        createdAt: 0,
        updatedAt: 0,
    }

    return {
        asset: {
            id,
            projectId: STORY_PROJECT_ID,
            originalFilename: filename,
            defaultAccessibilityText: null,
            state: 'ready',
            archivedAt: null,
            deletionRequestedAt: null,
            deletedAt: null,
            failureCode: null,
            failureMessage: null,
            createdByActorId: 'storybook',
            createdAt: 0,
            updatedAt: 0,
        },
        representations: [representation],
    }
}
