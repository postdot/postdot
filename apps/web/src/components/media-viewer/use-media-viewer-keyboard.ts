import { useEffect, useRef } from 'react'

export const MEDIA_VIEWER_SHORTCUTS = {
    fullscreen: 'F',
    next: 'ArrowRight',
    previous: 'ArrowLeft',
    zoomInAria: 'Shift+=',
    zoomIn: '+',
    zoomOut: '-',
    zoomReset: '0',
} as const

export function useMediaViewerKeyboard(
    enabled: boolean,
    actions: {
        readonly onFullscreenToggle?: () => void
        readonly onNext?: () => void
        readonly onPrevious?: () => void
        readonly onZoomIn?: () => void
        readonly onZoomOut?: () => void
        readonly onZoomReset?: () => void
    }
) {
    const actionsRef = useRef(actions)
    actionsRef.current = actions

    useEffect(() => {
        if (!enabled) return

        function handleKeyDown(event: KeyboardEvent) {
            if (isEditableTarget(event.target)) return

            const currentActions = actionsRef.current
            const hasModifier = event.ctrlKey || event.altKey || event.metaKey
            if (
                event.key === MEDIA_VIEWER_SHORTCUTS.previous &&
                !hasModifier &&
                currentActions.onPrevious !== undefined
            ) {
                event.preventDefault()
                event.stopPropagation()
                currentActions.onPrevious()
            } else if (
                event.key === MEDIA_VIEWER_SHORTCUTS.next &&
                !hasModifier &&
                currentActions.onNext !== undefined
            ) {
                event.preventDefault()
                event.stopPropagation()
                currentActions.onNext()
            } else if (
                event.key === MEDIA_VIEWER_SHORTCUTS.zoomOut &&
                !hasModifier &&
                currentActions.onZoomOut !== undefined
            ) {
                event.preventDefault()
                event.stopPropagation()
                currentActions.onZoomOut()
            } else if (
                (event.key === MEDIA_VIEWER_SHORTCUTS.zoomIn ||
                    (event.key === '=' && event.shiftKey)) &&
                !hasModifier &&
                currentActions.onZoomIn !== undefined
            ) {
                event.preventDefault()
                event.stopPropagation()
                currentActions.onZoomIn()
            } else if (
                event.key === MEDIA_VIEWER_SHORTCUTS.zoomReset &&
                !hasModifier &&
                currentActions.onZoomReset !== undefined
            ) {
                event.preventDefault()
                event.stopPropagation()
                currentActions.onZoomReset()
            } else if (
                event.key.toLowerCase() === MEDIA_VIEWER_SHORTCUTS.fullscreen.toLowerCase() &&
                !event.shiftKey &&
                !hasModifier &&
                currentActions.onFullscreenToggle !== undefined
            ) {
                event.preventDefault()
                event.stopPropagation()
                currentActions.onFullscreenToggle()
            }
        }

        window.addEventListener('keydown', handleKeyDown, true)
        return () => window.removeEventListener('keydown', handleKeyDown, true)
    }, [enabled])
}

function isEditableTarget(target: EventTarget | null) {
    return (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            target instanceof HTMLSelectElement)
    )
}
