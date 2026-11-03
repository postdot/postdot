/* cspell:disable */
import * as m from '@/paraglide/messages.js'

export type ShortcutCategory = 'general' | 'composer' | 'calendar' | 'media'

export interface AppShortcut {
    readonly id: string
    readonly category: ShortcutCategory
    readonly title: () => string
    readonly keys: readonly string[]
    readonly keywords: string
    readonly getHref?: (context: {
        readonly projectId: string | null
        readonly workspaceId: string | null
    }) => string | null
    readonly isAvailable?: (context: {
        readonly pathname: string
        readonly projectId: string | null
    }) => boolean
}

/** Check if client environment is macOS/iOS */
export function isMac(): boolean {
    if (typeof navigator === 'undefined') return false
    // @ts-expect-error - userAgentData is experimental in standard lib definitions
    const platform = navigator.userAgentData?.platform || navigator.platform || ''
    return /(Mac|iPhone|iPod|iPad)/i.test(platform)
}

/** Return default modifier key symbol */
export function getModifierKey(): string {
    return isMac() ? '⌘' : 'Ctrl'
}

/** Check if search query intends to view shortcuts */
export function isShortcutsQuery(query: string): boolean {
    const q = query.trim().toLowerCase()
    if (!q) return false
    return (
        q === '?' ||
        q === '/?' ||
        'shortcuts'.startsWith(q) ||
        'shortcut'.startsWith(q) ||
        'raccourcis'.startsWith(q) ||
        'raccourci'.startsWith(q) ||
        'keyboard'.startsWith(q) ||
        'clavier'.startsWith(q) ||
        'touches'.startsWith(q) ||
        'touche'.startsWith(q) ||
        'atajos'.startsWith(q) ||
        'atajo'.startsWith(q) ||
        'tastatur'.startsWith(q) ||
        'kürzel'.startsWith(q) ||
        'hotkeys'.startsWith(q) ||
        'hotkey'.startsWith(q) ||
        'help'.startsWith(q) ||
        'aide'.startsWith(q) ||
        'ayuda'.startsWith(q) ||
        'hilfe'.startsWith(q)
    )
}

export function getAppShortcuts(): readonly AppShortcut[] {
    const mod = getModifierKey()
    return [
        {
            id: 'search',
            category: 'general',
            title: m.shortcut_search,
            keys: [mod, 'K'],
            keywords: 'search palette command recherche commande chercher find palette',
        },
        {
            id: 'new_publication',
            category: 'composer',
            title: m.shortcut_new_publication,
            keys: [mod, 'N'],
            keywords: 'new create publication post article nouveau creer rediger draft composer',
            getHref: ({ projectId }) =>
                projectId
                    ? `/dashboard/projects/${encodeURIComponent(projectId)}/publications/new`
                    : null,
        },
        {
            id: 'composer_submit',
            category: 'composer',
            title: m.shortcut_composer_submit,
            keys: [mod, '↵'],
            keywords:
                'save draft schedule publish programmer enregistrer brouillon valider composer enter ↵',
            isAvailable: ({ pathname }) =>
                pathname.includes('/publications/new') || pathname.includes('/posts/'),
        },
        {
            id: 'composer_media',
            category: 'composer',
            title: m.shortcut_composer_media,
            keys: [mod, '⇧', 'M'],
            keywords:
                'media attachment image video media picker joindre image photo selection attacher',
            isAvailable: ({ pathname }) =>
                pathname.includes('/publications/new') || pathname.includes('/posts/'),
        },
        {
            id: 'calendar_today',
            category: 'calendar',
            title: m.shortcut_calendar_today,
            keys: ['T'],
            keywords: 'calendar today date calendrier aujourdhui maintenant jump',
            getHref: ({ projectId }) =>
                projectId ? `/dashboard/projects/${encodeURIComponent(projectId)}/overview` : null,
        },
        {
            id: 'calendar_nav',
            category: 'calendar',
            title: m.shortcut_calendar_nav,
            keys: ['[', ']'],
            keywords:
                'calendar previous next period navigation precedent suivant periode navigation',
        },
        {
            id: 'calendar_views',
            category: 'calendar',
            title: m.shortcut_calendar_views,
            keys: ['M', 'W', 'D', 'A'],
            keywords:
                'calendar view month week day agenda vues mois semaine jour liste affichage calendar',
        },
        {
            id: 'media_views',
            category: 'media',
            title: m.shortcut_media_views,
            keys: ['G', 'C', 'L'],
            keywords: 'media grid compact list view affichage grille compacte liste mediatheque',
            getHref: ({ projectId }) =>
                projectId ? `/dashboard/projects/${encodeURIComponent(projectId)}/media` : null,
        },
        {
            id: 'media_viewer',
            category: 'media',
            title: m.shortcut_media_viewer,
            keys: ['F', '+', '-', '0'],
            keywords:
                'media viewer fullscreen zoom plein ecran agrandir zoomer defiler visionneuse image',
        },
    ]
}

export function getShortcutCategoryTitle(category: ShortcutCategory): string {
    switch (category) {
        case 'general':
            return m.shortcut_cat_general()
        case 'composer':
            return m.shortcut_cat_composer()
        case 'calendar':
            return m.shortcut_cat_calendar()
        case 'media':
            return m.shortcut_cat_media()
    }
}
